# How to Find Google Drive Folder ID

## 🎯 Quick Method

1. **Open Google Drive** in your web browser
2. **Navigate to your desired folder**
3. **Look at the URL** in your browser's address bar
4. **Copy the folder ID** from the URL

## 📋 Step-by-Step Instructions

### Method 1: From Browser URL

1. Go to [drive.google.com](https://drive.google.com)
2. Navigate to the folder you want to use as parent
3. The URL will look like:
    ```
    https://drive.google.com/drive/folders/1ABC123DEF456GHI789JKL0MNO
    ```
4. **Copy the ID**: `1ABC123DEF456GHI789JKL0MNO`

### Method 2: From Folder Sharing

1. **Right-click** on the folder in Google Drive
2. Select **"Share"**
3. Click **"Copy link"**
4. The link will be:
    ```
    https://drive.google.com/drive/folders/1ABC123DEF456GHI789JKL0MNO?usp=sharing
    ```
5. **Extract the ID**: `1ABC123DEF456GHI789JKL0MNO`

## 🔍 What the Folder ID Looks Like

Google Drive folder IDs are typically:

-   **Length**: 25-35 characters
-   **Format**: Mix of letters, numbers, hyphens, underscores
-   **Examples**:
    -   `1ABC123DEF456GHI789JKL0MNO`
    -   `1BxYz2CdEf3GhIj4KlMn5OpQr6StUv`
    -   `1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o`

## 📁 Folder Structure Examples

### Without Parent Folder ID (Default)

```
📁 Google Drive (Root)
└── 📁 Gmail_Images
    ├── 📁 John_Doe
    │   ├── 🖼️ photo1.jpg
    │   └── 🖼️ photo2.png
    └── 📁 Jane_Smith
        └── 🖼️ screenshot.png
```

### With Parent Folder ID

```
📁 Google Drive (Root)
└── 📁 My_Projects (Your existing folder)
    └── 📁 Gmail_Images (Created by workflow)
        ├── 📁 John_Doe
        │   ├── 🖼️ photo1.jpg
        │   └── 🖼️ photo2.png
        └── 📁 Jane_Smith
            └── 🖼️ screenshot.png
```

## ⚙️ Configuration in Pipedream

### Option 1: Use Drive Root (Default)

```
Parent Folder ID: [Leave empty]
Root Folder Name: Gmail_Images
Create Root Folder: true
```

**Result**: `Gmail_Images/SenderName/images...`

### Option 2: Use Existing Parent Folder

```
Parent Folder ID: 1ABC123DEF456GHI789JKL0MNO
Root Folder Name: Gmail_Images
Create Root Folder: true
```

**Result**: `YourFolder/Gmail_Images/SenderName/images...`

### Option 3: Direct to Existing Folder (No Root Folder)

```
Parent Folder ID: 1ABC123DEF456GHI789JKL0MNO
Root Folder Name: [Any name, ignored]
Create Root Folder: false
```

**Result**: `YourFolder/SenderName/images...`

## 🚨 Common Mistakes

### ❌ Wrong: Using Folder Name

```
Parent Folder ID: My_Projects  ← This won't work!
```

### ❌ Wrong: Using Full URL

```
Parent Folder ID: https://drive.google.com/drive/folders/1ABC123...  ← Too much!
```

### ✅ Correct: Using Just the ID

```
Parent Folder ID: 1ABC123DEF456GHI789JKL0MNO  ← Perfect!
```

## 🔐 Permissions Note

Make sure the Google account connected to your Pipedream workflow has **write access** to the parent folder you specify. If you don't have permission, the workflow will fail to create folders.

---

**Result**: Organized Gmail images exactly where you want them! 📁✨
