import {
	FILE_SIZE,
	FOLDER_NAME,
	IMAGE_TYPES,
	TEMP_FILE,
	TEXT_MIME_TYPES,
	VISION_API,
	VISION_FILTERING_STRENGTH,
} from "./constants.mjs";

// ===== FILES =====

export function createTempFilePath(filename, prefix = "") {
	const safe = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
	return `${TEMP_FILE.PREFIX}${Date.now()}_${prefix}${safe}`;
}

export function exceedsMaxSize(fileSize, maxSizeMB) {
	return fileSize > maxSizeMB * FILE_SIZE.BYTES_PER_MB;
}

export function formatFileSize(bytes) {
	if (bytes === 0) return "0 Bytes";
	const { UNITS, CONVERSION_FACTOR } = FILE_SIZE;
	const i = Math.floor(Math.log(bytes) / Math.log(CONVERSION_FACTOR));
	const size = parseFloat(
		(bytes / Math.pow(CONVERSION_FACTOR, i)).toFixed(2)
	);
	return `${size} ${UNITS[i]}`;
}

export async function cleanupTempFile(filePath) {
	try {
		const fs = await import("fs");
		await fs.promises.unlink(filePath);
	} catch (error) {
		// Best-effort cleanup; ignore failures.
		console.warn(`Failed to cleanup temp file ${filePath}:`, error.message);
	}
}

// ===== IMAGES =====

export function isImageMimeType(mimeType) {
	return IMAGE_TYPES.includes(mimeType?.toLowerCase());
}

export function isTextMimeType(mimeType) {
	return TEXT_MIME_TYPES.includes(mimeType?.toLowerCase());
}

export function generateFilename(mimeType) {
	const extension = mimeType.split("/")[1] || "jpg";
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `image_${timestamp}.${extension}`;
}

export function generateUniqueFilename(originalFilename) {
	const timestamp = Date.now();
	const parts = originalFilename.split(".");
	if (parts.length > 1) {
		const extension = parts.pop();
		return `${parts.join(".")}_${timestamp}.${extension}`;
	}
	return `${originalFilename}_${timestamp}`;
}

// ===== SENDER =====

export function sanitizeFolderName(name) {
	return (
		name
			.replace(FOLDER_NAME.INVALID_CHARS, "_")
			.replace(/_{2,}/g, "_")
			.replace(/^_|_$/g, "")
			.trim()
			.substring(0, FOLDER_NAME.MAX_LENGTH) || FOLDER_NAME.FALLBACK
	);
}

function titleCase(str) {
	return str
		.split(" ")
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(" ");
}

function deriveNameFromEmailLocalPart(localPart) {
	if (!localPart) return "";
	// Drop "+tag" Gmail aliases.
	const base = localPart.split("+")[0];
	// Drop trailing digits (e.g. "john.doe2024" -> "john.doe").
	const stripped = base.replace(/\d+$/, "");
	// Treat common separators as spaces.
	const spaced = stripped.replace(/[._-]+/g, " ").trim();
	if (!spaced) return "";
	return titleCase(spaced);
}

export function parseFromHeader(fromHeader) {
	const fallback = {
		email: "unknown@example.com",
		name: "Unknown Sender",
		displayName: "Unknown Sender",
		folderName: "Unknown Sender",
		rawFrom: fromHeader || "Unknown",
	};

	if (!fromHeader) return fallback;

	try {
		const senderInfo = {
			email: "",
			name: "",
			displayName: "",
			folderName: "",
			rawFrom: fromHeader,
		};

		const emailMatch = fromHeader.match(/<([^>]+)>/);
		if (emailMatch) {
			senderInfo.email = emailMatch[1].trim();
			const nameMatch = fromHeader.match(/^([^<]+)</);
			if (nameMatch) {
				senderInfo.name = nameMatch[1]
					.trim()
					.replace(/^["']|["']$/g, "")
					.replace(/\s+via\s+.*$/i, "")
					.trim();
			}
		} else {
			senderInfo.email = fromHeader.trim();
		}

		// If the From header had no display name, derive a "First Last"
		// from the email local-part (john.doe@... -> "John Doe").
		if (!senderInfo.name && senderInfo.email) {
			const localPart = senderInfo.email.split("@")[0];
			senderInfo.name =
				deriveNameFromEmailLocalPart(localPart) || localPart;
		}

		senderInfo.displayName = senderInfo.name || senderInfo.email;
		senderInfo.folderName = sanitizeFolderName(senderInfo.displayName);

		return senderInfo;
	} catch (error) {
		console.warn("Failed to parse from header:", error);
		return fallback;
	}
}

// ===== VISION =====

export function getConfidenceThreshold(strength) {
	switch (strength) {
		case VISION_FILTERING_STRENGTH.CONSERVATIVE:
			return VISION_API.HIGH_CONFIDENCE_THRESHOLD;
		case VISION_FILTERING_STRENGTH.AGGRESSIVE:
			return VISION_API.LOW_CONFIDENCE_THRESHOLD;
		case VISION_FILTERING_STRENGTH.BALANCED:
		default:
			return VISION_API.CONFIDENCE_THRESHOLD;
	}
}

export function categorizeNonContentType(labelText) {
	if (
		labelText.includes("logo") ||
		labelText.includes("brand") ||
		labelText.includes("trademark")
	) {
		return "logo/brand";
	}
	if (labelText.includes("icon") || labelText.includes("symbol")) {
		return "icon";
	}
	if (
		labelText.includes("pixel") ||
		labelText.includes("tracker") ||
		labelText.includes("beacon")
	) {
		return "tracking pixel";
	}
	if (
		labelText.includes("signature") ||
		labelText.includes("footer") ||
		labelText.includes("watermark")
	) {
		return "signature/footer";
	}
	if (
		labelText.includes("button") ||
		labelText.includes("interface") ||
		labelText.includes("menu")
	) {
		return "UI element";
	}
	return "non-content";
}

export function isPartialNonContentMatch(labelText, confidence, threshold) {
	const partials = [
		// social platforms
		"facebook",
		"twitter",
		"linkedin",
		"instagram",
		"youtube",
		"tiktok",
		"snapchat",
		"pinterest",
		"reddit",
		// UI terms
		"button",
		"icon",
		"menu",
		"navigation",
		"interface",
		// branding
		"logo",
		"brand",
		"trademark",
		"symbol",
	];
	return partials.some(
		(term) => labelText.includes(term) && confidence >= threshold
	);
}

// ===== DRIVE =====

export function sanitizeDriveFolderName(name) {
	if (!name || typeof name !== "string") return "Unknown_Folder";
	return (
		name
			.replace(/[<>:"/\\|?*]/g, "_")
			.replace(/_{2,}/g, "_")
			.replace(/^_|_$/g, "")
			.trim()
			.substring(0, 100) || "Unknown_Folder"
	);
}

export function buildDriveSearchQuery(folderName, parentId = null) {
	let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
	if (parentId) query += ` and '${parentId}' in parents`;
	return query;
}

// ===== LOGGING =====

const STAGE_EMOJI = {
	info: "ℹ️",
	warn: "⚠️",
	warning: "⚠️",
	error: "❌",
	success: "✅",
	processing: "⚙️",
	detection: "🔍",
	extraction: "📥",
	vision: "👁️",
	folder: "📁",
	upload: "☁️",
	start: "🚀",
	complete: "✅",
	user: "👤",
	stats: "📊",
};

export function logWithEmoji(stage, message, data = null) {
	const emoji = STAGE_EMOJI[stage] || "📋";
	console.log(`${emoji} ${message}`);
	if (data) console.log("   Data:", JSON.stringify(data, null, 2));
}

export function logProcessingStats(stats) {
	console.log("📊 Processing Statistics:");
	for (const [key, value] of Object.entries(stats)) {
		console.log(`   ${key}: ${value}`);
	}
}

// ===== VALIDATION =====

export function validateEmailData(email) {
	if (!email || typeof email !== "object") return false;
	return ["id", "payload"].every((field) =>
		Object.prototype.hasOwnProperty.call(email, field)
	);
}

// ===== ERROR =====

export function createError(message, context = {}) {
	const error = new Error(message);
	error.context = context;
	error.timestamp = new Date().toISOString();
	return error;
}

// ===== ORCHESTRATION =====

export function getEmailData(steps, emailProp) {
	const email = emailProp || steps?.trigger?.event;
	if (!email) {
		throw createError("No email data provided from Gmail trigger");
	}
	return email;
}

// Default runArgs for orchestrator-internal calls. Underlying actions read
// their inputs from props (e.g. this.detectionResult) before falling back to
// `steps.*`, so an empty `steps` is fine. `$.export` is a no-op because only
// the outermost component's exports surface in the Pipedream UI.
const SILENT_RUN_ARGS = Object.freeze({
	steps: {},
	$: { export: () => {} },
});

/**
 * Invoke another Pipedream component's `run` from inside an orchestrator.
 *
 * Pipedream normally flattens a component's `methods.*` onto the instance
 * before calling `run`. When we invoke a component manually we have to do
 * that ourselves — `Object.create(component)` alone leaves methods stranded
 * under `methods.*` and unreachable as `this.foo`.
 */
export async function runAction(component, props, runArgs = SILENT_RUN_ARGS) {
	const instance = { ...props };
	for (const [name, fn] of Object.entries(component.methods || {})) {
		instance[name] = fn.bind(instance);
	}
	return component.run.call(instance, runArgs);
}
