import fs from "node:fs";

import { axios } from "@pipedream/platform";

import { VISION_API } from "../common/constants.mjs";
import {
	enableVisionFilteringProp,
	googleCloudVisionApp,
	skipTinyImagesProp,
	visionFilteringStrengthProp,
} from "../common/props.mjs";
import {
	createVisionFilteringStats,
	validateExtractedImage,
} from "../common/types.mjs";
import {
	categorizeNonContentType,
	cleanupTempFile,
	createError,
	getConfidenceThreshold,
	isPartialNonContentMatch,
	logWithEmoji,
} from "../common/utils.mjs";

const TINY_FILE_BYTES = 1000;

export default {
	key: "gmail-image-processor-vision-content-filter",
	name: "Vision Content Filter",
	description:
		"Uses Google Cloud Vision to filter out non-content images (logos, icons, tracking pixels)",
	version: "0.1.0",
	type: "action",

	props: {
		extractionResult: {
			type: "object",
			label: "Extraction Result",
			description: "Result from the Image Extractor component",
		},
		enableVisionFiltering: enableVisionFilteringProp,
		googleCloudVision: googleCloudVisionApp,
		visionFilteringStrength: visionFilteringStrengthProp,
		skipTinyImages: skipTinyImagesProp,
	},

	async run({ steps, $ }) {
		try {
			const extractionResult =
				this.extractionResult ||
				steps.image_extractor?.extraction_result;

			if (!extractionResult) {
				throw createError("No extraction result provided");
			}

			logWithEmoji(
				"start",
				`Filtering ${extractionResult.images.length} extracted images`
			);

			if (!this.enableVisionFiltering || !this.googleCloudVision) {
				logWithEmoji(
					"info",
					"Vision filtering disabled, returning all images"
				);
				const passthrough = {
					...extractionResult,
					filtered: [],
					visionStats: createVisionFilteringStats({
						totalDetected: extractionResult.images.length,
						totalExtracted: extractionResult.images.length,
						totalFiltered: 0,
					}),
					filteredAt: new Date().toISOString(),
				};
				$.export("filter_result", passthrough);
				return passthrough;
			}

			const filterResult = await this.applyVisionFiltering(
				extractionResult.images
			);

			logWithEmoji(
				"vision",
				`Vision filtering complete: ${filterResult.images.length} kept, ${filterResult.filtered.length} filtered`
			);

			const result = {
				emailId: extractionResult.emailId,
				subject: extractionResult.subject,
				senderInfo: extractionResult.senderInfo,
				images: filterResult.images,
				filtered: filterResult.filtered,
				extractedAt: extractionResult.extractedAt,
				filteredAt: new Date().toISOString(),
				visionStats: filterResult.stats,
				stats: {
					...extractionResult.stats,
					totalFiltered: filterResult.filtered.length,
					finalCount: filterResult.images.length,
				},
			};

			$.export("filter_result", result);
			return result;
		} catch (error) {
			logWithEmoji("error", `Vision filtering failed: ${error.message}`);
			throw error;
		}
	},

	methods: {
		async applyVisionFiltering(extractedImages) {
			const keptImages = [];
			const filteredImages = [];
			const stats = createVisionFilteringStats({
				totalDetected: extractedImages.length,
				totalExtracted: extractedImages.length,
			});

			for (const image of extractedImages) {
				try {
					if (!validateExtractedImage(image)) {
						logWithEmoji(
							"warn",
							`Invalid extracted image structure: ${image.filename}`
						);
						continue;
					}

					const analysis = await this.analyzeImage(
						image.filePath,
						image.filename
					);

					if (analysis.isLogoOrSignature) {
						filteredImages.push({
							image,
							visionAnalysis: analysis,
							filteredAt: new Date().toISOString(),
							reason: `Filtered as ${analysis.type}: ${analysis.description}`,
						});
						this.updateFilteringStats(stats, analysis.type);
						await cleanupTempFile(image.filePath);
					} else {
						keptImages.push(image);
					}
				} catch (error) {
					logWithEmoji(
						"error",
						`Error processing ${image.filename}: ${error.message}`
					);
					// Fail-safe: keep the image when analysis blows up.
					keptImages.push(image);
				}
			}

			stats.totalFiltered = filteredImages.length;

			return {
				images: keptImages,
				filtered: filteredImages,
				stats,
				filteredAt: new Date().toISOString(),
			};
		},

		async analyzeImage(imagePath, filename) {
			try {
				logWithEmoji(
					"vision",
					`Analyzing ${filename} for non-content images...`
				);

				if (this.skipTinyImages) {
					const tiny = await this.checkTinyFile(imagePath, filename);
					if (tiny) return tiny;
				}

				const base64Image = await this.readImageAsBase64(imagePath);
				const visionResponse = await this.callVisionAPI(base64Image);
				return this.processVisionResponse(visionResponse, filename);
			} catch (error) {
				logWithEmoji(
					"warn",
					`Vision API error for ${filename}: ${error.message}`
				);
				return { isLogoOrSignature: false, error: error.message };
			}
		},

		async checkTinyFile(imagePath, filename) {
			try {
				const { size } = await fs.promises.stat(imagePath);

				if (size < TINY_FILE_BYTES) {
					logWithEmoji(
						"info",
						`Skipping tiny file: ${filename} (${size} bytes)`
					);
					return {
						isLogoOrSignature: true,
						type: "tiny image",
						description: `Very small file (${size} bytes)`,
						confidence: 1.0,
					};
				}
			} catch (error) {
				logWithEmoji(
					"warn",
					`Could not check dimensions for ${filename}: ${error.message}`
				);
			}
			return null;
		},

		async readImageAsBase64(imagePath) {
			const buffer = await fs.promises.readFile(imagePath);
			return buffer.toString("base64");
		},

		// Errors propagate up to analyzeImage, whose catch returns
		// { isLogoOrSignature: false } so the image is kept (fail-safe).
		async callVisionAPI(base64Image) {
			return axios(this, {
				method: "POST",
				url: VISION_API.URL,
				headers: {
					Authorization: `Bearer ${this.googleCloudVision.$auth.oauth_access_token}`,
					"Content-Type": "application/json",
				},
				data: {
					requests: [
						{
							image: { content: base64Image },
							features: [
								{
									type: "LOGO_DETECTION",
									maxResults: VISION_API.MAX_LOGO_RESULTS,
								},
								{
									type: "LABEL_DETECTION",
									maxResults: VISION_API.MAX_LABEL_RESULTS,
								},
								{ type: "IMAGE_PROPERTIES", maxResults: 1 },
							],
						},
					],
				},
			});
		},

		processVisionResponse(visionResponse, filename) {
			const result = visionResponse?.responses?.[0];
			if (!result) {
				logWithEmoji(
					"warn",
					`Invalid Vision API response for ${filename}`
				);
				return {
					isLogoOrSignature: false,
					error: "Invalid Vision API response",
				};
			}

			if (result.error) {
				logWithEmoji(
					"warn",
					`Vision API error for ${filename}: ${
						result.error.message || "Unknown error"
					}`
				);
				return {
					isLogoOrSignature: false,
					error: result.error.message || "Vision API error",
				};
			}

			const logo = this.matchLogo(result);
			if (logo) return logo;

			return this.matchNonContentLabel(result) || { isLogoOrSignature: false };
		},

		matchLogo(result) {
			const top = result.logoAnnotations?.[0];
			if (!top) return null;
			logWithEmoji("info", `Logo detected: ${top.description}`);
			return {
				isLogoOrSignature: true,
				type: "logo",
				description: top.description,
				confidence: top.score,
			};
		},

		matchNonContentLabel(result) {
			if (!result.labelAnnotations) return null;

			const threshold = getConfidenceThreshold(this.visionFilteringStrength);

			for (const label of result.labelAnnotations) {
				const labelText = label.description.toLowerCase();
				const confidencePct = (label.score * 100).toFixed(1);

				if (
					VISION_API.NON_CONTENT_LABELS.includes(labelText) &&
					label.score >= threshold
				) {
					logWithEmoji(
						"info",
						`Skipping non-content image: ${label.description} (${confidencePct}% confidence)`
					);
					return {
						isLogoOrSignature: true,
						type: categorizeNonContentType(labelText),
						description: label.description,
						confidence: label.score,
					};
				}

				if (isPartialNonContentMatch(labelText, label.score, threshold)) {
					logWithEmoji(
						"info",
						`Skipping non-content image (partial match): ${label.description} (${confidencePct}% confidence)`
					);
					return {
						isLogoOrSignature: true,
						type: "non-content",
						description: label.description,
						confidence: label.score,
					};
				}
			}

			return null;
		},

		updateFilteringStats(stats, type) {
			switch (type) {
				case "logo":
				case "logo/brand":
					stats.logoCount++;
					break;
				case "icon":
					stats.iconCount++;
					break;
				case "tracking pixel":
				case "tiny image":
					stats.trackingPixelCount++;
					break;
				case "signature/footer":
					stats.signatureCount++;
					break;
				default:
					stats.otherCount++;
					break;
			}
		},
	},
};
