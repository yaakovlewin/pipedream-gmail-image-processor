import {
	aiClassifierConfidenceProp,
	aiClassifierEscalationModelProp,
	aiClassifierEscalationThresholdProp,
	aiClassifierModelProp,
	createRootFolderProp,
	emailProp,
	enableAiClassifierProp,
	enablePdfExtractionProp,
	enableVisionFilteringProp,
	enableZipExtractionProp,
	geminiApiKeyProp,
	gmailApp,
	googleCloudVisionApp,
	googleDriveApp,
	maxFileSizeProp,
	maxPdfPagesProp,
	parentFolderIdProp,
	rootFolderNameProp,
	skipTinyImagesProp,
	visionFilteringStrengthProp,
} from "../common/props.mjs";
import { logWithEmoji, runAction } from "../common/utils.mjs";

import AiContentClassifier from "./ai-content-classifier.mjs";
import DriveUploader from "./drive-uploader.mjs";
import EmailImageDetector from "./email-image-detector.mjs";
import ImageExtractor from "./image-extractor.mjs";
import VisionContentFilter from "./vision-content-filter.mjs";

export default {
	key: "gmail-image-processor-complete-workflow",
	name: "Complete Gmail to Drive Workflow",
	description:
		"Detects images in Gmail (attachments, Drive links, embedded, PDFs, ZIPs), filters with Vision and an AI property classifier, and uploads to Google Drive.",
	version: "0.9.0",
	type: "action",

	props: {
		email: emailProp,
		gmail: gmailApp,
		googleDrive: googleDriveApp,
		maxFileSize: maxFileSizeProp,
		enablePdfExtraction: enablePdfExtractionProp,
		maxPdfPages: maxPdfPagesProp,
		enableZipExtraction: enableZipExtractionProp,
		enableVisionFiltering: enableVisionFilteringProp,
		googleCloudVision: googleCloudVisionApp,
		visionFilteringStrength: visionFilteringStrengthProp,
		skipTinyImages: skipTinyImagesProp,
		enableAiClassifier: enableAiClassifierProp,
		geminiApiKey: geminiApiKeyProp,
		aiClassifierModel: aiClassifierModelProp,
		aiClassifierEscalationModel: aiClassifierEscalationModelProp,
		aiClassifierConfidence: aiClassifierConfidenceProp,
		aiClassifierEscalationThreshold: aiClassifierEscalationThresholdProp,
		parentFolderId: parentFolderIdProp,
		rootFolderName: rootFolderNameProp,
		createRootFolder: createRootFolderProp,
	},

	async run({ steps, $ }) {
		const startTime = Date.now();

		try {
			logWithEmoji("start", "Starting complete Gmail to Drive workflow");

			logWithEmoji("processing", "Step 1: Detecting images in email...");
			const detectionResult = await this.detectImages(steps);
			if (!detectionResult.images?.length) {
				return this.createNoImagesResult(detectionResult);
			}

			logWithEmoji("processing", "Step 2: Extracting images...");
			const extractionResult = await this.extractImages(detectionResult);
			if (!extractionResult.images?.length) {
				return this.createNoImagesResult(extractionResult);
			}

			logWithEmoji(
				"processing",
				this.enableVisionFiltering && this.googleCloudVision
					? "Step 3: Vision filtering..."
					: "Step 3: Vision filtering disabled, passing through"
			);
			let pipeline = await this.applyVisionFiltering(extractionResult);
			if (!pipeline.images?.length) {
				return this.createNoImagesResult(
					pipeline,
					"All images were filtered out by Vision"
				);
			}

			logWithEmoji(
				"processing",
				this.enableAiClassifier && this.geminiApiKey
					? "Step 4: AI property classifier..."
					: "Step 4: AI classifier disabled, passing through"
			);
			pipeline = await this.applyAiClassifier(pipeline);
			if (!pipeline.images?.length) {
				return this.createNoImagesResult(
					pipeline,
					"All images were dropped by the AI classifier"
				);
			}

			logWithEmoji("processing", "Step 5: Uploading to Google Drive...");
			const uploadResult = await this.uploadToDrive(pipeline);

			const finalResult = this.createFinalResult(
				pipeline,
				uploadResult,
				startTime
			);

			logWithEmoji(
				"complete",
				`Workflow complete: ${uploadResult.summary.successfulUploads} images uploaded`
			);

			$.export("workflow_result", finalResult);
			return finalResult;
		} catch (error) {
			logWithEmoji("error", `Workflow failed: ${error.message}`);
			throw error;
		}
	},

	methods: {
		async detectImages(steps) {
			// Detector falls back to steps.trigger.event when this.email isn't
			// passed, so we forward the live `steps` arg here.
			return runAction(
				EmailImageDetector,
				{
					email: this.email,
					gmail: this.gmail,
					googleDrive: this.googleDrive,
				},
				{ steps, $: { export: () => {} } }
			);
		},

		async extractImages(detectionResult) {
			return runAction(ImageExtractor, {
				detectionResult,
				gmail: this.gmail,
				googleDrive: this.googleDrive,
				maxFileSize: this.maxFileSize,
				enablePdfExtraction: this.enablePdfExtraction,
				maxPdfPages: this.maxPdfPages,
				enableZipExtraction: this.enableZipExtraction,
			});
		},

		async applyVisionFiltering(extractionResult) {
			return runAction(VisionContentFilter, {
				extractionResult,
				enableVisionFiltering: this.enableVisionFiltering,
				googleCloudVision: this.googleCloudVision,
				visionFilteringStrength: this.visionFilteringStrength,
				skipTinyImages: this.skipTinyImages,
			});
		},

		async applyAiClassifier(inputResult) {
			return runAction(AiContentClassifier, {
				inputResult,
				enableAiClassifier: this.enableAiClassifier,
				geminiApiKey: this.geminiApiKey,
				aiClassifierModel: this.aiClassifierModel,
				aiClassifierEscalationModel: this.aiClassifierEscalationModel,
				aiClassifierConfidence: this.aiClassifierConfidence,
				aiClassifierEscalationThreshold:
					this.aiClassifierEscalationThreshold,
			});
		},

		async uploadToDrive(processedResult) {
			return runAction(DriveUploader, {
				processedImages: processedResult,
				googleDrive: this.googleDrive,
				parentFolderId: this.parentFolderId,
				rootFolderName: this.rootFolderName,
				createRootFolder: this.createRootFolder,
			});
		},

		createNoImagesResult(data, reason = "No images found") {
			logWithEmoji("info", reason);
			return {
				emailId: data.emailId,
				subject: data.subject,
				senderInfo: data.senderInfo,
				skipped: true,
				reason,
				processedAt: new Date().toISOString(),
				workflow: {
					completed: true,
					totalSteps: 5,
				},
			};
		},

		createFinalResult(processedResult, uploadResult, startTime) {
			const processingTime = Date.now() - startTime;

			return {
				emailId: processedResult.emailId,
				subject: processedResult.subject,
				senderInfo: processedResult.senderInfo,
				processedAt: new Date().toISOString(),

				images: processedResult.images,
				totalImages: processedResult.images.length,

				visionFiltering: this.enableVisionFiltering
					? {
							enabled: true,
							strength: this.visionFilteringStrength || "balanced",
							skipTinyImages: this.skipTinyImages || false,
							stats: processedResult.visionStats || null,
							filtered: processedResult.filtered || [],
					  }
					: { enabled: false },

				aiClassifier: this.enableAiClassifier
					? {
							enabled: true,
							primaryModel: this.aiClassifierModel,
							escalationModel: this.aiClassifierEscalationModel || null,
							confidenceThreshold:
								parseFloat(this.aiClassifierConfidence) || 0.7,
							escalationThreshold:
								parseFloat(this.aiClassifierEscalationThreshold) || 0.85,
							stats: processedResult.aiStats || null,
							dropped: processedResult.droppedByAi || [],
					  }
					: { enabled: false },

				driveUpload: {
					folder: uploadResult.folder,
					summary: uploadResult.summary,
					uploads: uploadResult.uploads,
				},

				workflow: {
					completed: true,
					totalSteps: 5,
					processingTimeMs: processingTime,
					stages: [
						{ name: "Image Detection", completed: true },
						{ name: "Image Extraction", completed: true },
						{
							name: "Vision Filtering",
							completed: !!this.enableVisionFiltering,
						},
						{
							name: "AI Classifier",
							completed: !!this.enableAiClassifier,
						},
						{ name: "Drive Upload", completed: true },
					],
				},

				statistics: {
					totalDetected: processedResult.stats?.totalDetected || 0,
					totalExtracted: processedResult.stats?.totalExtracted || 0,
					totalFiltered: processedResult.visionStats?.totalFiltered || 0,
					totalDroppedByAi: processedResult.aiStats?.dropped || 0,
					totalUploaded: uploadResult.summary.successfulUploads,
					totalFailed: uploadResult.summary.failedUploads,
					successRate: uploadResult.summary.successRate,
					totalSizeUploaded: uploadResult.summary.totalSizeUploaded,
					processingTimeMs: processingTime,
				},
			};
		},
	},
};
