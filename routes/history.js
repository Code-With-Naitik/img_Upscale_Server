const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Image = require('../models/Image');

// @route GET /api/history
router.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 12, type, search } = req.query;
    const query = { user: req.user._id };

    if (type && type !== 'all') query.type = type;
    if (search) query.prompt = { $regex: search, $options: 'i' };

    const total = await Image.countDocuments(query);
    const images = await Image.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        images,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route DELETE /api/history/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const image = await Image.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id
    });
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    res.json({ success: true, message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route PATCH /api/history/:id/favorite
router.patch('/:id/favorite', protect, async (req, res) => {
  try {
    const image = await Image.findOne({ _id: req.params.id, user: req.user._id });
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    image.isFavorite = !image.isFavorite;
    await image.save();
    res.json({ success: true, data: { isFavorite: image.isFavorite } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
