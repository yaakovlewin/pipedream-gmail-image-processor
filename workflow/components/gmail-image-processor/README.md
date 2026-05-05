# Gmail Image Processor

Modular Pipedream actions that pull images out of Gmail messages (attachments, Drive links, embedded base64), filter junk via Cloud Vision and an AI property classifier, then upload the survivors to sender-named folders in Google Drive.

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
email-image-detector       attachments + Drive links + embedded base64
    ↓
image-extractor            downloads / decodes to temp files (filePath added)
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
| `maxFileSize` | 25 MB | Files above this are skipped |
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

**KEEP:** `bedroom`, `kitchen`, `living`, `bathroom`, `exterior`, `balcony`, `garden`, `pool`, `view`, `floor_plan`, `aerial_or_map`, `staging_catalog`

`staging_catalog` is the catch-all for staged interiors, furniture-catalog shots, 3D renders / artist's impressions, and interior amenity spaces (gym, dining hall, lobby, spa) — anything property-relevant that isn't a specific room.

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
