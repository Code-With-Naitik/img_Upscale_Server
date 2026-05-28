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
    pipeline = pipeline.resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  await pipeline
    .jpeg({ quality, progressive: true, mozjpeg: true })
    .toFile(outputPath);

  return outputPath;
};

/**
 * Apply sharpening and enhancement using Sharp
 */
const enhanceImageLocally = async (inputPath, outputPath) => {
  await sharp(inputPath)
    .sharpen({ sigma: 1.5, m1: 1.0, m2: 0.7 })
    .clahe({ width: 3, height: 3 })
    .modulate({ brightness: 1.05, saturation: 1.1 })
    .jpeg({ quality: 95, progressive: true })
    .toFile(outputPath);

  return outputPath;
};

/**
 * Resize to specific resolution
 */
const resizeToResolution = async (inputPath, outputPath, level) => {
  const resolutions = {
    'HD': { width: 1920, height: 1080 },
    '2K': { width: 2560, height: 1440 },
    '4K': { width: 3840, height: 2160 },
    '8K': { width: 7680, height: 4320 }
  };

  const metadata = await sharp(inputPath).metadata();
  const isPortrait = metadata.height > metadata.width;

  const target = resolutions[level] || resolutions['HD'];
  let targetWidth = target.width;
  let targetHeight = target.height;

  if (isPortrait) {
    targetWidth = target.height;
    targetHeight = target.width;
  }

  await sharp(inputPath)
    .resize(targetWidth, targetHeight, {
      fit: 'inside',
      kernel: sharp.kernel.lanczos3
    })
    .sharpen({ sigma: 1.2 })
    .jpeg({ quality: 95, progressive: true })
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

    if (stats.size > 20 * 1024 * 1024) {
      throw new Error('File size exceeds 20MB limit');
    }

    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
      throw new Error('Unsupported image format');
    }

    if (metadata.width < 64 || metadata.height < 64) {
      throw new Error('Image is too small (minimum 64x64 pixels)');
    }

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
  createThumbnail,
  validateImage
};
