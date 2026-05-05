import fs from "node:fs";

import { axios } from "@pipedream/platform";

import {
	GEMINI_API,
	PROPERTY_CATEGORIES,
	PROPERTY_CLASSIFIER_PROMPT,
} from "../common/constants.mjs";
import {
	aiClassifierConfidenceProp,
	aiClassifierEscalationModelProp,
	aiClassifierEscalationThresholdProp,
	aiClassifierModelProp,
	enableAiClassifierProp,
	geminiApiKeyProp,
} from "../common/props.mjs";
import {
	cleanupTempFile,
	createError,
	logWithEmoji,
} from "../common/utils.mjs";

const GEMINI_TIMEOUT_MS = 30_000;

export default {
	key: "gmail-image-processor-ai-content-classifier",
	name: "AI Content Classifier",
	description:
		"Classifies each image with a cheap Gemini model and escalates low-confidence decisions to a stronger model. Drops images that aren't property-listing-relevant.",
	version: "0.2.0",
	type: "action",

	props: {
		inputResult: {
			type: "object",
			label: "Input",
			description:
				"Result from the Vision Content Filter or Image Extractor",
		},
		enableAiClassifier: enableAiClassifierProp,
		geminiApiKey: geminiApiKeyProp,
		aiClassifierModel: aiClassifierModelProp,
		aiClassifierEscalationModel: aiClassifierEscalationModelProp,
		aiClassifierConfidence: aiClassifierConfidenceProp,
		aiClassifierEscalationThreshold: aiClassifierEscalationThresholdProp,
	},

	async run({ steps, $ }) {
		try {
			const data =
				this.inputResult ||
				steps.vision_content_filter?.filter_result ||
				steps.image_extractor?.extraction_result;

			if (!data) {
				throw createError("No input data provided");
			}

			const images = data.images || [];

			if (!this.enableAiClassifier || !this.geminiApiKey) {
				logWithEmoji(
					"info",
					"AI classifier disabled, passing through all images"
				);
				const passthrough = {
					...data,
					droppedByAi: [],
					aiStats: emptyAiStats(images.length),
					classifiedAt: new Date().toISOString(),
				};
				$.export("classifier_result", passthrough);
				return passthrough;
			}

			const primaryModel =
				this.aiClassifierModel || GEMINI_API.DEFAULT_PRIMARY_MODEL;
			const escalationModel = this.aiClassifierEscalationModel || "";
			const cascadeEnabled =
				escalationModel && escalationModel !== primaryModel;

			logWithEmoji(
				"start",
				`AI classifier: evaluating ${images.length} images with ${primaryModel}` +
					(cascadeEnabled
						? ` (escalating low-confidence to ${escalationModel})`
						: " (no escalation)")
			);

			const dropThreshold = parseFloat(this.aiClassifierConfidence) || 0.7;
			const escalationThreshold =
				parseFloat(this.aiClassifierEscalationThreshold) || 0.85;

			const { kept, dropped, stats } = await this.classifyAll(
				images,
				{
					primaryModel,
					escalationModel: cascadeEnabled ? escalationModel : null,
					dropThreshold,
					escalationThreshold,
				}
			);

			logWithEmoji(
				"vision",
				`AI classifier complete: ${kept.length} kept, ${dropped.length} dropped, ${stats.escalated} escalated, ${stats.errors} errors`
			);

			const result = {
				...data,
				images: kept,
				droppedByAi: dropped,
				aiStats: stats,
				classifiedAt: new Date().toISOString(),
			};

			$.export("classifier_result", result);
			return result;
		} catch (error) {
			logWithEmoji("error", `AI classifier failed: ${error.message}`);
			throw error;
		}
	},

	methods: {
		async classifyAll(images, config) {
			const stats = emptyAiStats(images.length);
			const kept = [];
			const dropped = [];

			for (const image of images) {
				const analysis = await this.classifyWithCascade(image, config, stats);

				if (!analysis) {
					// Total failure even after escalation — fail-safe keep.
					kept.push(image);
					stats.errors++;
					stats.kept++;
					continue;
				}

				stats.byCategory[analysis.category] =
					(stats.byCategory[analysis.category] || 0) + 1;

				const shouldDrop =
					!analysis.keep && analysis.confidence >= config.dropThreshold;

				if (shouldDrop) {
					logWithEmoji(
						"info",
						`Dropping ${image.filename} as ${analysis.category} (${(
							analysis.confidence * 100
						).toFixed(0)}%${analysis.escalated ? ", escalated" : ""}): ${
							analysis.reason
						}`
					);
					dropped.push({
						image,
						aiAnalysis: analysis,
						droppedAt: new Date().toISOString(),
					});
					await cleanupTempFile(image.filePath);
					stats.dropped++;
				} else {
					kept.push({
						...image,
						aiCategory: analysis.category,
						aiConfidence: analysis.confidence,
						aiReason: analysis.reason,
						aiEscalated: !!analysis.escalated,
					});
					stats.kept++;
				}
			}

			return { kept, dropped, stats };
		},

		async classifyWithCascade(image, config, stats) {
			// Pass 1: primary model
			let primaryAnalysis = null;
			let primaryError = null;
			try {
				primaryAnalysis = await this.classifyOne(image, config.primaryModel);
			} catch (error) {
				primaryError = error;
				logWithEmoji(
					"warn",
					`Primary classifier (${config.primaryModel}) failed for ${image.filename}: ${error.message}`
				);
			}

			const needsEscalation =
				config.escalationModel &&
				(primaryError ||
					primaryAnalysis.confidence < config.escalationThreshold);

			if (!needsEscalation) {
				return primaryAnalysis;
			}

			// Pass 2: escalation model
			try {
				const escalated = await this.classifyOne(
					image,
					config.escalationModel
				);
				stats.escalated++;
				return { ...escalated, escalated: true };
			} catch (escalationError) {
				logWithEmoji(
					"warn",
					`Escalation classifier (${config.escalationModel}) failed for ${image.filename}: ${escalationError.message}`
				);
				// If primary returned something, fall back to it; otherwise null.
				return primaryAnalysis;
			}
		},

		async classifyOne(image, model) {
			const buffer = await fs.promises.readFile(image.filePath);
			const base64 = buffer.toString("base64");

			const url = GEMINI_API.URL_TEMPLATE.replace("{MODEL}", model);

			const response = await axios(this, {
				method: "POST",
				url,
				params: { key: this.geminiApiKey },
				headers: { "Content-Type": "application/json" },
				timeout: GEMINI_TIMEOUT_MS,
				data: {
					contents: [
						{
							parts: [
								{ text: PROPERTY_CLASSIFIER_PROMPT },
								{
									inline_data: {
										mime_type: image.mimeType,
										data: base64,
									},
								},
							],
						},
					],
					generationConfig: {
						responseMimeType: "application/json",
						responseSchema: {
							type: "object",
							// Order chosen so the model commits to a category
							// first, then confidence, and writes the reason last
							// as a justification of those — produces tighter,
							// less hedgy reasons than reason-first ordering.
							propertyOrdering: ["category", "confidence", "reason"],
							properties: {
								category: {
									type: "string",
									enum: [
										...PROPERTY_CATEGORIES.KEEP,
										...PROPERTY_CATEGORIES.DROP,
									],
								},
								confidence: {
									type: "number",
									minimum: 0,
									maximum: 1,
								},
								reason: { type: "string", maxLength: 200 },
							},
							required: ["category", "confidence", "reason"],
						},
						temperature: 0.1,
					},
				},
			});

			const text = response?.candidates?.[0]?.content?.parts?.[0]?.text;
			if (!text) {
				throw createError("Empty response from Gemini", {
					filename: image.filename,
					model,
				});
			}

			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch (error) {
				throw createError(`Gemini returned non-JSON: ${error.message}`, {
					filename: image.filename,
					model,
					rawText: text.slice(0, 200),
				});
			}

			if (
				typeof parsed.confidence !== "number" ||
				typeof parsed.category !== "string"
			) {
				throw createError("Gemini response missing required fields", {
					filename: image.filename,
					model,
					parsed,
				});
			}

			// Derive `keep` from category set membership so the model can't
			// contradict itself. An unknown category (shouldn't happen — the
			// responseSchema enum constrains it) is treated as keep, matching
			// the pipeline's fail-safe-keep policy.
			const isDropCategory = PROPERTY_CATEGORIES.DROP.includes(
				parsed.category
			);
			parsed.keep = !isDropCategory;
			parsed.modelUsed = model;
			return parsed;
		},
	},
};

function emptyAiStats(total) {
	return {
		total,
		kept: 0,
		dropped: 0,
		escalated: 0,
		errors: 0,
		byCategory: {},
	};
}
