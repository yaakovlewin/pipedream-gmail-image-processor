import {
	aiClassifierConfidenceProp,
	aiClassifierEscalationModelProp,
	aiClassifierEscalationThresholdProp,
	aiClassifierModelProp,
	emailProp,
	enableAiClassifierProp,
	enableVisionFilteringProp,
	geminiApiKeyProp,
	gmailApp,
	googleCloudVisionApp,
	googleDriveApp,
	maxFileSizeProp,
	skipTinyImagesProp,
	visionFilteringStrengthProp,
} from "../common/props.mjs";
import {
	createError,
	getEmailData,
	logProcessingStats,
	logWithEmoji,
	runAction,
	validateEmailData,
} from "../common/utils.mjs";

import AiContentClassifier from "./ai-content-classifier.mjs";
import EmailImageDetector from "./email-image-detector.mjs";
import ImageExtractor from "./image-extractor.mjs";
import VisionContentFilter from "./vision-content-filter.mjs";

export default {
	key: "gmail-image-processor-orchestrator",
	name: "Gmail Image Processor (Complete)",
	description:
		"Detects, extracts, vision-filters, and AI-classifies images from a Gmail email. Output is ready to upload to Drive.",
	version: "0.2.0",
	type: "action",

	props: {
		email: emailProp,
		maxFileSize: maxFileSizeProp,
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
		gmail: gmailApp,
		googleDrive: googleDriveApp,
	},

	async run({ steps, $ }) {
		const startTime = Date.now();

		try {
			const email = getEmailData(steps, this.email);
			if (!validateEmailData(email)) {
				throw createError("Invalid email data structure", { email });
			}

			logWithEmoji(
				"start",
				`Processing email: "${email.subject}" from ${email.from}`
			);

			const detectionResult = await this.detectImages(email);
			if (detectionResult.images.length === 0) {
				return this.createNoImagesResult(
					email,
					detectionResult.senderInfo
				);
			}

			const extractionResult = await this.extractImages(detectionResult);
			if (extractionResult.images.length === 0) {
				return this.createNoImagesResult(
					email,
					extractionResult.senderInfo,
					"No images could be extracted"
				);
			}

			const visionResult = await this.applyVisionFiltering(extractionResult);
			const aiResult = await this.applyAiClassifier(visionResult);

			const finalResult = this.createFinalResult(email, aiResult, startTime);
			this.logFinalStatistics(finalResult);

			$.export("processed_images", finalResult);
			return finalResult;
		} catch (error) {
			logWithEmoji("error", `Processing failed: ${error.message}`);
			throw error;
		}
	},

	methods: {
		async detectImages(email) {
			logWithEmoji("detection", "Starting image detection...");
			const result = await runAction(EmailImageDetector, {
				email,
				gmail: this.gmail,
				googleDrive: this.googleDrive,
			});
			logWithEmoji("detection", `Found ${result.images.length} images`);
			return result;
		},

		async extractImages(detectionResult) {
			logWithEmoji("extraction", "Starting image extraction...");
			const result = await runAction(ImageExtractor, {
				detectionResult,
				maxFileSize: this.maxFileSize,
				gmail: this.gmail,
				googleDrive: this.googleDrive,
			});
			logWithEmoji("extraction", `Extracted ${result.images.length} images`);
			return result;
		},

		// VisionContentFilter and AiContentClassifier both passthrough when
		// disabled (their `enable*` props gate the actual API calls), so we
		// delegate unconditionally and let them handle the no-op shape.
		async applyVisionFiltering(extractionResult) {
			logWithEmoji(
				"vision",
				this.enableVisionFiltering && this.googleCloudVision
					? "Starting Vision filtering..."
					: "Vision filtering disabled, passing through"
			);
			const result = await runAction(VisionContentFilter, {
				extractionResult,
				enableVisionFiltering: this.enableVisionFiltering,
				googleCloudVision: this.googleCloudVision,
				visionFilteringStrength: this.visionFilteringStrength,
				skipTinyImages: this.skipTinyImages,
			});
			logWithEmoji(
				"vision",
				`Vision filtering complete: ${result.images.length} kept, ${
					result.filtered?.length || 0
				} filtered`
			);
			return result;
		},

		async applyAiClassifier(visionResult) {
			logWithEmoji(
				"processing",
				this.enableAiClassifier && this.geminiApiKey
					? "Running AI property classifier..."
					: "AI classifier disabled, passing through"
			);
			const result = await runAction(AiContentClassifier, {
				inputResult: visionResult,
				enableAiClassifier: this.enableAiClassifier,
				geminiApiKey: this.geminiApiKey,
				aiClassifierModel: this.aiClassifierModel,
				aiClassifierEscalationModel: this.aiClassifierEscalationModel,
				aiClassifierConfidence: this.aiClassifierConfidence,
				aiClassifierEscalationThreshold:
					this.aiClassifierEscalationThreshold,
			});
			logWithEmoji(
				"processing",
				`AI classifier kept ${result.images.length}, dropped ${
					result.droppedByAi?.length || 0
				}`
			);
			return result;
		},

		createNoImagesResult(email, senderInfo, reason = "No images found") {
			logWithEmoji("complete", reason);
			return {
				emailId: email.id,
				subject: email.subject,
				senderInfo,
				images: [],
				skipped: true,
				reason,
				processedAt: new Date().toISOString(),
				totalImages: 0,
				processingStats: {
					totalDetected: 0,
					totalExtracted: 0,
					totalFiltered: 0,
					totalDroppedByAi: 0,
					finalCount: 0,
				},
			};
		},

		createFinalResult(email, finalStageResult, startTime) {
			const processingTime = Date.now() - startTime;

			const result = {
				emailId: email.id,
				subject: email.subject,
				senderInfo: finalStageResult.senderInfo,
				images: finalStageResult.images,
				processedAt: new Date().toISOString(),
				totalImages: finalStageResult.images.length,
				processingStats: {
					totalDetected:
						finalStageResult.stats?.totalDetected ||
						finalStageResult.images.length,
					totalExtracted:
						finalStageResult.stats?.totalExtracted ||
						finalStageResult.images.length,
					totalFiltered: finalStageResult.visionStats?.totalFiltered || 0,
					totalDroppedByAi: finalStageResult.aiStats?.dropped || 0,
					finalCount: finalStageResult.images.length,
					processingTimeMs: processingTime,
				},
			};

			if (this.enableVisionFiltering && this.googleCloudVision) {
				result.visionFiltering = {
					enabled: true,
					strength: this.visionFilteringStrength || "balanced",
					skipTinyImages: this.skipTinyImages || false,
				};
				if (finalStageResult.visionStats) {
					result.visionStats = finalStageResult.visionStats;
				}
				if (finalStageResult.filtered?.length > 0) {
					result.filteredImages = finalStageResult.filtered;
				}
			}

			if (this.enableAiClassifier && this.geminiApiKey) {
				result.aiClassifier = {
					enabled: true,
					primaryModel: this.aiClassifierModel,
					escalationModel: this.aiClassifierEscalationModel || null,
					confidenceThreshold:
						parseFloat(this.aiClassifierConfidence) || 0.7,
					escalationThreshold:
						parseFloat(this.aiClassifierEscalationThreshold) || 0.85,
				};
				if (finalStageResult.aiStats) {
					result.aiStats = finalStageResult.aiStats;
				}
				if (finalStageResult.droppedByAi?.length > 0) {
					result.droppedByAi = finalStageResult.droppedByAi;
				}
			}

			return result;
		},

		logFinalStatistics(result) {
			const stats = {
				"Email ID": result.emailId,
				Subject: result.subject,
				Sender: result.senderInfo.displayName,
				"Total Images": result.totalImages,
				"Processing Time": `${result.processingStats.processingTimeMs}ms`,
			};

			if (result.visionFiltering?.enabled) {
				stats["Vision Filtering"] = "Enabled";
				stats["Filtering Strength"] = result.visionFiltering.strength;
				if (result.visionStats) {
					stats["Images Filtered"] = result.visionStats.totalFiltered;
					stats["Logos Filtered"] = result.visionStats.logoCount;
					stats["Icons Filtered"] = result.visionStats.iconCount;
					stats["Tracking Pixels"] = result.visionStats.trackingPixelCount;
				}
			}

			if (result.aiClassifier?.enabled) {
				stats["AI Classifier"] = "Enabled";
				stats["AI Primary"] = result.aiClassifier.primaryModel;
				stats["AI Escalation"] =
					result.aiClassifier.escalationModel || "(none)";
				if (result.aiStats) {
					stats["AI Kept"] = result.aiStats.kept;
					stats["AI Dropped"] = result.aiStats.dropped;
					stats["AI Escalated"] = result.aiStats.escalated;
					stats["AI Errors"] = result.aiStats.errors;
				}
			}

			logProcessingStats(stats);
			logWithEmoji(
				"complete",
				`Processing complete! ${result.totalImages} images ready for use.`
			);
		},
	},
};
