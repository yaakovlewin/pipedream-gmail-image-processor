# Gmail Image Processor

Modular Pipedream actions that pull images out of Gmail messages (attachments, Drive links, embedded base64, PDFs, ZIP archives), filter junk via Cloud Vision and an AI property classifier, then upload the survivors to sender-named folders in Google Drive.

## Layout

```
gmail-image-processor/
├── common/
│   ├── constants.mjs    # API endpoints, MIME types, vision/property thresholds
│   ├── props.mjs        # Shared Pipedream prop definitions
│   ├── types.mjs        # JSDoc shapes + runtime validators / constructors
│   └── utils.mjs        # Logging, parsing, file ops, runAction helper
└── actions/
    ├── email-image-detector.mjs           # Stage 1
    ├── image-extractor.mjs                # Stage 2
    ├── vision-content-filter.mjs          # Stage 3 (optional)
    ├── ai-content-classifier.mjs          # Stage 4 (optional)
    ├── drive-uploader.mjs                 # Stage 5
    ├── image-processor-orchestrator.mjs   # Stages 1–4 chained
    └── complete-workflow-orchestrator.mjs # Stages 1–5 chained — recommended
```

## Pipeline

```
Gmail trigger
    ↓
email-image-detector       attachments + Drive links + embedded base64 + PDFs + ZIPs
    ↓
image-extractor            downloads / decodes to temp files; PDFs explode into pdf_page images, ZIPs into zip_entry images
    ↓
vision-content-filter      cheap pre-filter — kills tiny files, logos, tracking pixels (optional)
    ↓
ai-content-classifier      Gemini judges property-relevance, drops by category (optional)
    ↓
drive-uploader             creates sender folder, uploads survivors with category metadata
```

The two filters compose: Vision is cheap and catches obvious junk (sub-1KB tracking pixels, logo-detection hits) before the AI classifier — which costs more per image but understands "is this a property listing photo" — has to look at it. Either filter can be disabled independently.

### What each image goes through

| Image type | Source | Filter eligibility |
| --- | --- | --- |
| `attachment` | Gmail attachment endpoint (also catches CID-referenced inline) | both |
| `drive_link` | `drive.google.com/...` URL in body | both |
| `embedded` | `<img src="data:image/...;base64,...">` in HTML | both |
| `pdf_page` | Embedded JPEG pulled out of a PDF attachment or Drive PDF | both |
| `zip_entry` | Image file pulled out of a ZIP attachment or Drive ZIP | both |

## Required apps

| Component | Apps / secrets |
| --- | --- |
| email-image-detector | gmail, google_drive |
| image-extractor | gmail, google_drive |
| vision-content-filter | google_cloud_vision_api (only if filtering enabled) |
| ai-content-classifier | Gemini API key (only if classifier enabled) |
| drive-uploader | google_drive |
| orchestrators | union of the above |

The Gemini API key comes from [Google AI Studio](https://aistudio.google.com/apikey). It's a `secret`-flagged string prop, not a connected app.

## Key props

| Prop | Default | Notes |
| --- | --- | --- |
| `email` | trigger event | Override to test against a fixture |
| `maxFileSize` | 40 MB | Per-image download cap (loose attachments, Drive images, embedded) |
| `maxContainerSize` | 200 MB | Download cap for PDFs & ZIP archives — they bundle many images, so it's separate from `maxFileSize`. ZIP extraction is streamed, but the download still buffers the whole archive in memory, so a container near this cap may need the workflow's Memory raised toward 1 GB |
| `enablePdfExtraction` | true | Pull embedded photos out of PDF attachments & PDF Drive links |
| `maxPdfPages` | 50 | Cap on pages scanned per PDF — protects against catalog-sized brochures |
| `enableZipExtraction` | true | Unzip .zip attachments & ZIP Drive links and pull image files out |
| `enableVisionFiltering` | false | Requires `googleCloudVision` |
| `visionFilteringStrength` | balanced | conservative / balanced / aggressive — confidence threshold |
| `skipTinyImages` | true | Files under 1 KB are flagged as tracking pixels |
| `enableAiClassifier` | false | Requires `geminiApiKey` |
| `aiClassifierModel` | gemini-2.5-flash | **Primary** model — runs on every image |
| `aiClassifierEscalationModel` | gemini-3.1-pro-preview | Stronger model used only when primary is unsure. Empty / same as primary disables the cascade |
| `aiClassifierConfidence` | 0.7 | Drop confidence threshold; higher = more lenient |
| `aiClassifierEscalationThreshold` | 0.85 | If primary returns confidence below this, re-run with the escalation model |
| `parentFolderId` | — | Drive folder to upload under; empty = Drive root |
| `rootFolderName` | Gmail_Images | Used when `createRootFolder` is true |
| `createRootFolder` | false | If true, sender folders go inside this root |

## Model cascade

The AI classifier runs in two passes by default:

1. **Primary pass** — every image goes to `aiClassifierModel` (default: Gemini 2.5 Flash, ~$0.0004/image, ~1s response).
2. **Escalation pass** — if the primary returns confidence below `aiClassifierEscalationThreshold` (default 0.85) *or* errors out, the same image is re-classified with `aiClassifierEscalationModel` (default: Gemini 3.1 Pro). Escalated decisions overwrite the primary's verdict and are tagged `escalated: true` on the kept image and in the `aiAnalysis` of dropped ones.

Escalation is symmetric — a low-confidence *keep* gets escalated just like a low-confidence *drop*, since the worst case in either direction is a wrong call. Escalation count is reported in `aiStats.escalated`.

To disable the cascade, set `aiClassifierEscalationModel` to empty or to the same value as `aiClassifierModel`. To skip the cheap pass entirely, set `aiClassifierModel` to `gemini-3.1-pro-preview` (and clear or match the escalation model).

Approximate cost at 500 images/day with default settings (~20% escalation rate): **~$14/month**, vs ~$50/month for Pro-only or ~$4/month for Flash-only.

## AI classifier categories

`ai-content-classifier.mjs` asks Gemini to bucket each image. The prompt + enum live in `common/constants.mjs`.

**KEEP:** `bedroom`, `kitchen`, `living`, `bathroom`, `exterior`, `balcony`, `garden`, `pool`, `view`, `floor_plan`, `aerial_or_map`, `staging_catalog`, `utility`

`staging_catalog` is the catch-all for staged interiors, furniture-catalog shots, 3D renders / artist's impressions, and interior amenity spaces (gym, dining hall, lobby, spa) — anything property-relevant that isn't a specific room. `utility` covers hallway / entryway / stairs / closet / laundry / interior garage — real listing photos that aren't a room category.

**DROP:** `logo`, `icon`, `signature`, `food`, `people_portrait`, `document`, `screenshot_text`, `other`

The keep / drop decision is **derived in code** from category-set membership — the model only returns `category`, `confidence`, `reason`. This makes the model unable to contradict itself (no separate `keep` flag).

The prompt also tells the model how to handle three common edge cases that show up in real listing emails:

- Person inside a real room → return the room category, not `people_portrait` (only use `people_portrait` when the person is genuinely the subject).
- Real photo with a small watermark / corner logo → room or exterior category. `logo` is for standalone logo images only.
- 3D render or marketing collage of an interior → `staging_catalog`.

A `drop` decision only fires when the model's confidence ≥ `aiClassifierConfidence` (default 0.7). Below that, the image is kept. Errors keep the image too — fail-safe.

The chosen `aiCategory` and `aiConfidence` ride along with each kept image and end up on the uploaded file's metadata, so you can later sort / thumbnail by room type.

### Confidence calibration

The prompt instructs Gemini to use a calibrated 0–1 scale rather than defaulting to 0.95 on every image:

- **0.5–0.7** — borderline, could go either way
- **0.7–0.85** — fairly sure but not obvious
- **0.85+** — clearly correct, no real ambiguity

This matters because the cascade fires on `confidence < aiClassifierEscalationThreshold` (default 0.85). Without calibration, the cheap model would self-report 0.95 on everything and the Pro escalation would never run. The Gemini `responseSchema` also enforces `confidence` ∈ [0, 1] and caps `reason` at 200 chars, with `propertyOrdering: [category, confidence, reason]` so the model commits to the category first and writes the reason last as justification.

## PDF handling

Forwarded estate-agent / MLS property brochures usually arrive as PDFs, not loose photo attachments. The detector flags PDF attachments and PDF Drive links as `type: "pdf"`, and the extractor pulls the embedded photos straight out of the PDF object stream (no rendering — uses `pdfjs-dist` headless, no `canvas` dep).

Each extracted photo becomes an `ExtractedImage` with `type: "pdf_page"`, plus `pdfSource`, `pageNumber`, and `pdfImageIndex`. Filenames look like `brochure-p03-i02.jpg`. From there the photos flow through Vision + the AI classifier just like any other image, so cover-page logos, contact-page screenshots, and agent headshots get dropped by the existing filters.

**What is extracted:** embedded JPEG photos, at their native resolution.

**What is NOT extracted (v1):**
- Non-JPEG embedded images (raw RGBA bitmaps, PNG masks) — skipped with a counter in `stats.pdfImagesSkippedNonJpeg`. Estate-agent brochures use JPEG for photos almost universally, so this is rarely material.
- Vector-only content like custom-drawn floor plans. If those matter, the AI classifier's `floor_plan` category still works on embedded raster floor plans, just not vector ones.
- Password-protected PDFs — skipped with a warn log.

`maxPdfPages` (default 50) caps page traversal per PDF. `PDF_SETTINGS.MAX_EMBEDDED_IMAGES` in `common/constants.mjs` adds a hard 200-image ceiling to defend against pathological PDFs.

`maxContainerSize` (default 200 MB) applies to the PDF download itself; extracted page images are not re-checked against it.

## ZIP handling

Senders sometimes batch property photos into a `.zip` rather than attaching them loose. The detector flags ZIP attachments and ZIP Drive links as `type: "zip"` (matching on MIME type *or* a `.zip` filename, since clients are inconsistent and some send `application/octet-stream`), and the extractor *streams* the archive through [`fflate`](https://github.com/101arrowz/fflate)'s `Unzip` — reading the downloaded file off disk in chunks and writing each image entry straight back to `/tmp` — so peak memory stays at roughly one decompressed image regardless of archive size.

Each extracted image becomes an `ExtractedImage` with `type: "zip_entry"`, plus `zipSource`, `zipEntryName`, and `zipEntryIndex`. Filenames look like `photos-front.jpg` (archive name + entry basename). From there they flow through Vision + the AI classifier like any other image.

**What is extracted:** files whose extension is a known image type — `jpg`/`jpeg`, `png`, `gif`, `webp`, `bmp`, `tif`/`tiff`, `svg` (see `IMAGE_EXTENSIONS` in `common/constants.mjs`).

**What is NOT extracted:**
- Non-image entries — skipped, counted in `stats.zipEntriesSkippedNonImage`. **Nested zips fall in here** (a `.zip` isn't an image extension), so archives-in-archives are not recursed.
- Entries larger than `ZIP_SETTINGS.MAX_ENTRY_BYTES` (50 MB) — skipped, counted in `stats.zipEntriesSkippedTooLarge`.
- Encrypted / unsupported-compression entries — dropped individually with a warn log; the rest of the archive still extracts. An archive fflate can't parse at all (corrupt/truncated) is skipped wholesale.

**Guardrails** (all in `ZIP_SETTINGS`, `common/constants.mjs`):
- `MAX_FILES` (200) — image entries extracted per archive.
- `MAX_ENTRY_BYTES` (50 MB) — per-entry uncompressed ceiling.
- `MAX_TOTAL_BYTES` (500 MB) — total uncompressed ceiling per archive.

Because extraction is streamed, these caps are enforced *as bytes inflate*: a non-image or over-cap entry is never `start()`ed (fflate skips its bytes without decompressing), and the per-entry / total ceilings also count inflated bytes mid-stream and abort the entry once a limit is crossed — that's the zip-bomb defense, so a tiny `.zip` can't expand to gigabytes. Extracted entry names are sanitized through `createTempFilePath` before touching disk, so a malicious entry path can't escape `/tmp` (zip-slip). `maxContainerSize` (default 200 MB) applies to the compressed archive download; the uncompressed expansion is bounded by the caps above. Toggle the whole feature with `enableZipExtraction` (default on).

> **Memory vs. disk note:** the streaming extractor writes each image to `/tmp` as it inflates, so extraction is bounded by disk (Pipedream gives ~2 GB of `/tmp`), not memory — `MAX_TOTAL_BYTES` (500 MB) leaves ample headroom. The remaining memory cost is the **download**, which buffers the whole compressed archive before extraction starts. Gmail attachments are worst here: they arrive base64-encoded in a JSON body, so a 163 MB ZIP peaks well past its size as a JS string. Pipedream's default workflow memory is 256 MB; for archives past ~80–100 MB raise **Settings → Memory** toward 1 GB (up to 2 GB) or the download can OOM.

## Vision filtering strength

- **conservative** — 0.8 threshold. Few false positives, keeps borderline content.
- **balanced** — 0.6. Default.
- **aggressive** — 0.4. Filters more, more false positives.

Filtered categories: logos & branding, UI icons, tracking pixels, signatures / footers, social media icons. Full label list in `common/constants.mjs` (`VISION_API.NON_CONTENT_LABELS`).

## Result shape (complete workflow)

```js
{
  emailId, subject, senderInfo, processedAt,
  images: ExtractedImage[],     // each carries aiCategory if classifier ran
  totalImages,
  visionFiltering: { enabled, strength, skipTinyImages, stats, filtered },
  aiClassifier:    { enabled, model, confidenceThreshold, stats, dropped },
  driveUpload:     { folder, summary, uploads },  // uploads[i].aiCategory
  workflow:        { completed, totalSteps: 5, processingTimeMs, stages },
  statistics:      { totalDetected, totalExtracted, totalFiltered,
                     totalDroppedByAi, totalUploaded, totalFailed,
                     successRate, totalSizeUploaded, processingTimeMs },
}
```

## Logging

All stages route through `logWithEmoji(stage, message)` from `common/utils.mjs`. Stage keys: 🚀 start, 🔍 detection, 📥 extraction, 👁️ vision, ⚙️ processing, 📁 folder, ☁️ upload, ✅ complete, ❌ error, ⚠️ warn, ℹ️ info, 👤 user, 📊 stats. Picking the right stage gives you a grep-friendly Pipedream log.

## Local commands

```bash
npm install        # installs eslint
npm run lint       # eslint .
pd publish actions/complete-workflow-orchestrator.mjs    # deploy via pd CLI
```

There is no test suite — validation happens by deploying and triggering on a real Gmail message.
