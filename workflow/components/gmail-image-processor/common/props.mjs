import { axios } from "@pipedream/platform";

export const emailProp = {
	type: "object",
	label: "Email Data",
	description: "Email data from Gmail trigger (e.g., steps.trigger.event)",
};

export const maxFileSizeProp = {
	type: "integer",
	label: "Max Image Size (MB)",
	description:
		"Maximum download size for a single image (loose attachment, Drive image, or embedded). PDFs and ZIP archives use Max Container Size instead.",
	default: 40,
	min: 1,
	max: 100,
};

export const maxContainerSizeProp = {
	type: "integer",
	label: "Max Container Size (MB)",
	description:
		"Maximum download size for a PDF or ZIP archive. These bundle many images, so they get a higher cap than individual images. ZIP extraction is streamed to disk and stays low-memory, but the download itself still buffers the whole archive — Gmail attachments arrive base64-encoded (~2.6x the file size held as a string), so a container near this cap can need the workflow's Memory raised toward 1 GB in Pipedream settings (default 256 MB).",
	default: 200,
	min: 1,
	max: 250,
	optional: true,
};

export const enablePdfExtractionProp = {
	type: "boolean",
	label: "Extract Images From PDFs",
	description:
		"Pull embedded photos out of PDF attachments and PDF Drive links (e.g. forwarded estate-agent brochures). Vector-only content like custom floor plans is not extracted.",
	default: true,
	optional: true,
};

export const maxPdfPagesProp = {
	type: "integer",
	label: "Max PDF Pages",
	description:
		"Hard cap on how many pages of a single PDF to scan for embedded images. Defends against catalog-sized PDFs blowing up Gemini cost.",
	default: 50,
	min: 1,
	max: 500,
	optional: true,
};

export const enableZipExtractionProp = {
	type: "boolean",
	label: "Extract Images From ZIP Files",
	description:
		"Unzip .zip attachments and ZIP Drive links and pull image files out of them. Non-image entries (including nested zips) are skipped.",
	default: true,
	optional: true,
};

export const enableVisionFilteringProp = {
	type: "boolean",
	label: "Enable Smart Image Filtering (Optional)",
	description:
		"Use Google Cloud Vision to filter out logos, icons, tracking pixels, and other non-content images",
	default: false,
	optional: true,
};

export const visionFilteringStrengthProp = {
	type: "string",
	label: "Filtering Strength",
	description: "How aggressively to filter non-content images",
	options: [
		{ label: "Conservative (High confidence only)", value: "conservative" },
		{ label: "Balanced (Recommended)", value: "balanced" },
		{ label: "Aggressive (Lower confidence threshold)", value: "aggressive" },
	],
	default: "balanced",
	optional: true,
};

export const skipTinyImagesProp = {
	type: "boolean",
	label: "Skip Tiny Images",
	description:
		"Automatically skip very small images (likely tracking pixels)",
	default: true,
	optional: true,
};

export const parentFolderIdProp = {
	type: "string",
	label: "Parent Folder",
	description:
		"Existing Google Drive folder to drop sender folders into. Leave blank for Drive root. Type to search.",
	optional: true,
	async options({ prevContext, query }) {
		const token = this.googleDrive?.$auth?.oauth_access_token;
		if (!token) {
			return [{
				label: "Connect Google Drive above to load folders",
				value: "",
			}];
		}

		let q = "mimeType='application/vnd.google-apps.folder' and trashed=false";
		if (query) {
			const safe = String(query).replace(/['\\]/g, "\\$&");
			q += ` and name contains '${safe}'`;
		}

		try {
			const response = await axios(this, {
				method: "GET",
				url: "https://www.googleapis.com/drive/v3/files",
				headers: { Authorization: `Bearer ${token}` },
				params: {
					q,
					fields: "nextPageToken, files(id, name)",
					pageSize: 100,
					orderBy: "name",
					supportsAllDrives: true,
					includeItemsFromAllDrives: true,
					corpora: "allDrives",
					...(prevContext?.nextPageToken
						? { pageToken: prevContext.nextPageToken }
						: {}),
				},
			});

			const folders = (response?.files || []).map((f) => ({
				label: f.name,
				value: f.id,
			}));

			const options = prevContext?.nextPageToken
				? folders
				: [{ label: "(Drive root — no parent)", value: "" }, ...folders];

			return {
				options,
				context: { nextPageToken: response?.nextPageToken || null },
			};
		} catch (error) {
			return [{
				label: `Error loading folders: ${error.message}`,
				value: "",
			}];
		}
	},
};

export const rootFolderNameProp = {
	type: "string",
	label: "Root Folder Name",
	description:
		"Name of the root folder to create (inside parent folder if specified)",
	default: "Gmail_Images",
	optional: true,
};

export const createRootFolderProp = {
	type: "boolean",
	label: "Create Root Folder",
	description: "Create a root folder to organize all sender folders",
	default: false,
	optional: true,
};

export const gmailApp = { type: "app", app: "gmail" };
export const googleDriveApp = { type: "app", app: "google_drive" };
export const googleCloudVisionApp = {
	type: "app",
	app: "google_cloud_vision_api",
	label: "Google Cloud Vision",
	description:
		"Connect your Google Cloud Vision account (required if filtering enabled)",
};

export const enableAiClassifierProp = {
	type: "boolean",
	label: "Enable AI Property Classifier",
	description:
		"Use Gemini to classify each image and drop ones that aren't property-listing-relevant (logos, food, documents, portraits, etc.)",
	default: false,
	optional: true,
};

export const geminiApiKeyProp = {
	type: "string",
	label: "Gemini API Key",
	description:
		"Google AI Studio API key — get one at https://aistudio.google.com/apikey. Only used if AI classifier is enabled.",
	secret: true,
	optional: true,
};

export const aiClassifierModelProp = {
	type: "string",
	label: "Primary Gemini Model",
	description:
		"Cheap fast model used for the first-pass classification of every image.",
	default: "gemini-2.5-flash",
	options: [
		{ label: "Gemini 2.5 Flash (cheap, fast — recommended)", value: "gemini-2.5-flash" },
		{ label: "Gemini 3.1 Pro (skip cascade, more expensive)", value: "gemini-3.1-pro-preview" },
	],
	optional: true,
};

export const aiClassifierEscalationModelProp = {
	type: "string",
	label: "Escalation Model",
	description:
		"More capable model used when the primary model is unsure. Set to the same value as the primary model (or empty) to disable escalation.",
	default: "gemini-3.1-pro-preview",
	options: [
		{ label: "Gemini 3.1 Pro (recommended)", value: "gemini-3.1-pro-preview" },
		{ label: "Gemini 2.5 Flash (no real escalation)", value: "gemini-2.5-flash" },
		{ label: "Disable escalation", value: "" },
	],
	optional: true,
};

export const aiClassifierConfidenceProp = {
	type: "string",
	label: "Drop Confidence Threshold",
	description:
		"Minimum confidence required to drop an image. Higher = more lenient (keeps more borderline images). 0.7 is a good default.",
	default: "0.7",
	optional: true,
};

export const aiClassifierEscalationThresholdProp = {
	type: "string",
	label: "Escalation Confidence Threshold",
	description:
		"If the primary model returns confidence below this value, re-run with the escalation model. 0.85 is a good default — escalates roughly the bottom 20% of decisions.",
	default: "0.85",
	optional: true,
};
