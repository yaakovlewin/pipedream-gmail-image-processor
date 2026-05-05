import fs from "node:fs";

import { axios } from "@pipedream/platform";

import { GMAIL_API } from "../common/constants.mjs";
import {
	gmailApp,
	googleDriveApp,
	maxFileSizeProp,
} from "../common/props.mjs";
import { validateDetectedImage, validateSenderInfo } from "../common/types.mjs";
import {
	createError,
	createTempFilePath,
	exceedsMaxSize,
	formatFileSize,
	logWithEmoji,
} from "../common/utils.mjs";

export default {
	key: "gmail-image-processor-image-extractor",
	name: "Image Extractor",
	description:
		"Downloads and extracts detected images from Gmail attachments and Google Drive",
	version: "0.1.0",
	type: "action",

	props: {
		detectionResult: {
			type: "object",
			label: "Detection Result",
			description: "Result from the Email Image Detector component",
		},
		maxFileSize: maxFileSizeProp,
		gmail: gmailApp,
		googleDrive: googleDriveApp,
	},

	async run({ steps, $ }) {
		try {
			const detectionResult =
				this.detectionResult ||
				steps.email_image_detector?.detection_result;

			if (!detectionResult) {
				throw createError("No detection result provided");
			}
			if (!validateSenderInfo(detectionResult.senderInfo)) {
				throw createError("Invalid sender info in detection result");
			}

			logWithEmoji(
				"start",
				`Extracting ${detectionResult.images.length} detected images`
			);

			const extractedImages = await this.extractAllImages(
				detectionResult.images,
				detectionResult.emailId
			);

			logWithEmoji(
				"extraction",
				`Successfully extracted ${extractedImages.length} images`
			);

			const result = {
				emailId: detectionResult.emailId,
				subject: detectionResult.subject,
				senderInfo: detectionResult.senderInfo,
				images: extractedImages,
				extractedAt: new Date().toISOString(),
				stats: {
					totalDetected: detectionResult.images.length,
					totalExtracted: extractedImages.length,
					skipped:
						detectionResult.images.length - extractedImages.length,
					attachments: extractedImages.filter(
						(img) => img.type === "attachment"
					).length,
					driveLinks: extractedImages.filter(
						(img) => img.type === "drive_link"
					).length,
					embedded: extractedImages.filter(
						(img) => img.type === "embedded"
					).length,
				},
			};

			$.export("extraction_result", result);
			return result;
		} catch (error) {
			logWithEmoji("error", `Image extraction failed: ${error.message}`);
			throw error;
		}
	},

	methods: {
		async extractAllImages(detectedImages, emailId) {
			const extractedImages = [];
			for (const image of detectedImages) {
				const extracted = await this.processDetectedImage(image, emailId);
				if (extracted) extractedImages.push(extracted);
			}
			return extractedImages;
		},

		async processDetectedImage(image, emailId) {
			try {
				if (!validateDetectedImage(image)) {
					logWithEmoji(
						"warn",
						`Invalid image data structure: ${image.filename}`
					);
					return null;
				}

				logWithEmoji("processing", `Processing: ${image.filename}`);

				if (exceedsMaxSize(image.size, this.maxFileSize)) {
					logWithEmoji(
						"warn",
						`Skipping large file: ${image.filename} (${formatFileSize(
							image.size
						)})`
					);
					return null;
				}

				const downloaded = await this.downloadImage(image, emailId);
				if (!downloaded) return null;

				// Drop base64Data once it's written to disk — keeping it in the
				// pipeline payload bloats logs and downstream JSON.
				const { base64Data: _b64, ...rest } = image;
				return {
					...rest,
					filePath: downloaded.filePath,
					extractedAt: new Date().toISOString(),
				};
			} catch (error) {
				logWithEmoji(
					"error",
					`Failed to extract ${image.filename}: ${error.message}`
				);
				return null;
			}
		},

		async downloadImage(image, emailId) {
			if (image.type === "attachment") {
				return this.downloadGmailAttachment(
					emailId,
					image.attachmentId,
					image.filename
				);
			}
			if (image.type === "drive_link") {
				return this.downloadDriveFile(image.fileId, image.filename);
			}
			if (image.type === "embedded") {
				return this.writeEmbeddedImage(image.base64Data, image.filename);
			}
			return null;
		},

		async writeEmbeddedImage(base64Data, filename) {
			try {
				const tmpFilePath = createTempFilePath(filename, "embedded_");
				const buffer = Buffer.from(base64Data, "base64");
				await fs.promises.writeFile(tmpFilePath, buffer);
				return { filePath: tmpFilePath, size: buffer.length };
			} catch (error) {
				throw createError(
					`Failed to write embedded image: ${error.message}`,
					{ filename }
				);
			}
		},

		async downloadGmailAttachment(messageId, attachmentId, filename) {
			try {
				const tmpFilePath = createTempFilePath(filename);
				const response = await axios(this, {
					url: `${GMAIL_API.BASE_URL}/messages/${messageId}/attachments/${attachmentId}`,
					headers: {
						Authorization: `Bearer ${this.gmail.$auth.oauth_access_token}`,
					},
				});

				if (!response.data) return null;

				const imageBuffer = Buffer.from(response.data, "base64");
				await fs.promises.writeFile(tmpFilePath, imageBuffer);
				return { filePath: tmpFilePath, size: imageBuffer.length };
			} catch (error) {
				throw createError(
					`Failed to download Gmail attachment: ${error.message}`,
					{ messageId, attachmentId, filename }
				);
			}
		},

		async downloadDriveFile(fileId, filename) {
			try {
				const tmpFilePath = createTempFilePath(filename, "drive_");

				const response = await this.googleDrive.files.get({
					fileId,
					alt: "media",
				});

				await fs.promises.writeFile(tmpFilePath, response.data);
				return {
					filePath: tmpFilePath,
					size: Buffer.byteLength(response.data),
				};
			} catch (error) {
				throw createError(
					`Failed to download Drive file: ${error.message}`,
					{ fileId, filename }
				);
			}
		},
	},
};
