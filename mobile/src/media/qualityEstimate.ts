// Lumixo mobile — rough upload-size estimate per quality tier, so the preview
// screen can show "~2.3 MB" before sending (WhatsApp-style). These are heuristics,
// not exact encoder output — real size is known only after compression (Phase B/C).

export type Quality = 'standard' | 'hd' | 'original';

export interface SizeInput {
  width: number;
  height: number;
  type: 'image' | 'video';
  durationMs?: number;
  originalBytes?: number;   // if known from the picker
}

// Target long-edge per tier for images (px). Standard mirrors WhatsApp's ~1600px.
const IMG_LONG_EDGE: Record<Quality, number> = { standard: 1600, hd: 2560, original: Infinity };
// Approx bits-per-pixel after JPEG at each tier.
const IMG_BPP: Record<Quality, number> = { standard: 1.2, hd: 2.0, original: 3.0 };
// Video target bitrate (bits/sec) per tier.
const VID_BITRATE: Record<Quality, number> = { standard: 1_200_000, hd: 3_500_000, original: 8_000_000 };

/** Estimated upload size in bytes for a given asset + quality tier. */
export function estimateBytes(input: SizeInput, quality: Quality): number {
  if (input.type === 'video') {
    const secs = Math.max(1, (input.durationMs ?? 0) / 1000);
    if (quality === 'original' && input.originalBytes) return input.originalBytes;
    return Math.round((VID_BITRATE[quality] * secs) / 8);
  }
  // image
  if (quality === 'original' && input.originalBytes) return input.originalBytes;
  const longEdge = Math.max(input.width, input.height) || 1600;
  const scale = Math.min(1, IMG_LONG_EDGE[quality] / longEdge);
  const w = input.width * scale, h = input.height * scale;
  return Math.round((w * h * IMG_BPP[quality]) / 8);
}

/** Human label, e.g. "2.3 MB" / "740 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
