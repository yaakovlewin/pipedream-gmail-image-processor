export const FILE_SIZE = {
	BYTES_PER_MB: 1024 * 1024,
	UNITS: ["Bytes", "KB", "MB", "GB"],
	CONVERSION_FACTOR: 1024,
};

export const IMAGE_TYPES = [
	"image/jpeg",
	// non-standard, but real senders ship it
	"image/jpg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/bmp",
	"image/tiff",
	"image/svg+xml",
];

export const TEXT_MIME_TYPES = ["text/plain", "text/html"];

// Map of lower-case file extensions to the image MIME type we treat them as.
// Used for files pulled out of ZIP archives, which arrive as bare
// filenames + bytes with no MIME metadata of their own.
export const IMAGE_EXTENSIONS = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	tif: "image/tiff",
	tiff: "image/tiff",
	svg: "image/svg+xml",
};

export const PDF_MIME_TYPE = "application/pdf";

// Senders and Gmail are inconsistent about which of these a .zip part gets;
// some clients even ship application/octet-stream, so isZipMimeType() also
// falls back to the .zip filename extension.
export const ZIP_MIME_TYPES = [
	"application/zip",
	"application/x-zip-compressed",
	"application/x-zip",
	"multipart/x-zip",
];

export const ZIP_SETTINGS = {
	// Cap on how many image entries we'll extract from a single archive.
	MAX_FILES: 200,
	// Skip any single entry whose declared uncompressed size exceeds this —
	// defends against one pathologically large bitmap inside the archive.
	MAX_ENTRY_BYTES: 50 * 1024 * 1024,
	// Hard ceiling on total uncompressed bytes decompressed from one archive.
	// This is the real zip-bomb defense: fflate's filter refuses to inflate
	// any entry once this is hit, so a tiny .zip can't explode to gigabytes.
	MAX_TOTAL_BYTES: 500 * 1024 * 1024,
};

export const PDF_SETTINGS = {
	// Hard ceiling on pages we'll walk per PDF. A forwarded estate-agent
	// brochure is usually 5–30 pages; anything past this is almost always a
	// catalog and a cost trap for the downstream Gemini classifier.
	MAX_PAGES: 50,
	// Cap on images extracted per PDF to defend against pathological
	// PDFs that stuff hundreds of tiny image objects per page.
	MAX_EMBEDDED_IMAGES: 200,
};

// Drive these with String.prototype.matchAll(), not regex.exec() in a loop.
// matchAll requires the /g flag but clones the regex internally, so it does not
// share lastIndex across calls — safe for module-level reuse on Pipedream warm starts.
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
	// Required on every write/get so Drive resolves Shared Drive parents
	// (their IDs start with "0A"). Without it the API only sees My Drive.
	SHARED_DRIVE_PARAMS: {
		supportsAllDrives: true,
	},
	// Searches must additionally opt into items living in Shared Drives.
	SHARED_DRIVE_SEARCH_PARAMS: {
		supportsAllDrives: true,
		includeItemsFromAllDrives: true,
		corpora: "allDrives",
	},
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
		"utility",
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
- bedroom — bedroom, master suite, kids' room, bunk room
- kitchen — kitchen, kitchenette
- living — living room, lounge, family room, dining room or area, home office / workspace / study
- bathroom — bathroom, shower room, ensuite, powder room
- exterior — building outside, facade, entrance, driveway, street view of the property, exterior parking
- balcony — balcony, patio, deck, terrace, rooftop, veranda, outdoor seating
- garden — garden, yard, lawn, BBQ / outdoor kitchen, outdoor lounge area
- pool — pool, hot tub, jacuzzi, sauna, steam room
- view — outdoor scenery shot or view from a window of the property
- floor_plan — architectural floor plan or layout diagram
- aerial_or_map — aerial photo or neighborhood map
- staging_catalog — staged interior, furniture-catalog-style photo, 3D render or artist's impression, interior amenity space (gym, dining hall, lobby, spa), or stylized detail shots (fireplace, fixtures, decor)
- utility — hallway, entryway / foyer, stairs, closet / wardrobe / walk-in, laundry / utility room, interior garage, storage room

DROP categories (not part of a listing):
- logo — standalone company / brand logo, not overlaid on a real photo
- icon — UI icon, social media icon
- signature — email signature image
- food — close-up of a dish, meal, or plated food (an empty BBQ or outdoor kitchen is "garden", not "food")
- people_portrait — image whose subject is a person (headshot, group shot)
- document — scan of a document, ID, contract
- screenshot_text — screenshot of text, app UI, web page
- other — anything else not clearly a property listing photo

Edge cases (apply these before falling back to a DROP category):
- Person standing inside a real room: if the room is the focus, return the room category (bedroom / living / etc). Only use people_portrait when the person is genuinely the subject.
- Real listing photo with a small watermark or corner logo: return the room or exterior category. The logo category is for standalone logo images only.
- 3D render, artist's impression, or marketing collage of an interior: staging_catalog.
- Hallway, entryway, stairs, closet, laundry room, or interior garage: utility (these are real listing photos, not "other").
- Hot tub / jacuzzi / sauna: pool. Patio / deck / terrace / rooftop: balcony.
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
