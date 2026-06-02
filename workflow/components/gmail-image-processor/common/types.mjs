/**
 * Shape definitions and runtime validators / constructors for the data passed
 * between actions. The typedefs below give editors something to hover on; the
 * functions are the actual contract.
 */

/**
 * @typedef {Object} SenderInfo
 * @property {string} email
 * @property {string} name
 * @property {string} displayName
 * @property {string} folderName - Sanitized for filesystem use
 * @property {string} rawFrom - Original `From:` header
 */

/**
 * @typedef {Object} DetectedImage
 * @property {"attachment"|"drive_link"|"embedded"|"pdf"|"zip"} type
 * @property {string} filename
 * @property {string} mimeType
 * @property {number} size - bytes
 * @property {string} [attachmentId]
 * @property {string} [partId]
 * @property {string} [fileId]
 * @property {string} [url]
 * @property {string} [contentId]
 */

/**
 * Extracted image. `type` may be one of the DetectedImage types OR
 * `"pdf_page"` for images pulled out of a PDF, OR `"zip_entry"` for images
 * pulled out of a ZIP archive during extraction. pdf_page images additionally
 * carry `pdfSource`, `pageNumber`, and `pdfImageIndex`; zip_entry images carry
 * `zipSource`, `zipEntryName`, and `zipEntryIndex` so downstream stages can
 * group them by source archive / brochure.
 * @typedef {DetectedImage & {filePath: string, extractedAt: string, pdfSource?: string, pageNumber?: number, pdfImageIndex?: number, zipSource?: string, zipEntryName?: string, zipEntryIndex?: number}} ExtractedImage
 */

/**
 * @typedef {Object} VisionFilteringStats
 * @property {number} totalDetected
 * @property {number} totalExtracted
 * @property {number} totalFiltered
 * @property {number} logoCount
 * @property {number} iconCount
 * @property {number} trackingPixelCount
 * @property {number} signatureCount
 * @property {number} otherCount
 */

/**
 * @typedef {Object} DriveFolder
 * @property {string} id
 * @property {string} name
 * @property {string} [url]
 * @property {string} [parentId]
 */

/**
 * @typedef {Object} UploadedFile
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {number} size
 * @property {string} uploadedAt
 * @property {string} originalFilename
 * @property {string} targetFilename
 * @property {string} type
 * @property {string} mimeType
 * @property {string} [aiCategory] - Category from AI classifier (e.g. "bedroom")
 * @property {number} [aiConfidence] - Classifier confidence 0–1
 */

/**
 * @typedef {Object} FailedUpload
 * @property {string} filename
 * @property {string} type
 * @property {string} error
 * @property {string} failedAt
 */

/**
 * @typedef {Object} UploadSummary
 * @property {number} totalImages
 * @property {number} successfulUploads
 * @property {number} failedUploads
 * @property {number} totalSizeUploaded
 * @property {number} successRate - 0–100
 */

// ===== VALIDATORS =====

export function validateSenderInfo(senderInfo) {
	if (!senderInfo || typeof senderInfo !== "object") return false;
	return ["email", "name", "displayName", "folderName", "rawFrom"].every(
		(field) =>
			Object.prototype.hasOwnProperty.call(senderInfo, field) &&
			typeof senderInfo[field] === "string"
	);
}

export function validateDetectedImage(image) {
	if (!image || typeof image !== "object") return false;
	const validTypes = ["attachment", "drive_link", "embedded", "pdf", "zip"];
	return (
		["type", "filename", "mimeType", "size"].every((field) =>
			Object.prototype.hasOwnProperty.call(image, field)
		) &&
		validTypes.includes(image.type) &&
		typeof image.filename === "string" &&
		typeof image.mimeType === "string" &&
		typeof image.size === "number"
	);
}

export function validateExtractedImage(image) {
	if (!image || typeof image !== "object") return false;
	const validTypes = [
		"attachment",
		"drive_link",
		"embedded",
		"pdf_page",
		"zip_entry",
	];
	const baseFields = ["type", "filename", "mimeType", "size", "filePath", "extractedAt"];
	return (
		baseFields.every((field) =>
			Object.prototype.hasOwnProperty.call(image, field)
		) &&
		validTypes.includes(image.type) &&
		typeof image.filename === "string" &&
		typeof image.mimeType === "string" &&
		typeof image.size === "number" &&
		typeof image.filePath === "string" &&
		typeof image.extractedAt === "string"
	);
}

export function validateDriveUploadConfig(config) {
	const errors = [];
	const warnings = [];

	if (!config || typeof config !== "object") {
		errors.push("Configuration must be an object");
		return { valid: false, errors, warnings };
	}

	if (!config.processedImages) errors.push("Processed images data is required");
	if (!config.googleDrive) errors.push("Google Drive app connection is required");

	if (
		config.rootFolderName !== undefined &&
		(typeof config.rootFolderName !== "string" ||
			config.rootFolderName.length === 0)
	) {
		warnings.push("Root folder name should be a non-empty string");
	}
	if (
		config.parentFolderId !== undefined &&
		typeof config.parentFolderId !== "string"
	) {
		warnings.push("Parent folder ID should be a string");
	}

	return { valid: errors.length === 0, errors, warnings };
}

// ===== CONSTRUCTORS =====

export function createSenderInfo(data = {}) {
	const displayName =
		data.displayName || data.name || data.email || "";
	return {
		email: data.email || "",
		name: data.name || "",
		displayName,
		folderName: data.folderName || displayName,
		rawFrom: data.rawFrom || "",
	};
}

export function createDetectedImage(data = {}) {
	return {
		type: data.type || "attachment",
		filename: data.filename || "",
		mimeType: data.mimeType || "",
		size: data.size || 0,
		...data,
	};
}

export function createVisionFilteringStats(data = {}) {
	return {
		totalDetected: data.totalDetected || 0,
		totalExtracted: data.totalExtracted || 0,
		totalFiltered: data.totalFiltered || 0,
		logoCount: data.logoCount || 0,
		iconCount: data.iconCount || 0,
		trackingPixelCount: data.trackingPixelCount || 0,
		signatureCount: data.signatureCount || 0,
		otherCount: data.otherCount || 0,
	};
}

export function createDriveFolder(data = {}) {
	return {
		id: data.id || "",
		name: data.name || "",
		url: data.url || "",
		parentId: data.parentId || null,
	};
}

export function createUploadedFile(data = {}) {
	const file = {
		id: data.id || "",
		name: data.name || "",
		url: data.url || "",
		size: data.size || 0,
		uploadedAt: data.uploadedAt || new Date().toISOString(),
		originalFilename: data.originalFilename || "",
		targetFilename: data.targetFilename || "",
		type: data.type || "",
		mimeType: data.mimeType || "",
	};
	if (data.aiCategory) file.aiCategory = data.aiCategory;
	if (typeof data.aiConfidence === "number") {
		file.aiConfidence = data.aiConfidence;
	}
	return file;
}

export function createFailedUpload(data = {}) {
	return {
		filename: data.filename || "",
		type: data.type || "",
		error: data.error || "",
		failedAt: data.failedAt || new Date().toISOString(),
	};
}

export function createUploadSummary(data = {}) {
	const totalImages = data.totalImages || 0;
	const successfulUploads = data.successfulUploads || 0;
	const failedUploads = data.failedUploads || 0;
	const successRate =
		totalImages > 0 ? (successfulUploads / totalImages) * 100 : 0;

	return {
		totalImages,
		successfulUploads,
		failedUploads,
		totalSizeUploaded: data.totalSizeUploaded || 0,
		successRate,
	};
}
