const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const uploadsDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '../uploads');

/**
 * Save buffer as image file
 */
const saveImageBuffer = async (buffer, filename) => {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const filepath = path.join(uploadsDir, filename);
  await fs.promises.writeFile(filepath, buffer);
  return filepath;
};

/**
 * Get image metadata
 */
const getImageMetadata = async (filepath) => {
  try {
    const metadata = await sharp(filepath).metadata();
    const stats = fs.statSync(filepath);
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      fileSize: stats.size,
      channels: metadata.channels
    };
  } catch (err) {
    return { width: 0, height: 0, format: 'unknown', fileSize: 0 };
  }
};

/**
 * Optimize image for web
 */
const optimizeImage = async (inputPath, outputPath, options = {}) => {
  const { quality = 90, width = null, height = null } = options;
  let pipeline = sharp(inputPath);
  if (width || height) {
    pipeline = pipeline.resize(width, height, { fit: 'inside', withoutEnlargement: true });
  }
  await pipeline.jpeg({ quality, progressive: true, mozjpeg: true }).toFile(outputPath);
  return outputPath;
};

/**
 * Apply sharpening and enhancement using Sharp
 */
const enhanceImageLocally = async (inputPath, outputPath) => {
  await sharp(inputPath)
    .sharpen({ sigma: 1.0, m1: 0.5, m2: 0.1 })
    .modulate({ brightness: 1.02, saturation: 1.05 })
    .jpeg({ quality: 95, progressive: true })
    .toFile(outputPath);
  return outputPath;
};

/**
 * Upscale image to target resolution — CLEAN, artifact-free approach.
 *
 * What actually works:
 *   1. Single-pass Lanczos3 resize  (best quality resampler, no mid-loop side effects)
 *   2. Very gentle unsharp-mask     (recovers softness from resampling, never creates grain)
 *   3. q95 JPEG                     (high quality, keeps file manageable)
 *
 * What we do NOT do (because these caused the grain/artifacts):
 *   - CLAHE (amplifies noise badly)
 *   - Multiple sharpening passes
 *   - Aggressive sigma/m1 values
 *   - HuggingFace AI model (was returning corrupted data)
 */
const resizeToResolution = async (inputPath, outputPath, level) => {
  const resolutions = {
    'HD': { width: 1920, height: 1080 },
    '2K': { width: 2560, height: 1440 },
    '4K': { width: 3840, height: 2160 },
    '8K': { width: 7680, height: 4320 }
  };

  const meta = await sharp(inputPath).metadata();
  const srcW = meta.width  || 1024;
  const srcH = meta.height || 1024;

  const target = resolutions[level] || resolutions['HD'];

  // Preserve aspect ratio — fit inside target box
  const ratio = Math.min(target.width / srcW, target.height / srcH);

  // Cap at 4× — beyond this Lanczos loses quality badly
  const scale = Math.min(ratio, 4);
  const targetW = Math.round(srcW * scale);
  const targetH = Math.round(srcH * scale);

  console.log(`[Upscale] ${srcW}×${srcH} → ${targetW}×${targetH} (${level}, scale: ${scale.toFixed(2)}×)`);

  await sharp(inputPath)
    // High-quality Lanczos3 resize — single pass, no artifacts
    .resize(targetW, targetH, {
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: false  // prevents quality loss during load
    })
    // Very gentle unsharp mask — ONLY recovers softness from resampling
    // sigma:0.5 = tiny radius, m1:0.5 = weak flat-area sharpening, m2:0.05 = almost no edge sharpening
    .sharpen({ sigma: 0.5, m1: 0.5, m2: 0.05 })
    // q95 progressive JPEG — high quality, no banding
    .jpeg({ quality: 95, progressive: true, mozjpeg: true })
    .toFile(outputPath);

  console.log(`[Upscale] ✅ Done → ${outputPath}`);
  return outputPath;
};

/**
 * Validate that a buffer is a valid readable image (use before saving AI output).
 * Returns true if valid, false if garbage/corrupt.
 */
const isValidImageBuffer = async (buffer) => {
  try {
    const meta = await sharp(buffer).metadata();
    return meta.width > 0 && meta.height > 0 && !!meta.format;
  } catch {
    return false;
  }
};

/**
 * Apply a light quality pass on an already-correct image.
 * Used after AI upscaling to slightly sharpen & boost colour.
 */
const applyFinalEnhancement = async (inputPath, outputPath) => {
  await sharp(inputPath)
    .sharpen({ sigma: 0.5, m1: 0.4, m2: 0.05 })
    .modulate({ brightness: 1.01, saturation: 1.03 })
    .jpeg({ quality: 95, progressive: true, mozjpeg: true })
    .toFile(outputPath);
  return outputPath;
};

/**
 * Create thumbnail
 */
const createThumbnail = async (inputPath, outputPath, size = 300) => {
  await sharp(inputPath)
    .resize(size, size, { fit: 'cover' })
    .jpeg({ quality: 80 })
    .toFile(outputPath);
  return outputPath;
};

/**
 * Validate image file
 */
const validateImage = async (filepath) => {
  try {
    const metadata = await sharp(filepath).metadata();
    const stats = fs.statSync(filepath);
    if (stats.size > 20 * 1024 * 1024) throw new Error('File size exceeds 20MB limit');
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported image format');
    if (metadata.width < 64 || metadata.height < 64) throw new Error('Image is too small (minimum 64x64 pixels)');
    return { valid: true, metadata };
  } catch (err) {
    return { valid: false, error: err.message };
  }
};

module.exports = {
  saveImageBuffer,
  getImageMetadata,
  optimizeImage,
  enhanceImageLocally,
  resizeToResolution,
  isValidImageBuffer,
  applyFinalEnhancement,
  createThumbnail,
  validateImage
};
