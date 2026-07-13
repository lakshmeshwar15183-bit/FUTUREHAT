// Lumixo — apply quality tier before upload (WhatsApp-class resize + JPEG).
// Standard ≈ 1600px long edge @ 0.72 · HD ≈ 2560px @ 0.85 · Original = passthrough.
import * as ImageManipulator from 'expo-image-manipulator';

import type { Quality } from './qualityEstimate';

const LONG_EDGE: Record<Quality, number> = {
  standard: 1600,
  hd: 2560,
  original: Number.POSITIVE_INFINITY,
};

const JPEG_QUALITY: Record<Quality, number> = {
  standard: 0.72,
  hd: 0.85,
  original: 1,
};

export async function prepareImageForSend(
  uri: string,
  width: number,
  height: number,
  quality: Quality,
): Promise<{ uri: string; width: number; height: number }> {
  if (quality === 'original' || !uri) {
    return { uri, width, height };
  }

  try {
    const actions: ImageManipulator.Action[] = [];
    const long = Math.max(width || 0, height || 0) || 1600;
    const cap = LONG_EDGE[quality];
    if (long > cap && width > 0 && height > 0) {
      const scale = cap / long;
      actions.push({
        resize: {
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
        },
      });
    }

    const out = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: JPEG_QUALITY[quality],
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return {
      uri: out.uri,
      width: out.width || width,
      height: out.height || height,
    };
  } catch {
    // Never block send on compressor failure — ship the original.
    return { uri, width, height };
  }
}
