const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { protect, optionalAuth } = require('../middleware/auth');
const { generateImage, upscaleImage } = require('../services/aiService');
const {
  saveImageBuffer,
  getImageMetadata,
  enhanceImageLocally,
  resizeToResolution
} = require('../services/imageService');
const Image = require('../models/Image');
const User = require('../models/User');

const upload = require('../middleware/upload');

// @route POST /api/generate
router.post('/', upload.single('referenceImage'), optionalAuth, async (req, res) => {
  try {
    const {
      prompt,
      style = 'realistic',
      upscaleLevel = 'HD',
      negativePrompt = '',
      width = 1024,
      height = 1024,
      modelGender,
      modelType,
      modelSetting,
      model,
      provider
    } = req.body;

    // Check if reference try-on image was uploaded
    let finalPrompt = prompt;
    let tryonOriginalUrl = null;
    let tryonOriginalMeta = null;

    if (req.file) {
      const modelGenderStr = modelGender || 'female';
      const modelTypeStr = modelType || 'caucasian';
      const modelSettingStr = modelSetting || 'studio';
      finalPrompt = `A professional full-length portrait of a ${modelTypeStr} ${modelGenderStr} model, full body shot standing, visible from head to toe, posing in a ${modelSettingStr} setting, wearing the clothing shown in the reference image, ${prompt}`;
      
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      tryonOriginalUrl = `${baseUrl}/uploads/${req.file.filename}`;
      tryonOriginalMeta = await getImageMetadata(req.file.path);
    }

    if (!prompt || prompt.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a descriptive prompt (minimum 3 characters)'
      });
    }

    // Check credits if logged in
    if (req.user) {
      if (req.user.credits <= 0) {
        return res.status(402).json({
          success: false,
          message: 'Insufficient credits. Please upgrade your plan.'
        });
      }
    }

    // Step 1: Generate image
    const generatedBuffer = await generateImage(finalPrompt, {
      style,
      width: parseInt(width),
      height: parseInt(height),
      negativePrompt,
      model,
      provider
    });

    // Save original generated image
    const originalFilename = `gen-${uuidv4()}.jpg`;
    const originalPath = path.join(__dirname, '../uploads', originalFilename);
    await saveImageBuffer(generatedBuffer, originalFilename);

    const originalMeta = await getImageMetadata(originalPath);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const originalUrl = `${baseUrl}/uploads/${originalFilename}`;

    // Step 2: Auto-enhance generated image
    let enhancedUrl = null;
    let enhancedMeta = null;

    try {
      const enhancedFilename = `enh-${uuidv4()}.jpg`;
      const enhancedPath = path.join(__dirname, '../uploads', enhancedFilename);

      // Try external upscaler first
      let enhancedBuffer = null;
      try {
        enhancedBuffer = await upscaleImage(originalPath, upscaleLevel);
        await saveImageBuffer(enhancedBuffer, enhancedFilename);
      } catch (upscaleErr) {
        console.log('External upscaler failed, using local enhancement:', upscaleErr.message);
        // Fallback to local sharp enhancement + resize
        await resizeToResolution(originalPath, enhancedPath, upscaleLevel);
      }

      if (enhancedBuffer) {
        await saveImageBuffer(enhancedBuffer, enhancedFilename);
      }

      enhancedMeta = await getImageMetadata(enhancedPath);
      enhancedUrl = `${baseUrl}/uploads/${enhancedFilename}`;
    } catch (enhanceErr) {
      console.log('Enhancement failed:', enhanceErr.message);
      // Use original as fallback
      enhancedUrl = originalUrl;
      enhancedMeta = originalMeta;
    }

    // Determine original and enhanced URLs to save
    const dbOriginalUrl = req.file ? tryonOriginalUrl : originalUrl;
    const dbEnhancedUrl = enhancedUrl;
    const dbOriginalMeta = req.file ? tryonOriginalMeta : originalMeta;
    const dbEnhancedMeta = enhancedMeta;

    // Save to database if user logged in
    let imageDoc = null;
    if (req.user) {
      imageDoc = await Image.create({
        user: req.user._id,
        type: req.file ? 'enhanced' : 'generated',
        prompt,
        originalUrl: dbOriginalUrl,
        enhancedUrl: dbEnhancedUrl,
        originalSize: dbOriginalMeta,
        enhancedSize: dbEnhancedMeta,
        upscaleLevel,
        status: 'completed',
        model: model || 'black-forest-labs/FLUX.1-Krea-dev',
        style,
        metadata: { 
          negativePrompt, 
          width, 
          height, 
          isTryon: !!req.file,
          modelGender, 
          modelType, 
          modelSetting,
          generatedBaseUrl: originalUrl
        }
      });

      // Deduct credit and update stats
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { credits: -1, totalGenerated: 1 }
      });
    }

    res.json({
      success: true,
      message: req.file ? 'AI Model Try-on image generated successfully' : 'Image generated and enhanced successfully',
      data: {
        id: imageDoc?._id || uuidv4(),
        originalUrl: dbOriginalUrl,
        enhancedUrl: dbEnhancedUrl,
        originalSize: dbOriginalMeta,
        enhancedSize: dbEnhancedMeta,
        upscaleLevel,
        prompt,
        style
      }
    });

  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Image generation failed'
    });
  }
});

// @route POST /api/generate/batch
router.post('/batch', protect, async (req, res) => {
  try {
    const { prompts, style = 'realistic', upscaleLevel = 'HD' } = req.body;

    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide an array of prompts' });
    }

    if (prompts.length > 4) {
      return res.status(400).json({ success: false, message: 'Maximum 4 images per batch' });
    }

    if (req.user.credits < prompts.length) {
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. Need ${prompts.length}, have ${req.user.credits}`
      });
    }

    res.json({
      success: true,
      message: 'Batch generation started',
      data: { totalImages: prompts.length, status: 'processing' }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
