import { axios } from "@pipedream/platform";

import { DRIVE_API, DRIVE_PATTERNS } from "../common/constants.mjs";
import {
	emailProp,
	gmailApp,
	googleDriveApp,
} from "../common/props.mjs";
import { createDetectedImage } from "../common/types.mjs";
import {
	createError,
	generateFilename,
	getEmailData,
	isImageMimeType,
	isPdfMimeType,
	isTextMimeType,
	isZipMimeType,
	logWithEmoji,
	parseFromHeader,
	validateEmailData,
} from "../common/utils.mjs";

export default {
	key: "gmail-email-image-detector",
	name: "Gmail Email Image Detector",
	description:
		"Detects images in Gmail emails from attachments, Google Drive links, embedded HTML, PDFs, and ZIP archives",
	version: "0.5.0",
	type: "action",

	props: {
		email: emailProp,
		gmail: gmailApp,
		googleDrive: googleDriveApp,
	},

	async run({ steps, $ }) {
		try {
			const email = getEmailData(steps, this.email);

			if (!validateEmailData(email)) {
				throw createError("Invalid email data structure", { email });
			}

			logWithEmoji(
				"start",
				`Processing email: "${email.subject}" from ${email.from}`
			);

			const senderInfo = this.extractSenderFromTrigger(email);
			logWithEmoji(
				"info",
				`Sender: ${senderInfo.displayName} (${senderInfo.email})`
			);

			const detectedImages = await this.detectAllImages(email);
			logWithEmoji("detection", `Found ${detectedImages.length} images`);

			const result = {
				emailId: email.id,
				subject: email.subject,
				senderInfo,
				images: detectedImages,
				detectedAt: new Date().toISOString(),
				stats: {
					totalDetected: detectedImages.length,
					attachments: detectedImages.filter(
						(img) => img.type === "attachment"
					).length,
					driveLinks: detectedImages.filter(
						(img) => img.type === "drive_link"
					).length,
					embedded: detectedImages.filter(
						(img) => img.type === "embedded"
					).length,
					pdfs: detectedImages.filter((img) => img.type === "pdf").length,
					zips: detectedImages.filter((img) => img.type === "zip").length,
				},
			};

			$.export("detection_result", result);
			return result;
		} catch (error) {
			logWithEmoji("error", `Image detection failed: ${error.message}`);
			throw error;
		}
	},

	methods: {
		extractSenderFromTrigger(email) {
			// Always route through parseFromHeader so the same name-extraction
			// and folderName logic applies whether Gmail pre-parsed the
			// headers or not. Synthesize a raw From header from
			// parsedHeaders.from when email.from is missing.
			const parsedFrom = email.parsedHeaders?.from;
			const rawFrom =
				email.from ||
				(parsedFrom?.email
					? parsedFrom.name
						? `"${parsedFrom.name}" <${parsedFrom.email}>`
						: parsedFrom.email
					: "");
			return parseFromHeader(rawFrom);
		},

		async detectAllImages(email) {
			const attachments = this.findImageAttachments(email.payload);
			const driveLinks = await this.findDriveLinks(email);
			const embedded = this.findEmbeddedImages(email.payload);
			return [...attachments, ...driveLinks, ...embedded];
		},

		findImageAttachments(payload) {
			const attachments = [];
			if (payload.parts) {
				this.searchPartsRecursively(payload.parts, attachments);
			} else if (payload.body?.attachmentId) {
				if (isImageMimeType(payload.mimeType)) {
					attachments.push(this.createAttachmentInfo(payload, "0"));
				} else if (isPdfMimeType(payload.mimeType)) {
					attachments.push(this.createPdfAttachmentInfo(payload, "0"));
				} else if (isZipMimeType(payload.mimeType, payload.filename)) {
					attachments.push(this.createZipAttachmentInfo(payload, "0"));
				}
			}
			return attachments;
		},

		searchPartsRecursively(parts, attachments, parentPartId = "") {
			parts.forEach((part, index) => {
				const partId = parentPartId
					? `${parentPartId}.${index}`
					: `${index}`;

				if (part.body?.attachmentId) {
					if (isImageMimeType(part.mimeType)) {
						attachments.push(this.createAttachmentInfo(part, partId));
					} else if (isPdfMimeType(part.mimeType)) {
						attachments.push(
							this.createPdfAttachmentInfo(part, partId)
						);
					} else if (isZipMimeType(part.mimeType, part.filename)) {
						attachments.push(
							this.createZipAttachmentInfo(part, partId)
						);
					}
				}

				if (part.parts) {
					this.searchPartsRecursively(part.parts, attachments, partId);
				}
			});
		},

		createAttachmentInfo(part, partId) {
			return createDetectedImage({
				type: "attachment",
				filename: part.filename || generateFilename(part.mimeType),
				mimeType: part.mimeType,
				size: part.body.size || 0,
				attachmentId: part.body.attachmentId,
				partId,
			});
		},

		createPdfAttachmentInfo(part, partId) {
			return createDetectedImage({
				type: "pdf",
				filename: part.filename || `document_${Date.now()}.pdf`,
				mimeType: part.mimeType,
				size: part.body.size || 0,
				attachmentId: part.body.attachmentId,
				partId,
			});
		},

		createZipAttachmentInfo(part, partId) {
			return createDetectedImage({
				type: "zip",
				filename: part.filename || `archive_${Date.now()}.zip`,
				mimeType: part.mimeType,
				size: part.body.size || 0,
				attachmentId: part.body.attachmentId,
				partId,
			});
		},

		findEmbeddedImages(payload) {
			const html = this.collectDecodedParts(
				payload,
				(mimeType) => mimeType === "text/html"
			);
			if (!html) return [];

			// Match: data:image/<type>;base64,<data>  (in src="..." or url(...))
			const re = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
			const seen = new Set();
			const found = [];
			let match;
			while ((match = re.exec(html)) !== null) {
				const [, mimeType, data] = match;
				if (!isImageMimeType(mimeType)) continue;
				const fingerprint = `${mimeType}:${data.slice(0, 64)}:${data.length}`;
				if (seen.has(fingerprint)) continue;
				seen.add(fingerprint);

				// Approx decoded size: base64 → bytes is len * 3/4 minus padding.
				const padding = (data.match(/=+$/) || [""])[0].length;
				const size = Math.floor((data.length * 3) / 4) - padding;

				found.push(
					createDetectedImage({
						type: "embedded",
						filename: generateFilename(mimeType),
						mimeType,
						size,
						base64Data: data,
					})
				);
			}
			return found;
		},

		async findDriveLinks(email) {
			const driveLinks = [];
			const textContent = this.collectDecodedParts(
				email.payload,
				isTextMimeType
			);

			// Multipart/alternative emails carry the same body in both text/plain
			// and text/html, so every Drive URL appears twice in textContent.
			// Dedup by fileId to avoid downloading and uploading each file twice.
			const seenFileIds = new Set();

			for (const pattern of DRIVE_PATTERNS) {
				for (const match of textContent.matchAll(pattern)) {
					const fileId = match[1];
					if (seenFileIds.has(fileId)) continue;
					seenFileIds.add(fileId);
					const driveLink = await this.createDriveLinkInfo(
						fileId,
						match[0]
					);
					if (driveLink) driveLinks.push(driveLink);
				}
			}

			return driveLinks;
		},

		async createDriveLinkInfo(fileId, url) {
			const metadata = await this.getDriveFileMetadata(fileId);
			if (!metadata) return null;

			if (isImageMimeType(metadata.mimeType)) {
				return createDetectedImage({
					type: "drive_link",
					fileId,
					filename: metadata.name,
					mimeType: metadata.mimeType,
					size: parseInt(metadata.size) || 0,
					url,
				});
			}
			if (isPdfMimeType(metadata.mimeType)) {
				return createDetectedImage({
					type: "pdf",
					fileId,
					filename: metadata.name,
					mimeType: metadata.mimeType,
					size: parseInt(metadata.size) || 0,
					url,
				});
			}
			if (isZipMimeType(metadata.mimeType, metadata.name)) {
				return createDetectedImage({
					type: "zip",
					fileId,
					filename: metadata.name,
					mimeType: metadata.mimeType,
					size: parseInt(metadata.size) || 0,
					url,
				});
			}
			return null;
		},

		async getDriveFileMetadata(fileId) {
			try {
				return await axios(this, {
					method: "GET",
					url: `${DRIVE_API.BASE_URL}/files/${fileId}`,
					headers: {
						Authorization: `Bearer ${this.googleDrive.$auth.oauth_access_token}`,
					},
					params: {
						fields: "id,name,mimeType,size,createdTime,modifiedTime,permissions",
						supportsAllDrives: true,
					},
				});
			} catch (error) {
				logWithEmoji(
					"warn",
					`Could not access Drive file ${fileId}: ${error.message}`
				);
				return null;
			}
		},

		// Walk the MIME tree and concatenate the base64-decoded body of every
		// part whose mimeType matches `predicate`. Used to gather either
		// HTML-only content (for embedded image scanning) or all text content
		// (for Drive link scanning).
		collectDecodedParts(part, predicate) {
			const chunks = [];
			const visit = (node) => {
				if (predicate(node.mimeType) && node.body?.data) {
					chunks.push(
						Buffer.from(node.body.data, "base64").toString("utf-8")
					);
				}
				node.parts?.forEach(visit);
			};
			visit(part);
			return chunks.join("\n");
		},
	},
};
