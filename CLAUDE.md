# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

A Pipedream workflow that watches Gmail for emails containing property-listing images (apartment / vacation-rental business), extracts them from attachments / Drive links / embedded HTML, optionally filters out non-content images via Google Cloud Vision, optionally runs an AI property classifier (Gemini) to keep only listing-relevant photos, and uploads survivors to sender-named folders in Google Drive. Components are deployed to the Pipedream platform — there is no local server runtime; "running" means a Pipedream workflow firing on a Gmail trigger.

The whole code-bearing project lives at `workflow/components/gmail-image-processor/`. Everything else under `workflow/` is operator documentation.

## Architecture

```
gmail-image-processor/
├── common/
│   ├── constants.mjs    # API endpoints, MIME types, vision/property thresholds
│   ├── props.mjs        # Shared Pipedream prop definitions
│   ├── types.mjs        # JSDoc shapes + runtime validators / constructors
│   └── utils.mjs        # Logging, parsing, file ops, runAction helper
└── actions/
    ├── email-image-detector.mjs           # Stage 1: scan attachments + Drive links + embedded base64
    ├── image-extractor.mjs                # Stage 2: download / decode to temp files
    ├── vision-content-filter.mjs          # Stage 3 (optional): Cloud Vision filtering
    ├── ai-content-classifier.mjs          # Stage 4 (optional): Gemini property classifier
    ├── drive-uploader.mjs                 # Stage 5: upload to Drive (sender folders)
    ├── image-processor-orchestrator.mjs   # Stages 1–4 chained
    └── complete-workflow-orchestrator.mjs # Stages 1–5 chained — recommended
```

**Pipeline data shape:** detector → `{ images: DetectedImage[], senderInfo, ... }` (types: `attachment` / `drive_link` / `embedded`) → extractor → `{ images: ExtractedImage[] with filePath, ... }` → vision filter → same shape minus filtered → AI classifier → same shape minus AI-dropped, with `aiCategory`/`aiConfidence` added to each image → drive uploader → upload result with `aiCategory` on each file. Each stage's output is the next stage's input. Orchestrators chain stages by calling `runAction(component, props, runArgs)` from `common/utils.mjs`.

**Two-filter design.** Vision filter is the cheap pre-filter that nukes tiny files, logos, and well-known tracking patterns at near-zero cost. AI classifier runs after Vision and judges the harder "is this a property photo" question per image. Both are optional and independent — disabling either passes data through unchanged.

**AI classifier model cascade.** The classifier itself is two-tier: every image first goes to a cheap primary model (default Gemini 2.5 Flash, ~$0.0004/image), and only low-confidence decisions (below `aiClassifierEscalationThreshold`, default 0.85) or errors get re-classified by a stronger escalation model (default Gemini 3.1 Pro). Escalation is symmetric — low-confidence keeps and drops both escalate. Set `aiClassifierEscalationModel` empty or equal to the primary to disable.

**AI classifier categories** (defined in `common/constants.mjs`):
- KEEP: bedroom, kitchen, living, bathroom, exterior, balcony, garden, pool, view, floor_plan, aerial_or_map, staging_catalog, utility
- DROP: logo, icon, signature, food, people_portrait, document, screenshot_text, other

Categories are deliberately broad: `living` absorbs dining and home-office, `balcony` absorbs patio/deck/terrace/rooftop, `pool` absorbs hot tub/sauna, `utility` covers hallway/stairs/closet/laundry/interior-garage. Add new categories sparingly — more enum values = noisier classification.

Drop only fires when model confidence ≥ threshold (default 0.7). Errors keep — fail-safe behavior.

**Published Pipedream registry components:** `gmail-email-image-detector` and `gmail-image-processor-complete-workflow`. Their action keys are intentionally preserved in the `key:` fields of `email-image-detector.mjs` and `complete-workflow-orchestrator.mjs` — changing them would break re-publishing.

## Why orchestrators do the `runAction` dance

Pipedream's runtime flattens a component's `methods.*` onto the instance before invoking `run()`. When orchestrators invoke other components manually, they have to do that themselves — `Object.create(component)` alone leaves methods stranded under `methods.*` and unreachable as `this.foo`. `runAction` does the bind. Don't replace it with a plain `await Component.run(...)` or `Object.create`.

## Commands

All commands run from `workflow/components/gmail-image-processor/`.

```bash
npm install                 # installs eslint
npm run lint                # eslint .
pd publish actions/complete-workflow-orchestrator.mjs   # deploy via pd CLI
```

No test suite. Validation = deploy and trigger on a real email.

## Conventions

- **ESM only** (`.mjs`, `"type": "module"`). Relative imports must include the `.mjs` extension.
- **Double quotes and semicolons** are enforced by ESLint.
- **Shared props live in `common/props.mjs`** as plain exports (`emailProp`, `gmailApp`, `geminiApiKeyProp`, …). Spread them into each action's `props` rather than redeclaring inline.
- **Logging**: `logWithEmoji(stage, msg)` from `common/utils.mjs`. Stage emoji set: 🚀 start, 🔍 detection, 📥 extraction, 👁️ vision, ⚙️ processing, 📁 folder, ☁️ upload, ✅ complete, ❌ error, ⚠️ warn, ℹ️ info, 👤 user, 📊 stats. Don't replace with plain `console.log`.
- **Don't reintroduce a custom Pipedream `app` file.** Earlier iterations used `gmail-image-processor.app.mjs` to share props/methods, which forced a registry-vs-app duplicate of every action. The current pattern (plain shared props + `runAction`) replaces that.
- **AI classifier failures = keep the image.** Don't change this. False-positive drops (losing a real property photo) are worse for the rental business than false-negative keeps (a stray logo making it through).

## Documentation

- `workflow/components/gmail-image-processor/README.md` — current architecture, prop reference, output schemas. **Start here.**
- `workflow/CLOUD_VISION_PROPOSAL.md`, `workflow/CLOUD_VISION_SETUP.md` — Google Cloud Vision config notes.
- `workflow/GOOGLE_DRIVE_FOLDER_ID_GUIDE.md` — how to find / use a parent Drive folder ID.
- `workflow/GMAIL_SEARCH_OPERATORS.md` — Gmail search query reference for the trigger.
