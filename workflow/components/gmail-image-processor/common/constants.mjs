export const FILE_SIZE = {
	BYTES_PER_MB: 1024 * 1024,
	UNITS: ["Bytes", "KB", "MB", "GB"],
	CONVERSION_FACTOR: 1024,
};

export const IMAGE_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/bmp",
	"image/tiff",
	"image/svg+xml",
];

export const TEXT_MIME_TYPES = ["text/plain", "text/html"];

export const DRIVE_PATTERNS = [
	/https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g,
	/https:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/g,
	/https:\/\/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/g,
];

export const GMAIL_API = {
	BASE_URL: "https://gmail.googleapis.com/gmail/v1/users/me",
};

export const DRIVE_API = {
	BASE_URL: "https://www.googleapis.com/drive/v3",
	UPLOAD_URL: "https://www.googleapis.com/upload/drive/v3",
	FOLDER_MIME_TYPE: "application/vnd.google-apps.folder",
	UPLOAD_TYPE: "multipart",
	DEFAULT_FIELDS: "id,name,webViewLink,size",
	FOLDER_FIELDS: "files(id,name,webViewLink)",
};

export const DRIVE_FOLDER_SETTINGS = {
	DEFAULT_ROOT_FOLDER_NAME: "Gmail_Images",
};

export const UPLOAD_SETTINGS = {
	TIMEOUT: 30_000,
};

export const FOLDER_NAME = {
	MAX_LENGTH: 50,
	INVALID_CHARS: /[<>:"/\\|?*]/g,
	FALLBACK: "Unknown Sender",
};

export const TEMP_FILE = {
	PREFIX: "/tmp/",
};

export const VISION_FILTERING_STRENGTH = {
	CONSERVATIVE: "conservative",
	BALANCED: "balanced",
	AGGRESSIVE: "aggressive",
};

export const GEMINI_API = {
	URL_TEMPLATE:
		"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
	DEFAULT_PRIMARY_MODEL: "gemini-2.5-flash",
	DEFAULT_ESCALATION_MODEL: "gemini-3.1-pro-preview",
};

export const PROPERTY_CATEGORIES = {
	KEEP: [
		"bedroom",
		"kitchen",
		"living",
		"bathroom",
		"exterior",
		"balcony",
		"garden",
		"pool",
		"view",
		"floor_plan",
		"aerial_or_map",
		"staging_catalog",
	],
	DROP: [
		"logo",
		"icon",
		"signature",
		"food",
		"people_portrait",
		"document",
		"screenshot_text",
		"other",
	],
};

export const PROPERTY_CLASSIFIER_PROMPT = `You are classifying an image found in an email for an apartment / vacation-rental business.

Decide which category the image belongs to. Whether to keep or drop it follows directly from the category — KEEP categories stay, DROP categories don't.

KEEP categories (part of what a guest would see in a property listing):
- bedroom, kitchen, living, bathroom — interior rooms
- exterior — building outside, facade, entrance, street view of the property
- balcony, garden, pool, view — outdoor or window-view shots
- floor_plan — architectural floor plan or layout diagram
- aerial_or_map — aerial photo or neighborhood map
- staging_catalog — staged interior, furniture-catalog-style photo, 3D render or artist's impression, or interior amenity space (gym, dining hall, lobby, spa)

DROP categories (not part of a listing):
- logo — standalone company / brand logo, not overlaid on a real photo
- icon — UI icon, social media icon
- signature — email signature image
- food — close-up of a dish, meal, or plated food
- people_portrait — image whose subject is a person (headshot, group shot)
- document — scan of a document, ID, contract
- screenshot_text — screenshot of text, app UI, web page
- other — anything else not clearly a property listing photo

Edge cases (apply these before falling back to a DROP category):
- Person standing inside a real room: if the room is the focus, return the room category (bedroom / living / etc). Only use people_portrait when the person is genuinely the subject.
- Real listing photo with a small watermark or corner logo: return the room or exterior category. The logo category is for standalone logo images only.
- 3D render, artist's impression, or marketing collage of an interior: staging_catalog.
- When genuinely unsure, prefer a KEEP category — false drops cost the business more than false keeps.

Confidence should reflect how sure you are about the keep-vs-drop decision (not the exact category). This value drives a cost-saving escalation cascade, so calibrated confidence matters — please be honest:
- 0.5–0.7: borderline, could go either way.
- 0.7–0.85: fairly sure but not obvious.
- 0.85+: clearly correct, no real ambiguity.

Return JSON with: confidence (0–1), category (one of the values above), reason (one short sentence).`;

export const VISION_API = {
	URL: "https://vision.googleapis.com/v1/images:annotate",

	NON_CONTENT_LABELS: [
		// Logos and branding
		"logo",
		"brand",
		"trademark",
		"emblem",
		"symbol",
		"icon",
		"badge",
		"seal",

		// Email signatures and footers
		"signature",
		"email signature",
		"footer",
		"watermark",

		// Tracking and technical elements
		"tracking pixel",
		"pixel",
		"beacon",
		"tracker",

		// UI elements and buttons
		"button",
		"interface",
		"menu",
		"navigation",
		"toolbar",
		"widget",

		// Social media icons
		"social media",
		"facebook icon",
		"twitter icon",
		"linkedin icon",
		"instagram icon",
		"youtube icon",
		"tiktok icon",
		"snapchat icon",

		// Generic non-content indicators
		"clipart",
		"graphic design",
		"template",
		"placeholder",

		// Promotional / structural
		"advertisement",
		"banner",
		"promotional",
		"marketing",
		"header",
		"divider",
		"separator",
		"border",
	],

	CONFIDENCE_THRESHOLD: 0.6,
	HIGH_CONFIDENCE_THRESHOLD: 0.8,
	LOW_CONFIDENCE_THRESHOLD: 0.4,

	MAX_LOGO_RESULTS: 10,
	MAX_LABEL_RESULTS: 20,
};
