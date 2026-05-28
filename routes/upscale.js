const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const upload = require('../middleware/upload');
const { optionalAuth } = require('../middleware/auth');
const { upscaleImage } = require('../services/aiService');
const {
  getImageMetadata,
  validateImage,
  enhanceImageLocally,
  resizeToResolution
} = require('../services/imageService');
const Image = require('../models/Image');
const User = require('../models/User');

// @route POST /api/upscale
router.post('/', upload.single('image'), optionalAuth, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image' });
    }

    const { upscaleLevel = 'HD' } = req.body;
    const inputPath = req.file.path;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // Validate image
    const validation = await validateImage(inputPath);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const originalMeta = await getImageMetadata(inputPath);
    const originalUrl = `${baseUrl}/uploads/${req.file.filename}`;

    // Upscale/Enhance
    let enhancedUrl = null;
    let enhancedMeta = null;
    const enhancedFilename = `upscaled-${uuidv4()}.jpg`;
    const uploadsDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '../uploads');
    const enhancedPath = path.join(uploadsDir, enhancedFilename);

    try {
      const enhancedBuffer = await upscaleImage(inputPath, upscaleLevel);
      const fs = require('fs');
      await fs.promises.writeFile(enhancedPath, enhancedBuffer);
    } catch (upscaleErr) {
      console.log('External upscaler failed, using local:', upscaleErr.message);
      await resizeToResolution(inputPath, enhancedPath, upscaleLevel);
    }

    enhancedMeta = await getImageMetadata(enhancedPath);
    enhancedUrl = `${baseUrl}/uploads/${enhancedFilename}`;

    // Save to DB
    const imageDoc = await Image.create({
      user: req.user ? req.user._id : null,
      type: 'upscaled',
      prompt: req.file ? `Upscaled: ${req.file.originalname}` : 'Upscaled Image',
      originalUrl,
      enhancedUrl,
      originalSize: originalMeta,
      enhancedSize: enhancedMeta,
      upscaleLevel,
      status: 'completed'
    });

    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { credits: -1, totalUpscaled: 1 }
      });
    }

    res.json({
      success: true,
      message: `Image upscaled to ${upscaleLevel} successfully`,
      data: {
        id: imageDoc._id,
        originalUrl,
        enhancedUrl,
        originalSize: originalMeta,
        enhancedSize: enhancedMeta,
        upscaleLevel
      }
    });

  } catch (err) {
    console.error('Upscale error:', err);
    res.status(500).json({ success: false, message: err.message || 'Upscaling failed' });
  }
});

module.exports = router;
