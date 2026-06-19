import fs from "node:fs";

import { axios } from "@pipedream/platform";
import FormData from "form-data";

import {
	DRIVE_API,
	DRIVE_FOLDER_SETTINGS,
	UPLOAD_SETTINGS,
} from "../common/constants.mjs";
import {
	createRootFolderProp,
	googleDriveApp,
	parentFolderIdProp,
	rootFolderNameProp,
} from "../common/props.mjs";
import {
	createDriveFolder,
	createFailedUpload,
	createUploadedFile,
	createUploadSummary,
	validateDriveUploadConfig,
} from "../common/types.mjs";
import {
	buildDriveSearchQuery,
	createError,
	generateUniqueFilename,
	logWithEmoji,
	sanitizeDriveFolderName,
} from "../common/utils.mjs";

export default {
	key: "gmail-image-processor-drive-uploader",
	name: "Drive Uploader",
	description:
		"Creates sender-specific folders and uploads images to Google Drive",
	version: "0.3.0",
	type: "action",

	props: {
		processedImages: {
			type: "object",
			label: "Processed Images",
			description: "Results from image processor component",
		},
		googleDrive: googleDriveApp,
		parentFolderId: parentFolderIdProp,
		rootFolderName: rootFolderNameProp,
		createRootFolder: createRootFolderProp,
	},

	async run({ steps, $ }) {
		try {
			const data =
				this.processedImages ||
				steps.image_processor_orchestrator?.processed_images ||
				steps.ai_content_classifier?.classifier_result ||
				steps.vision_content_filter?.filter_result;

			if (!data) {
				throw createError("No processed images data provided");
			}

			const configValidation = validateDriveUploadConfig({
				processedImages: data,
				googleDrive: this.googleDrive,
				parentFolderId: this.parentFolderId,
				rootFolderName: this.rootFolderName,
				createRootFolder: this.createRootFolder,
			});
			if (!configValidation.valid) {
				throw createError(
					`Invalid configuration: ${configValidation.errors.join(", ")}`
				);
			}

			if (!data.images || data.images.length === 0) {
				logWithEmoji("info", "No images to upload");
				const result = {
					emailId: data.emailId,
					skipped: true,
					reason: "No images to upload",
				};
				$.export("upload_result", result);
				return result;
			}

			logWithEmoji(
				"start",
				`Starting Google Drive upload for: ${data.subject || data.emailId}`
			);
			logWithEmoji("user", `Sender: ${data.senderInfo.displayName}`);
			logWithEmoji(
				"folder",
				`Target folder: ${data.senderInfo.folderName}`
			);
			logWithEmoji("stats", `Uploading ${data.images.length} images`);

			const folderStructure = await this.setupFolderStructure(
				data.senderInfo
			);
			const uploadResults = await this.uploadAllImages(
				data.images,
				folderStructure.senderFolderId
			);
			const result = this.buildUploadResult(
				data,
				folderStructure,
				uploadResults
			);

			logWithEmoji(
				"complete",
				`Upload complete: ${uploadResults.successful.length} successful, ${uploadResults.failed.length} failed`
			);

			$.export("upload_result", result);
			return result;
		} catch (error) {
			logWithEmoji("error", `Drive upload failed: ${error.message}`);
			throw error;
		}
	},

	methods: {
		async setupFolderStructure(senderInfo) {
			const parentFolderId = this.parentFolderId || null;
			logWithEmoji(
				"folder",
				parentFolderId
					? `Using specified parent folder ID: ${parentFolderId}`
					: "Using Google Drive root as parent"
			);

			let targetParentId = parentFolderId;
			if (this.createRootFolder) {
				const rootName =
					this.rootFolderName ||
					DRIVE_FOLDER_SETTINGS.DEFAULT_ROOT_FOLDER_NAME;
				targetParentId = await this.ensureFolder(rootName, parentFolderId);
				logWithEmoji("folder", `Root folder ready: ${rootName}`);
			} else {
				logWithEmoji(
					"folder",
					"Skipping root folder - placing sender folders directly under parent"
				);
			}

			const senderFolderId = await this.ensureFolder(
				senderInfo.folderName,
				targetParentId
			);
			logWithEmoji(
				"folder",
				`Sender folder ready: ${senderInfo.folderName}`
			);

			return {
				parentFolderId,
				rootFolderId: this.createRootFolder ? targetParentId : null,
				senderFolderId,
			};
		},

		async ensureFolder(folderName, parentId = null) {
			const sanitized = sanitizeDriveFolderName(folderName);

			const existing = await this.findFolder(sanitized, parentId);
			if (existing) {
				logWithEmoji("folder", `Found existing folder: ${sanitized}`);
				return existing.id;
			}

			logWithEmoji("folder", `Creating new folder: ${sanitized}`);
			const created = await this.createFolder(sanitized, parentId);
			return created.id;
		},

		async findFolder(folderName, parentId = null) {
			try {
				const response = await axios(this, {
					method: "GET",
					url: `${DRIVE_API.BASE_URL}/files`,
					headers: {
						Authorization: `Bearer ${this.googleDrive.$auth.oauth_access_token}`,
					},
					params: {
						q: buildDriveSearchQuery(folderName, parentId),
						fields: DRIVE_API.FOLDER_FIELDS,
						...DRIVE_API.SHARED_DRIVE_SEARCH_PARAMS,
					},
				});
				return response.files?.[0] || null;
			} catch (error) {
				logWithEmoji(
					"warning",
					`Error searching for folder ${folderName}: ${error.message}`
				);
				return null;
			}
		},

		async createFolder(folderName, parentId = null) {
			try {
				const requestBody = {
					name: folderName,
					mimeType: DRIVE_API.FOLDER_MIME_TYPE,
				};
				if (parentId) requestBody.parents = [parentId];

				const response = await axios(this, {
					method: "POST",
					url: `${DRIVE_API.BASE_URL}/files`,
					headers: {
						Authorization: `Bearer ${this.googleDrive.$auth.oauth_access_token}`,
						"Content-Type": "application/json",
					},
					params: {
						fields: DRIVE_API.DEFAULT_FIELDS,
						...DRIVE_API.SHARED_DRIVE_PARAMS,
					},
					data: requestBody,
				});

				if (!response?.id) {
					throw new Error(
						"Invalid response from Google Drive API - no folder data returned"
					);
				}

				logWithEmoji("success", `Created folder: ${response.name}`);
				return createDriveFolder({
					id: response.id,
					name: response.name,
					url: response.webViewLink,
					parentId,
				});
			} catch (error) {
				throw createError(`Failed to create folder: ${folderName}`, {
					error: error.message,
				});
			}
		},

		async uploadAllImages(images, folderId) {
			const successful = [];
			const failed = [];

			for (const image of images) {
				try {
					logWithEmoji("upload", `Uploading: ${image.filename}`);
					const targetFilename = generateUniqueFilename(image.filename);
					const uploadResult = await this.uploadSingleImage(
						image,
						folderId,
						targetFilename
					);
					successful.push(
						createUploadedFile({
							...uploadResult,
							originalFilename: image.filename,
							targetFilename,
							type: image.type,
							mimeType: image.mimeType,
							aiCategory: image.aiCategory,
							aiConfidence: image.aiConfidence,
						})
					);
				} catch (error) {
					logWithEmoji(
						"error",
						`Failed to upload ${image.filename}: ${error.message}`
					);
					failed.push(
						createFailedUpload({
							filename: image.filename,
							type: image.type,
							error: error.message,
						})
					);
				}
			}

			return { successful, failed };
		},

		async uploadSingleImage(image, parentFolderId, targetFilename) {
			if (!image.filePath) {
				throw createError(`No file path found for ${targetFilename}`);
			}

			try {
				const form = new FormData();
				form.append(
					"metadata",
					JSON.stringify({
						name: targetFilename,
						parents: [parentFolderId],
					}),
					{ contentType: "application/json" }
				);
				form.append("file", fs.createReadStream(image.filePath), {
					filename: targetFilename,
					contentType: image.mimeType,
				});

				const uploaded = await axios(this, {
					method: "POST",
					url: `${DRIVE_API.UPLOAD_URL}/files?uploadType=${DRIVE_API.UPLOAD_TYPE}`,
					headers: {
						Authorization: `Bearer ${this.googleDrive.$auth.oauth_access_token}`,
						...form.getHeaders(),
					},
					params: {
						fields: DRIVE_API.DEFAULT_FIELDS,
						...DRIVE_API.SHARED_DRIVE_PARAMS,
					},
					data: form,
					timeout: UPLOAD_SETTINGS.TIMEOUT,
				});

				return {
					id: uploaded.id,
					name: uploaded.name,
					url: uploaded.webViewLink,
					size: uploaded.size,
					uploadedAt: new Date().toISOString(),
				};
			} catch (error) {
				throw createError(`Failed to upload file: ${targetFilename}`, {
					error: error.message,
				});
			}
		},

		buildUploadResult(data, folderStructure, uploadResults) {
			const summary = createUploadSummary({
				totalImages: data.images.length,
				successfulUploads: uploadResults.successful.length,
				failedUploads: uploadResults.failed.length,
				totalSizeUploaded: uploadResults.successful.reduce(
					(sum, file) => sum + (file.size || 0),
					0
				),
			});

			return {
				emailId: data.emailId,
				subject: data.subject,
				sender: data.senderInfo,
				processedAt: new Date().toISOString(),
				folder: {
					name: data.senderInfo.folderName,
					id: folderStructure.senderFolderId,
					parentFolder: folderStructure.parentFolderId
						? { id: folderStructure.parentFolderId }
						: null,
					rootFolder: this.createRootFolder
						? {
								name:
									this.rootFolderName ||
									DRIVE_FOLDER_SETTINGS.DEFAULT_ROOT_FOLDER_NAME,
								id: folderStructure.rootFolderId,
						  }
						: null,
				},
				summary,
				uploads: uploadResults,
				processingStats: {
					...summary,
					visionFiltering: data.visionStats || null,
				},
			};
		},
	},
};
