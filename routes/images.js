const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/auth');
const Image = require('../models/Image');

// @route GET /api/images/stats
router.get('/stats', protect, async (req, res) => {
  try {
    const [totalGenerated, totalUpscaled, favorites] = await Promise.all([
      Image.countDocuments({ user: req.user._id, type: { $in: ['generated', 'enhanced'] } }),
      Image.countDocuments({ user: req.user._id, type: 'upscaled' }),
      Image.countDocuments({ user: req.user._id, isFavorite: true })
    ]);

    res.json({
      success: true,
      data: {
        totalGenerated,
        totalUpscaled,
        favorites,
        credits: req.user.credits
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route GET /api/images/download
router.get('/download', async (req, res) => {
  try {
    const { filename } = req.query;
    if (!filename) {
      return res.status(400).json({ success: false, message: 'Filename parameter is required' });
    }

    // Validate filename to prevent directory traversal
    const cleanFilename = path.basename(filename);
    if (cleanFilename !== filename || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    const uploadsDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '../uploads');
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    res.download(filePath, filename);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

