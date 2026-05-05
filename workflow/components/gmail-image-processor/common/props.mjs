export const emailProp = {
	type: "object",
	label: "Email Data",
	description: "Email data from Gmail trigger (e.g., steps.trigger.event)",
};

export const maxFileSizeProp = {
	type: "integer",
	label: "Max File Size (MB)",
	description: "Maximum file size to download (in MB)",
	default: 25,
	min: 1,
	max: 100,
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
	label: "Parent Folder ID (Optional)",
	description:
		"ID of existing Google Drive folder to use as parent. Leave empty to use Drive root.",
	optional: true,
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
