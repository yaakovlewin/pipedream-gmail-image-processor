# Google Cloud Vision Integration Proposal

## 🎯 Purpose

Add intelligent image filtering using Google Cloud Vision API to automatically exclude:

-   Company logos
-   Email signatures
-   Tracking pixels
-   Advertisement banners
-   Non-content images

## 🔍 How It Would Work

### 1. **Image Analysis Pipeline**

```
Email → Extract Images → Cloud Vision Analysis → Filter → Upload Only Content Images
```

### 2. **Cloud Vision Features to Use**

#### Logo Detection

```javascript
const [result] = await visionClient.logoDetection(imagePath);
const logos = result.logoAnnotations;
if (logos.length > 0) {
	// Skip this image - it's a logo
	console.log(`⏭️ Skipping logo: ${logos[0].description}`);
}
```

#### Label Detection

```javascript
const [result] = await visionClient.labelDetection(imagePath);
const labels = result.labelAnnotations;

// Skip if common non-content labels detected
const skipLabels = [
	"logo",
	"brand",
	"trademark",
	"icon",
	"banner",
	"advertisement",
];
const shouldSkip = labels.some((label) =>
	skipLabels.includes(label.description.toLowerCase())
);
```

#### Safe Search Detection

```javascript
const [result] = await visionClient.safeSearchDetection(imagePath);
// Can filter inappropriate content if needed
```

#### Image Properties

```javascript
// Skip very small images (likely tracking pixels)
if (imageWidth < 100 || imageHeight < 100) {
	console.log(`⏭️ Skipping tiny image: ${imageWidth}x${imageHeight}`);
}
```

## 📋 Implementation Plan

### Step 1: Add Cloud Vision to Props

```javascript
props: {
    // ... existing props
    enableVisionFiltering: {
        type: "boolean",
        label: "Enable Smart Image Filtering",
        description: "Use Google Cloud Vision to filter out logos and non-content images",
        default: false,
    },
    visionApiKey: {
        type: "string",
        label: "Google Cloud Vision API Key",
        description: "Your Cloud Vision API key (required if filtering enabled)",
        optional: true,
        secret: true,
    },
    filteringOptions: {
        type: "object",
        label: "Filtering Options",
        description: "Configure what types of images to filter",
        default: {
            skipLogos: true,
            skipTinyImages: true,
            minImageSize: 100, // pixels
            skipLabels: ["logo", "brand", "icon", "banner", "advertisement"],
            confidenceThreshold: 0.7
        }
    }
}
```

### Step 2: Add Vision Analysis Method

```javascript
async analyzeImageWithVision(imagePath, filename) {
    if (!this.enableVisionFiltering) {
        return { shouldKeep: true };
    }

    try {
        const vision = new ImageAnnotatorClient({
            apiKey: this.visionApiKey
        });

        // Run multiple detections
        const [logoResult] = await vision.logoDetection(imagePath);
        const [labelResult] = await vision.labelDetection(imagePath);

        // Check for logos
        if (this.filteringOptions.skipLogos && logoResult.logoAnnotations.length > 0) {
            return {
                shouldKeep: false,
                reason: `Logo detected: ${logoResult.logoAnnotations[0].description}`,
                confidence: logoResult.logoAnnotations[0].score
            };
        }

        // Check labels
        if (this.filteringOptions.skipLabels.length > 0) {
            for (const label of labelResult.labelAnnotations) {
                if (this.filteringOptions.skipLabels.includes(label.description.toLowerCase()) &&
                    label.score >= this.filteringOptions.confidenceThreshold) {
                    return {
                        shouldKeep: false,
                        reason: `Filtered label: ${label.description}`,
                        confidence: label.score
                    };
                }
            }
        }

        return { shouldKeep: true };

    } catch (error) {
        console.warn(`Vision API error for ${filename}:`, error.message);
        // On error, keep the image (fail open)
        return { shouldKeep: true, error: error.message };
    }
}
```

### Step 3: Integrate into Image Processing

```javascript
// In extractAllImages method
for (const image of detectedImages) {
	// ... existing download logic

	// Analyze with Vision API
	const analysis = await this.analyzeImageWithVision(
		extractedImage.filePath,
		image.filename
	);

	if (!analysis.shouldKeep) {
		console.log(`🚫 Filtered out: ${image.filename} - ${analysis.reason}`);
		continue;
	}

	// Add to extracted images
	extractedImages.push({
		...image,
		filePath: extractedImage.filePath,
		visionAnalysis: analysis,
		extractedAt: new Date().toISOString(),
	});
}
```

## 💰 Cost Considerations

### Pricing (as of 2024)

-   **First 1,000 units/month**: Free
-   **Next 999,000 units**: $1.50 per 1,000 units
-   Each image analysis counts as multiple units depending on features used

### Cost Optimization

1. **Selective Filtering**: Only analyze images above certain size
2. **Batch Processing**: Use batch requests when possible
3. **Cache Results**: Store analysis results to avoid re-processing
4. **Feature Selection**: Only use needed features (logo detection + labels)

## 🎯 Benefits

### ✅ Pros

-   **Cleaner Storage**: Only saves meaningful images
-   **Reduced Clutter**: No more email signatures or logos
-   **Smart Filtering**: AI-powered content detection
-   **Customizable**: Configure what to filter
-   **Professional Results**: Better organized image library

### ⚠️ Cons

-   **Additional Cost**: Cloud Vision API pricing
-   **Processing Time**: Adds ~1-2 seconds per image
-   **Complexity**: More configuration required
-   **False Positives**: Might filter out wanted images
-   **API Limits**: Rate limiting considerations

## 🔧 Configuration Examples

### Example 1: Filter Logos Only

```javascript
filteringOptions: {
    skipLogos: true,
    skipTinyImages: false,
    skipLabels: []
}
```

### Example 2: Aggressive Filtering

```javascript
filteringOptions: {
    skipLogos: true,
    skipTinyImages: true,
    minImageSize: 200,
    skipLabels: ["logo", "brand", "icon", "banner", "advertisement", "signature", "watermark"],
    confidenceThreshold: 0.5
}
```

### Example 3: Conservative Filtering

```javascript
filteringOptions: {
    skipLogos: true,
    skipTinyImages: true,
    minImageSize: 50,
    skipLabels: ["logo", "advertisement"],
    confidenceThreshold: 0.9
}
```

## 📊 Expected Results

### Before Vision Filtering

```
📁 John Doe
├── 📷 vacation_photo.jpg ✅
├── 🏷️ company_logo.png ❌
├── ✉️ email_signature.gif ❌
├── 📷 family_photo.jpg ✅
└── 📊 tracking_pixel.png ❌
```

### After Vision Filtering

```
📁 John Doe
├── 📷 vacation_photo.jpg ✅
└── 📷 family_photo.jpg ✅
```

## 🚀 Implementation Priority

### Phase 1: Basic Logo Detection

-   Implement logo detection only
-   Simple on/off toggle
-   Minimal configuration

### Phase 2: Advanced Filtering

-   Add label detection
-   Configurable skip lists
-   Confidence thresholds

### Phase 3: Smart Features

-   Content type detection
-   Duplicate image detection
-   OCR for text-heavy images

## 🎉 Conclusion

Adding Google Cloud Vision would make the workflow significantly smarter, automatically filtering out non-content images and keeping only the meaningful photos and images. While it adds some complexity and cost, the benefits of a cleaner, more organized image library make it worthwhile for users processing many emails.

**Recommendation**: Start with a simple implementation (logo detection only) as an optional feature, then expand based on user feedback.
