const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { InferenceClient } = require('@huggingface/inference');

/**
 * Generate image using Hugging Face Inference SDK
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

  const styleEnhancements = {
    realistic: 'ultra realistic, photorealistic, DSLR quality, sharp focus, cinematic lighting, HDR, 8k resolution, professional photography',
    anime: 'anime style, high quality anime art, detailed, vibrant colors, studio quality',
    artistic: 'digital art, concept art, highly detailed, artstation quality, dramatic lighting',
    portrait: 'professional portrait, studio lighting, sharp eyes, detailed skin texture, bokeh background, 50mm lens',
    landscape: 'epic landscape, wide angle, golden hour, dramatic sky, ultra detailed, nature photography',
    fantasy: 'fantasy art, magical, ethereal, cinematic, highly detailed, concept art'
  };

  const enhancedPrompt = `${prompt}, ${styleEnhancements[style] || styleEnhancements.realistic}`;

  // Helper function to try generating with Pollinations AI as a free ultimate fallback
  const generateWithPollinations = async (reason) => {
    console.log(`Hugging Face error (${reason}). Falling back to Pollinations AI...`);
    try {
      const url = `https://image.pollinations.ai/p/${encodeURIComponent(enhancedPrompt)}?width=${width}&height=${height}&nologo=true`;
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000
      });
      return Buffer.from(response.data);
    } catch (pollErr) {
      console.error('Pollinations AI fallback failed:', pollErr.message);
      throw new Error(`Image generation failed. HF error: ${reason}. Pollinations fallback error: ${pollErr.message}`);
    }
  };

  const apiKey = (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '').trim();
  if (!apiKey) {
    return await generateWithPollinations('API key not configured');
  }

  const client = new InferenceClient(apiKey);

  try {
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
  } catch (err) {
    console.error(`Primary model (${model}) failed:`, err.message);

    // If it's a quota/payment/billing error, or authorization issue, fall back directly to Pollinations AI
    const errMsg = err.message.toLowerCase();
    if (
      errMsg.includes('credits') || 
      errMsg.includes('quota') || 
      errMsg.includes('billing') || 
      errMsg.includes('unauthorized') || 
      errMsg.includes('402') || 
      errMsg.includes('401')
    ) {
      return await generateWithPollinations(err.message);
    }

    // Try fallback to FLUX.1-schnell (serverless / default provider)
    try {
      console.log('Attempting fallback to black-forest-labs/FLUX.1-schnell...');
      const fallbackBlob = await client.textToImage({
        model: 'black-forest-labs/FLUX.1-schnell',
        inputs: enhancedPrompt,
        parameters: {
          width: Math.min(width, 1024),
          height: Math.min(height, 1024)
        }
      });
      const arrayBuffer = await fallbackBlob.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (fallbackErr) {
      console.error('Fallback model failed:', fallbackErr.message);
      // Try Pollinations AI as ultimate fallback
      return await generateWithPollinations(`${err.message} (and fallback FLUX.1-schnell also failed: ${fallbackErr.message})`);
    }
  }
};

/**
 * Upscale/Enhance image using DeepAI or Clipdrop
 */
const upscaleImage = async (imagePath, upscaleLevel = 'HD') => {
  const deepAiKey = process.env.DEEPAI_API_KEY;
  const clipdropKey = process.env.CLIPDROP_API_KEY;

  if (!deepAiKey && !clipdropKey) {
    throw new Error('No upscaler API key configured');
  }

  // Try Clipdrop first
  if (clipdropKey) {
    try {
      return await upscaleWithClipdrop(imagePath, upscaleLevel, clipdropKey);
    } catch (err) {
      console.log('Clipdrop failed, trying DeepAI:', err.message);
    }
  }

  // Fallback to DeepAI
  if (deepAiKey) {
    return await upscaleWithDeepAI(imagePath, deepAiKey);
  }

  throw new Error('All upscaler APIs failed');
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
