# Cloud Vision Logo/Signature Filtering Setup

## 🎯 Overview

The simplified workflow now includes **optional** logo and signature filtering using Google Cloud Vision API. This feature is:

-   ✅ **Completely optional** - workflow works without it
-   ✅ **Backwards compatible** - existing workflows continue unchanged
-   ✅ **Simple to enable** - just two configuration fields

## 🚀 Quick Setup (5 minutes)

### Step 1: Enable Cloud Vision API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable **Cloud Vision API**:
    - Go to "APIs & Services" → "Library"
    - Search for "Cloud Vision API"
    - Click "Enable"

### Step 2: Connect in Pipedream

In your Image Processor step:

1. **Enable Logo/Signature Filtering**: `true`
2. **Google Cloud Vision**: Click "Connect Account"
    - Select "Google Cloud Vision API" from the app list
    - Pipedream will handle OAuth authentication
    - Authorize access to your Google Cloud project
    - The workflow uses direct API calls with your OAuth token

**Note**: The integration uses direct HTTP requests to the Vision API endpoint (`https://vision.googleapis.com/v1/images:annotate`) with your authenticated token for maximum reliability.

That's it! The workflow will now automatically skip logos and email signatures.

## 📊 What Gets Filtered

### ✅ Automatically Skipped:

-   Company logos (Gmail, Outlook, company brands)
-   Email signature images
-   Watermarks
-   Brand trademarks
-   Images labeled as "logo", "signature", "brand"

### ✅ Always Kept:

-   Personal photos
-   Screenshots
-   Document scans
-   Charts and graphs
-   Any non-logo content images

## 💰 Cost

-   **First 1,000 images/month**: FREE
-   **After 1,000**: $1.50 per 1,000 images
-   **Average email**: 2-3 images = ~$0.003 per email after free tier

## 🔧 Configuration Options

### Default (Filtering Disabled)

```
Enable Logo/Signature Filtering: false
Google Cloud Vision: [Not connected]
```

**Result**: All images saved (current behavior)

### Basic Filtering (Recommended)

```
Enable Logo/Signature Filtering: true
Google Cloud Vision: [Connected - Click to connect]
```

**Result**: Logos and signatures filtered out

## 📈 Example Results

### Before Filtering

```
📁 John Doe
├── vacation_photo.jpg ✅
├── gmail_logo.png ❌
├── email_signature.gif ❌
├── company_logo.jpg ❌
└── family_photo.jpg ✅
```

### After Filtering

```
📁 John Doe
├── vacation_photo.jpg ✅
└── family_photo.jpg ✅
```

## 🛡️ Error Handling

If Vision API fails or quota exceeded:

-   ✅ Workflow continues normally
-   ✅ Images are NOT filtered (fail-safe design)
-   ⚠️ Clear error messages logged in console
-   ✅ No workflow interruption
-   🔧 Direct API calls provide detailed error information

## 🔍 Console Output

When filtering is enabled, you'll see:

```
🔍 Analyzing company_logo.png for logos/signatures...
🏷️ Logo detected: Gmail
🚫 Skipping signature/logo: Gmail (95.2%)

🔍 Analyzing vacation_photo.jpg for logos/signatures...
📥 Successfully extracted 1 images
```

## ❓ FAQ

### Q: Will this break my existing workflow?

**A**: No! It's completely optional and backwards compatible.

### Q: What if I don't enable it?

**A**: The workflow works exactly as before - all images are saved.

### Q: What if the Cloud Vision app isn't connected?

**A**: The workflow will skip Vision filtering and process all images normally. You'll see a message that Vision filtering is disabled.

### Q: Can I disable it later?

**A**: Yes, just set `enableVisionFiltering` to `false`.

### Q: Does it work with the parent folder feature?

**A**: Yes, all features work together seamlessly.

## 🎉 Benefits

-   **Cleaner folders**: Only meaningful images saved
-   **Less clutter**: No more email signatures
-   **Professional results**: Organized photo library
-   **Cost effective**: Free tier covers most users
-   **Simple setup**: Just 2 fields to configure

---

**Status**: ✅ Ready to use - completely optional feature!
