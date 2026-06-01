const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { InferenceClient } = require('@huggingface/inference');
const OpenAI = require('openai');

// ─── Style enhancement map ───────────────────────────────────────────────────
const styleEnhancements = {
  realistic: 'ultra realistic, photorealistic, DSLR quality, sharp focus, cinematic lighting, HDR, 8k resolution, professional photography',
  anime: 'anime style, high quality anime art, detailed, vibrant colors, studio quality',
  artistic: 'digital art, concept art, highly detailed, artstation quality, dramatic lighting',
  portrait: 'professional portrait, studio lighting, sharp eyes, detailed skin texture, bokeh background, 50mm lens',
  landscape: 'epic landscape, wide angle, golden hour, dramatic sky, ultra detailed, nature photography',
  fantasy: 'fantasy art, magical, ethereal, cinematic, highly detailed, concept art'
};

// ─── OpenAI gpt-image-1 generator ───────────────────────────────────────────
const generateWithOpenAI = async (enhancedPrompt, width = 1024, height = 1024) => {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const openai = new OpenAI({ apiKey });

  // gpt-image-1 supports: 1024x1024, 1536x1024, 1024x1536, auto
  let size = '1024x1024';
  if (width > height) size = '1536x1024';
  else if (height > width) size = '1024x1536';

  console.log(`[OpenAI] Generating with gpt-image-1, size: ${size}`);

  // gpt-image-1 always returns base64 (b64_json)
  const response = await openai.images.generate({
    model: 'gpt-image-1',
    prompt: enhancedPrompt,
    n: 1,
    size,
    quality: 'medium'   // gpt-image-1 values: 'low' | 'medium' | 'high' | 'auto'
  });

  const imgData = response.data[0];

  // gpt-image-1 returns b64_json by default
  if (imgData.b64_json) {
    console.log('[OpenAI] gpt-image-1 image received as base64 ✅');
    return Buffer.from(imgData.b64_json, 'base64');
  }

  // Fallback: URL mode (if ever returned)
  if (imgData.url) {
    console.log('[OpenAI] gpt-image-1 image URL received, downloading...');
    const imgResponse = await axios.get(imgData.url, {
      responseType: 'arraybuffer',
      timeout: 60000
    });
    return Buffer.from(imgResponse.data);
  }

  throw new Error('gpt-image-1 returned no image data');
};

// ─── HuggingFace generator ────────────────────────────────────────────────────
const generateWithHuggingFace = async (enhancedPrompt, options = {}) => {
  const {
    width = 1024,
    height = 1024,
    model = 'black-forest-labs/FLUX.1-Krea-dev',
    provider = 'fal-ai'
  } = options;

  const apiKey = (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '').trim();
  if (!apiKey) throw new Error('HUGGINGFACE_API_KEY not configured');

  const client = new InferenceClient(apiKey);

  const requestOptions = {
    model,
    inputs: enhancedPrompt,
    parameters: {
      num_inference_steps: 5,
      width: Math.min(width, 1024),
      height: Math.min(height, 1024)
    }
  };

  if (provider && provider !== 'auto') {
    requestOptions.provider = provider;
  }

  const imageBlob = await client.textToImage(requestOptions);
  const arrayBuffer = await imageBlob.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// ─── Pollinations AI (free, no key needed) ────────────────────────────────────
const generateWithPollinations = async (enhancedPrompt, width = 1024, height = 1024) => {
  console.log('[Pollinations] Using free fallback...');
  const url = `https://image.pollinations.ai/p/${encodeURIComponent(enhancedPrompt)}?width=${width}&height=${height}&nologo=true`;
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000
  });
  return Buffer.from(response.data);
};

// ─── Main generateImage function ─────────────────────────────────────────────
/**
 * Generate image using OpenAI DALL-E 3 (primary) → HuggingFace FLUX (fallback) → Pollinations AI (free fallback)
 */
const generateImage = async (prompt, options = {}) => {
  const {
    style = 'realistic',
    width = 1024,
    height = 1024,
    negativePrompt = '',
    model = 'black-forest-labs/FLUX.1-Krea-dev',
    provider = 'fal-ai'
  } = options;

  const enhancedPrompt = `${prompt}, ${styleEnhancements[style] || styleEnhancements.realistic}`;

  // ── 1. Try OpenAI DALL-E 3 (primary) ──────────────────────────────────────
  const openAiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (openAiKey) {
    try {
      const buffer = await generateWithOpenAI(enhancedPrompt, width, height);
      console.log('[OpenAI] Image generated successfully via DALL-E 3 ✅');
      return buffer;
    } catch (openAiErr) {
      console.error('[OpenAI] DALL-E 3 failed:', openAiErr.message);

      // If billing/quota issue, skip to HuggingFace then Pollinations
      const errMsg = openAiErr.message.toLowerCase();
      if (
        errMsg.includes('quota') ||
        errMsg.includes('billing') ||
        errMsg.includes('billing_hard_limit') ||
        errMsg.includes('insufficient_quota') ||
        errMsg.includes('rate_limit')
      ) {
        console.warn('[OpenAI] Quota/billing limit hit — falling back to HuggingFace/Pollinations');
        // Don't return here — let it fall through to HuggingFace below
      }
      // Otherwise, try HuggingFace next
      console.log('[Fallback] Trying HuggingFace...');
    }
  }

  // ── 2. Try HuggingFace FLUX (fallback) ────────────────────────────────────
  const hfKey = (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '').trim();
  if (hfKey) {
    try {
      const buffer = await generateWithHuggingFace(enhancedPrompt, { width, height, model, provider });
      console.log('[HuggingFace] Image generated successfully ✅');
      return buffer;
    } catch (hfErr) {
      console.error('[HuggingFace] Primary model failed:', hfErr.message);

      // Try FLUX.1-schnell as HF sub-fallback
      try {
        const client = new InferenceClient(hfKey);
        const fallbackBlob = await client.textToImage({
          model: 'black-forest-labs/FLUX.1-schnell',
          inputs: enhancedPrompt,
          parameters: { width: Math.min(width, 1024), height: Math.min(height, 1024) }
        });
        const arrayBuffer = await fallbackBlob.arrayBuffer();
        console.log('[HuggingFace] FLUX.1-schnell fallback succeeded ✅');
        return Buffer.from(arrayBuffer);
      } catch (hfFallbackErr) {
        console.error('[HuggingFace] FLUX.1-schnell also failed:', hfFallbackErr.message);
      }
    }
  }

  // ── 3. Free Pollinations AI (ultimate fallback) ───────────────────────────
  try {
    const buffer = await generateWithPollinations(enhancedPrompt, width, height);
    console.log('[Pollinations] Image generated successfully ✅');
    return buffer;
  } catch (pollErr) {
    throw new Error(`All image generation providers failed. Last error: ${pollErr.message}`);
  }
};

// ─── Upscale image ────────────────────────────────────────────────────────────
/**
 * Upscale image using paid APIs: Clipdrop → DeepAI
 * Falls back to local Sharp (in the route) if both fail.
 * HuggingFace Swin2SR was removed — it returned corrupted image data.
 */
const upscaleImage = async (imagePath, upscaleLevel = 'HD') => {
  const clipdropKey = (process.env.CLIPDROP_API_KEY || '').trim();
  const deepAiKey   = (process.env.DEEPAI_API_KEY   || '').trim();

  // ── 1. Clipdrop (best quality paid upscaler) ───────────────────────────────
  if (clipdropKey) {
    try {
      console.log('[Upscale] Trying Clipdrop...');
      const buf = await upscaleWithClipdrop(imagePath, upscaleLevel, clipdropKey);
      if (await isValidBuffer(buf)) return buf;
      console.log('[Clipdrop] Returned invalid image data');
    } catch (err) {
      console.log('[Clipdrop] Failed:', err.message);
    }
  }

  // ── 2. DeepAI ──────────────────────────────────────────────────────────────
  if (deepAiKey) {
    try {
      console.log('[Upscale] Trying DeepAI...');
      const buf = await upscaleWithDeepAI(imagePath, deepAiKey);
      if (await isValidBuffer(buf)) return buf;
      console.log('[DeepAI] Returned invalid image data');
    } catch (err) {
      console.log('[DeepAI] Failed:', err.message);
    }
  }

  // No paid APIs configured — route will fall back to local Sharp
  throw new Error('No paid upscaler API configured — using local Sharp');
};

/**
 * Validate that a buffer contains a real decodable image (not garbage/JSON error).
 */
const isValidBuffer = async (buffer) => {
  try {
    const sharp = require('sharp');
    const meta = await sharp(buffer).metadata();
    return meta.width > 0 && meta.height > 0 && !!meta.format;
  } catch {
    return false;
  }
};

const upscaleWithClipdrop = async (imagePath, upscaleLevel, apiKey) => {
  const scaleMap = { 'HD': 2, '2K': 2, '4K': 4, '8K': 8 };
  const scale = scaleMap[upscaleLevel] || 2;

  const formData = new FormData();
  formData.append('image_file', fs.createReadStream(imagePath));
  formData.append('target_width', scale === 2 ? 2048 : scale === 4 ? 4096 : 1920);
  formData.append('target_height', scale === 2 ? 2048 : scale === 4 ? 4096 : 1080);

  const response = await axios.post(
    'https://clipdrop-api.co/image-upscaling/v1/upscale',
    formData,
    {
      headers: {
        'x-api-key': apiKey,
        ...formData.getHeaders()
      },
      responseType: 'arraybuffer',
      timeout: 60000
    }
  );

  return Buffer.from(response.data);
};

const upscaleWithDeepAI = async (imagePath, apiKey) => {
  const formData = new FormData();
  formData.append('image', fs.createReadStream(imagePath));

  const response = await axios.post(
    'https://api.deepai.org/api/torch-srgan',
    formData,
    {
      headers: {
        'api-key': apiKey,
        ...formData.getHeaders()
      },
      timeout: 60000
    }
  );

  // DeepAI returns URL, fetch it
  if (response.data && response.data.output_url) {
    const imgResponse = await axios.get(response.data.output_url, {
      responseType: 'arraybuffer'
    });
    return Buffer.from(imgResponse.data);
  }

  throw new Error('DeepAI returned no output URL');
};

module.exports = { generateImage, upscaleImage };
