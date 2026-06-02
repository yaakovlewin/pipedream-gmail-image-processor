import fs from "node:fs";

import { axios } from "@pipedream/platform";

import {
	DRIVE_API,
	GMAIL_API,
	PDF_SETTINGS,
	ZIP_SETTINGS,
} from "../common/constants.mjs";
import {
	enablePdfExtractionProp,
	enableZipExtractionProp,
	gmailApp,
	googleDriveApp,
	maxFileSizeProp,
	maxPdfPagesProp,
} from "../common/props.mjs";
import { validateDetectedImage, validateSenderInfo } from "../common/types.mjs";
import {
	cleanupTempFile,
	createError,
	createTempFilePath,
	exceedsMaxSize,
	formatFileSize,
	generatePdfPageFilename,
	generateZipEntryFilename,
	imageMimeFromFilename,
	isImageFilename,
	logWithEmoji,
} from "../common/utils.mjs";

// pdfjs-dist is loaded lazily so the rest of the pipeline still works if a
// deployment doesn't have it installed (e.g. older registry version). Cached
// at module scope to survive Pipedream warm starts.
let pdfjsLibPromise = null;
async function loadPdfjs() {
	if (!pdfjsLibPromise) {
		pdfjsLibPromise = (async () => {
			// The "legacy" build is the Node-compatible one — it doesn't
			// reach for DOM APIs and runs without a worker.
			const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
			if (lib.GlobalWorkerOptions) {
				lib.GlobalWorkerOptions.workerSrc = "";
			}
			return lib;
		})();
	}
	return pdfjsLibPromise;
}

// fflate is loaded lazily and cached at module scope, mirroring pdfjs above —
// keeps the rest of the pipeline working on a deployment that predates the dep
// and avoids paying the import cost when no ZIP is present.
let fflatePromise = null;
async function loadFflate() {
	if (!fflatePromise) {
		fflatePromise = import("fflate");
	}
	return fflatePromise;
}

export default {
	key: "gmail-image-processor-image-extractor",
	name: "Image Extractor",
	description:
		"Downloads and extracts detected images from Gmail attachments, Google Drive, PDFs, and ZIP archives",
	version: "0.3.0",
	type: "action",

	props: {
		detectionResult: {
			type: "object",
			label: "Detection Result",
			description: "Result from the Email Image Detector component",
		},
		maxFileSize: maxFileSizeProp,
		enablePdfExtraction: enablePdfExtractionProp,
		maxPdfPages: maxPdfPagesProp,
		enableZipExtraction: enableZipExtractionProp,
		gmail: gmailApp,
		googleDrive: googleDriveApp,
	},

	async run({ steps, $ }) {
		try {
			const detectionResult =
				this.detectionResult ||
				steps.email_image_detector?.detection_result;

			if (!detectionResult) {
				throw createError("No detection result provided");
			}
			if (!validateSenderInfo(detectionResult.senderInfo)) {
				throw createError("Invalid sender info in detection result");
			}

			logWithEmoji(
				"start",
				`Extracting ${detectionResult.images.length} detected images`
			);

			const { extractedImages, processedCount, pdfStats, zipStats } =
				await this.extractAllImages(
					detectionResult.images,
					detectionResult.emailId
				);

			logWithEmoji(
				"extraction",
				`Successfully extracted ${extractedImages.length} images`
			);

			const result = {
				emailId: detectionResult.emailId,
				subject: detectionResult.subject,
				senderInfo: detectionResult.senderInfo,
				images: extractedImages,
				extractedAt: new Date().toISOString(),
				stats: {
					totalDetected: detectionResult.images.length,
					totalExtracted: extractedImages.length,
					// "skipped" counts detected items that failed to extract, not
					// per-image — so a PDF that explodes into 30 pages still
					// counts as 1 success here.
					skipped: detectionResult.images.length - processedCount,
					attachments: extractedImages.filter(
						(img) => img.type === "attachment"
					).length,
					driveLinks: extractedImages.filter(
						(img) => img.type === "drive_link"
					).length,
					embedded: extractedImages.filter(
						(img) => img.type === "embedded"
					).length,
					pdfPages: extractedImages.filter(
						(img) => img.type === "pdf_page"
					).length,
					zipEntries: extractedImages.filter(
						(img) => img.type === "zip_entry"
					).length,
					...pdfStats,
					...zipStats,
				},
			};

			$.export("extraction_result", result);
			return result;
		} catch (error) {
			logWithEmoji("error", `Image extraction failed: ${error.message}`);
			throw error;
		}
	},

	methods: {
		async extractAllImages(detectedImages, emailId) {
			const extractedImages = [];
			let processedCount = 0;
			const pdfStats = {
				pdfsProcessed: 0,
				pdfsSkipped: 0,
				pdfImagesSkippedNonJpeg: 0,
			};
			const zipStats = {
				zipsProcessed: 0,
				zipsSkipped: 0,
				zipEntriesSkippedNonImage: 0,
				zipEntriesSkippedTooLarge: 0,
			};

			for (const image of detectedImages) {
				const extracted = await this.processDetectedImage(
					image,
					emailId,
					pdfStats,
					zipStats
				);
				if (extracted == null) continue;

				processedCount++;
				if (Array.isArray(extracted)) {
					extractedImages.push(...extracted);
				} else {
					extractedImages.push(extracted);
				}
			}
			return { extractedImages, processedCount, pdfStats, zipStats };
		},

		async processDetectedImage(image, emailId, pdfStats, zipStats) {
			try {
				if (!validateDetectedImage(image)) {
					logWithEmoji(
						"warn",
						`Invalid image data structure: ${image.filename}`
					);
					return null;
				}

				if (image.type === "pdf") {
					return this.processPdf(image, emailId, pdfStats);
				}

				if (image.type === "zip") {
					return this.processZip(image, emailId, zipStats);
				}

				logWithEmoji("processing", `Processing: ${image.filename}`);

				if (exceedsMaxSize(image.size, this.maxFileSize)) {
					logWithEmoji(
						"warn",
						`Skipping large file: ${image.filename} (${formatFileSize(
							image.size
						)})`
					);
					return null;
				}

				const downloaded = await this.downloadImage(image, emailId);
				if (!downloaded) return null;

				// Drop base64Data once it's written to disk — keeping it in the
				// pipeline payload bloats logs and downstream JSON.
				const { base64Data: _b64, ...rest } = image;
				return {
					...rest,
					filePath: downloaded.filePath,
					extractedAt: new Date().toISOString(),
				};
			} catch (error) {
				logWithEmoji(
					"error",
					`Failed to extract ${image.filename}: ${error.message}`
				);
				return null;
			}
		},

		async processPdf(image, emailId, pdfStats) {
			if (this.enablePdfExtraction === false) {
				logWithEmoji(
					"info",
					`PDF extraction disabled — skipping ${image.filename}`
				);
				return null;
			}

			if (exceedsMaxSize(image.size, this.maxFileSize)) {
				logWithEmoji(
					"warn",
					`Skipping large PDF: ${image.filename} (${formatFileSize(
						image.size
					)})`
				);
				pdfStats.pdfsSkipped++;
				return null;
			}

			logWithEmoji("processing", `Extracting images from PDF: ${image.filename}`);

			const pdfTempPath = await this.downloadPdfToTemp(image, emailId);
			if (!pdfTempPath) {
				pdfStats.pdfsSkipped++;
				return null;
			}

			try {
				const pages = await this.extractPdfImages(
					pdfTempPath,
					image.filename,
					pdfStats
				);
				if (pages.length === 0) {
					logWithEmoji(
						"warn",
						`No embedded JPEG images found in ${image.filename}`
					);
					pdfStats.pdfsSkipped++;
					return null;
				}
				pdfStats.pdfsProcessed++;
				logWithEmoji(
					"extraction",
					`Pulled ${pages.length} images from ${image.filename}`
				);
				return pages;
			} catch (error) {
				logWithEmoji(
					"error",
					`PDF extraction failed for ${image.filename}: ${error.message}`
				);
				pdfStats.pdfsSkipped++;
				return null;
			} finally {
				await cleanupTempFile(pdfTempPath);
			}
		},

		async downloadPdfToTemp(image, emailId) {
			if (image.type !== "pdf") return null;
			if (image.attachmentId) {
				const downloaded = await this.downloadGmailAttachment(
					emailId,
					image.attachmentId,
					image.filename
				);
				return downloaded?.filePath || null;
			}
			if (image.fileId) {
				const downloaded = await this.downloadDriveFile(
					image.fileId,
					image.filename
				);
				return downloaded?.filePath || null;
			}
			return null;
		},

		// Walk a downloaded PDF and yield one ExtractedImage per embedded
		// JPEG. Non-JPEG image objects (raw RGBA bitmaps, masks) are skipped
		// — encoding those would require a PNG encoder dep we don't ship.
		// In practice estate-agent brochures embed photos as JPEG so this
		// is fine; floor plans drawn as PDF vectors won't be recovered.
		async extractPdfImages(pdfFilePath, pdfFilename, pdfStats) {
			const pdfjsLib = await loadPdfjs();
			const data = new Uint8Array(await fs.promises.readFile(pdfFilePath));

			const loadingTask = pdfjsLib.getDocument({
				data,
				// pdf.js logs a stern warning otherwise when running in Node.
				useSystemFonts: true,
				// We never need fonts or rendering — speeds up parsing.
				disableFontFace: true,
				isEvalSupported: false,
			});

			let pdfDoc;
			try {
				pdfDoc = await loadingTask.promise;
			} catch (error) {
				if (error?.name === "PasswordException") {
					logWithEmoji(
						"warn",
						`PDF is password-protected, skipping: ${pdfFilename}`
					);
					return [];
				}
				throw error;
			}

			const maxPages = Math.min(
				pdfDoc.numPages,
				this.maxPdfPages || PDF_SETTINGS.MAX_PAGES
			);
			if (pdfDoc.numPages > maxPages) {
				logWithEmoji(
					"warn",
					`PDF ${pdfFilename} has ${pdfDoc.numPages} pages — capping at ${maxPages}`
				);
			}

			const extracted = [];
			for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
				if (extracted.length >= PDF_SETTINGS.MAX_EMBEDDED_IMAGES) {
					logWithEmoji(
						"warn",
						`Hit per-PDF image cap (${PDF_SETTINGS.MAX_EMBEDDED_IMAGES}) on ${pdfFilename}`
					);
					break;
				}
				try {
					const pageImages = await this.extractImagesFromPage(
						pdfDoc,
						pageNum,
						pdfFilename,
						pdfStats
					);
					extracted.push(...pageImages);
				} catch (error) {
					logWithEmoji(
						"warn",
						`Failed to scan page ${pageNum} of ${pdfFilename}: ${error.message}`
					);
				}
			}

			await pdfDoc.cleanup();
			await pdfDoc.destroy();
			return extracted;
		},

		async extractImagesFromPage(pdfDoc, pageNum, pdfFilename, pdfStats) {
			const pdfjsLib = await loadPdfjs();
			const OPS = pdfjsLib.OPS;
			const page = await pdfDoc.getPage(pageNum);
			try {
				const ops = await page.getOperatorList();
				const { fnArray, argsArray } = ops;

				// Image-paint ops vary between pdf.js versions; we look at every
				// op whose name matches and check the actual object for JPEG bytes.
				const imageOps = new Set(
					[
						OPS.paintImageXObject,
						OPS.paintJpegXObject,
						OPS.paintInlineImageXObject,
						OPS.paintImageMaskXObject,
					].filter((op) => typeof op === "number")
				);

				const seenNames = new Set();
				const out = [];
				let imageIndexOnPage = 0;

				for (let i = 0; i < fnArray.length; i++) {
					if (!imageOps.has(fnArray[i])) continue;
					const args = argsArray[i] || [];
					const ref = typeof args[0] === "string" ? args[0] : null;
					if (!ref || seenNames.has(ref)) continue;
					seenNames.add(ref);

					const img = await this.resolvePdfImage(page, ref);
					if (!img || !img.data) continue;

					const bytes =
						img.data instanceof Uint8Array
							? img.data
							: new Uint8Array(img.data);
					if (!this.looksLikeJpeg(bytes)) {
						pdfStats.pdfImagesSkippedNonJpeg++;
						continue;
					}

					imageIndexOnPage++;
					const filename = generatePdfPageFilename(
						pdfFilename,
						pageNum,
						imageIndexOnPage,
						"image/jpeg"
					);
					const tmpPath = createTempFilePath(filename, "pdf_");
					await fs.promises.writeFile(tmpPath, Buffer.from(bytes));

					out.push({
						type: "pdf_page",
						filename,
						mimeType: "image/jpeg",
						size: bytes.length,
						filePath: tmpPath,
						pdfSource: pdfFilename,
						pageNumber: pageNum,
						pdfImageIndex: imageIndexOnPage,
						extractedAt: new Date().toISOString(),
					});
				}

				return out;
			} finally {
				page.cleanup();
			}
		},

		// pdf.js stores rendered image data either on the page's local objs
		// (per-page images) or commonObjs (shared across pages). Both expose
		// an async callback API plus a sync `get` that throws if the object
		// isn't resolved yet, so we try sync-then-async on each.
		async resolvePdfImage(page, ref) {
			const stores = [page.objs, page.commonObjs];
			for (const store of stores) {
				if (!store) continue;
				try {
					if (typeof store.has === "function" && store.has(ref)) {
						return store.get(ref);
					}
				} catch {
					// fall through to async path
				}
				try {
					const img = await new Promise((resolve, reject) => {
						const timer = setTimeout(
							() => reject(new Error("timeout")),
							5000
						);
						store.get(ref, (obj) => {
							clearTimeout(timer);
							resolve(obj);
						});
					});
					if (img) return img;
				} catch {
					// try the next store
				}
			}
			return null;
		},

		looksLikeJpeg(bytes) {
			return (
				bytes.length >= 3 &&
				bytes[0] === 0xff &&
				bytes[1] === 0xd8 &&
				bytes[2] === 0xff
			);
		},

		async processZip(image, emailId, zipStats) {
			if (this.enableZipExtraction === false) {
				logWithEmoji(
					"info",
					`ZIP extraction disabled — skipping ${image.filename}`
				);
				return null;
			}

			// maxFileSize guards the compressed archive; the uncompressed
			// expansion is bounded separately by ZIP_SETTINGS in extractZipImages.
			if (exceedsMaxSize(image.size, this.maxFileSize)) {
				logWithEmoji(
					"warn",
					`Skipping large ZIP: ${image.filename} (${formatFileSize(
						image.size
					)})`
				);
				zipStats.zipsSkipped++;
				return null;
			}

			logWithEmoji(
				"processing",
				`Extracting images from ZIP: ${image.filename}`
			);

			const zipTempPath = await this.downloadZipToTemp(image, emailId);
			if (!zipTempPath) {
				zipStats.zipsSkipped++;
				return null;
			}

			try {
				const entries = await this.extractZipImages(
					zipTempPath,
					image.filename,
					zipStats
				);
				if (entries.length === 0) {
					logWithEmoji(
						"warn",
						`No image files found in ${image.filename}`
					);
					zipStats.zipsSkipped++;
					return null;
				}
				zipStats.zipsProcessed++;
				logWithEmoji(
					"extraction",
					`Pulled ${entries.length} images from ${image.filename}`
				);
				return entries;
			} catch (error) {
				logWithEmoji(
					"error",
					`ZIP extraction failed for ${image.filename}: ${error.message}`
				);
				zipStats.zipsSkipped++;
				return null;
			} finally {
				await cleanupTempFile(zipTempPath);
			}
		},

		async downloadZipToTemp(image, emailId) {
			if (image.type !== "zip") return null;
			if (image.attachmentId) {
				const downloaded = await this.downloadGmailAttachment(
					emailId,
					image.attachmentId,
					image.filename
				);
				return downloaded?.filePath || null;
			}
			if (image.fileId) {
				const downloaded = await this.downloadDriveFile(
					image.fileId,
					image.filename
				);
				return downloaded?.filePath || null;
			}
			return null;
		},

		// Unzip a downloaded archive and yield one ExtractedImage per image
		// entry. fflate's `filter` is the load-bearing guard here: returning
		// false skips decompression of that entry entirely, so the count /
		// per-entry / total-size caps are enforced *before* bytes are inflated
		// — a small zip-bomb can't blow up memory or disk. Non-image entries
		// (including nested zips, which aren't image extensions) are skipped.
		async extractZipImages(zipFilePath, zipFilename, zipStats) {
			const { unzipSync } = await loadFflate();
			const data = new Uint8Array(await fs.promises.readFile(zipFilePath));

			let entryCount = 0;
			let totalUncompressed = 0;
			let skippedNonImage = 0;
			let skippedTooLarge = 0;
			let cappedFiles = false;
			let cappedBytes = false;

			const filter = (file) => {
				// Directory markers carry no data.
				if (file.name.endsWith("/")) return false;
				if (!isImageFilename(file.name)) {
					skippedNonImage++;
					return false;
				}
				if (file.originalSize > ZIP_SETTINGS.MAX_ENTRY_BYTES) {
					skippedTooLarge++;
					return false;
				}
				if (entryCount >= ZIP_SETTINGS.MAX_FILES) {
					cappedFiles = true;
					return false;
				}
				if (
					totalUncompressed + file.originalSize >
					ZIP_SETTINGS.MAX_TOTAL_BYTES
				) {
					cappedBytes = true;
					return false;
				}
				entryCount++;
				totalUncompressed += file.originalSize;
				return true;
			};

			let unzipped;
			try {
				unzipped = unzipSync(data, { filter });
			} catch (error) {
				logWithEmoji(
					"warn",
					`Could not unzip ${zipFilename}: ${error.message}`
				);
				return [];
			}

			if (cappedFiles) {
				logWithEmoji(
					"warn",
					`Hit per-archive file cap (${ZIP_SETTINGS.MAX_FILES}) on ${zipFilename} — remaining entries skipped`
				);
			}
			if (cappedBytes) {
				logWithEmoji(
					"warn",
					`Hit per-archive size cap on ${zipFilename} — remaining entries skipped`
				);
			}
			zipStats.zipEntriesSkippedNonImage += skippedNonImage;
			zipStats.zipEntriesSkippedTooLarge += skippedTooLarge;

			const out = [];
			let imageIndex = 0;
			for (const [entryName, bytes] of Object.entries(unzipped)) {
				if (!bytes || bytes.length === 0) continue;
				imageIndex++;
				const mimeType = imageMimeFromFilename(entryName);
				const filename = generateZipEntryFilename(zipFilename, entryName);
				// createTempFilePath sanitizes the name, so the entry path can
				// never traverse out of /tmp (zip-slip).
				const tmpPath = createTempFilePath(filename, "zip_");
				await fs.promises.writeFile(tmpPath, Buffer.from(bytes));

				out.push({
					type: "zip_entry",
					filename,
					mimeType,
					size: bytes.length,
					filePath: tmpPath,
					zipSource: zipFilename,
					zipEntryName: entryName,
					zipEntryIndex: imageIndex,
					extractedAt: new Date().toISOString(),
				});
			}
			return out;
		},

		async downloadImage(image, emailId) {
			if (image.type === "attachment") {
				return this.downloadGmailAttachment(
					emailId,
					image.attachmentId,
					image.filename
				);
			}
			if (image.type === "drive_link") {
				return this.downloadDriveFile(image.fileId, image.filename);
			}
			if (image.type === "embedded") {
				return this.writeEmbeddedImage(image.base64Data, image.filename);
			}
			return null;
		},

		async writeEmbeddedImage(base64Data, filename) {
			try {
				const tmpFilePath = createTempFilePath(filename, "embedded_");
				const buffer = Buffer.from(base64Data, "base64");
				await fs.promises.writeFile(tmpFilePath, buffer);
				return { filePath: tmpFilePath, size: buffer.length };
			} catch (error) {
				throw createError(
					`Failed to write embedded image: ${error.message}`,
					{ filename }
				);
			}
		},

		async downloadGmailAttachment(messageId, attachmentId, filename) {
			try {
				const tmpFilePath = createTempFilePath(filename);
				const response = await axios(this, {
					url: `${GMAIL_API.BASE_URL}/messages/${messageId}/attachments/${attachmentId}`,
					headers: {
						Authorization: `Bearer ${this.gmail.$auth.oauth_access_token}`,
					},
				});

				if (!response.data) return null;

				const imageBuffer = Buffer.from(response.data, "base64");
				await fs.promises.writeFile(tmpFilePath, imageBuffer);
				return { filePath: tmpFilePath, size: imageBuffer.length };
			} catch (error) {
				throw createError(
					`Failed to download Gmail attachment: ${error.message}`,
					{ messageId, attachmentId, filename }
				);
			}
		},

		async downloadDriveFile(fileId, filename) {
			try {
				const tmpFilePath = createTempFilePath(filename, "drive_");

				// alt=media returns raw bytes. responseType "arraybuffer" gives us
				// a Buffer instead of letting the platform try to JSON-parse binary.
				const response = await axios(this, {
					method: "GET",
					url: `${DRIVE_API.BASE_URL}/files/${fileId}`,
					headers: {
						Authorization: `Bearer ${this.googleDrive.$auth.oauth_access_token}`,
					},
					params: {
						alt: "media",
						supportsAllDrives: true,
					},
					responseType: "arraybuffer",
				});

				const imageBuffer = Buffer.isBuffer(response)
					? response
					: Buffer.from(response);
				await fs.promises.writeFile(tmpFilePath, imageBuffer);
				return { filePath: tmpFilePath, size: imageBuffer.length };
			} catch (error) {
				throw createError(
					`Failed to download Drive file: ${error.message}`,
					{ fileId, filename }
				);
			}
		},
	},
};
