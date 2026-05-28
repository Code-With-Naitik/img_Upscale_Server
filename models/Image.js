const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  type: {
    type: String,
    enum: ['generated', 'upscaled', 'enhanced'],
    required: true
  },
  prompt: {
    type: String,
    default: null
  },
  originalUrl: {
    type: String,
    required: true
  },
  enhancedUrl: {
    type: String,
    default: null
  },
  originalSize: {
    width: Number,
    height: Number,
    fileSize: Number
  },
  enhancedSize: {
    width: Number,
    height: Number,
    fileSize: Number
  },
  upscaleLevel: {
    type: String,
    enum: ['HD', '2K', '4K', '8K', null],
    default: null
  },
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing'
  },
  model: {
    type: String,
    default: 'stable-diffusion-xl'
  },
  style: {
    type: String,
    default: 'realistic'
  },
  isFavorite: {
    type: Boolean,
    default: false
  },
  tags: [String],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

module.exports = mongoose.model('Image', imageSchema);
