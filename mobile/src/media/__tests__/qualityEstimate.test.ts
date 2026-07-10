// Real unit tests for upload-size estimation shown on the media preview screen.
import { estimateBytes, formatBytes } from '../qualityEstimate';

describe('estimateBytes — images', () => {
  it('downscales to the tier long-edge before estimating', () => {
    // A 4000px-wide image at 'standard' (1600px long edge) must estimate smaller
    // than at 'hd' (2560px), which must be smaller than 'original'.
    const img = { width: 4000, height: 3000, type: 'image' as const };
    const std = estimateBytes(img, 'standard');
    const hd = estimateBytes(img, 'hd');
    const orig = estimateBytes(img, 'original');
    expect(std).toBeLessThan(hd);
    expect(hd).toBeLessThan(orig);
    expect(std).toBeGreaterThan(0);
  });

  it('never upscales a small image (scale capped at 1)', () => {
    const small = { width: 800, height: 600, type: 'image' as const };
    // At standard the long edge (800) is already under 1600, so no scaling.
    const bytes = estimateBytes(small, 'standard');
    // Expected ~ (800*600*1.2)/8 = 72000.
    expect(bytes).toBe(Math.round((800 * 600 * 1.2) / 8));
  });

  it('returns the known original size for the original tier', () => {
    const img = { width: 4000, height: 3000, type: 'image' as const, originalBytes: 5_000_000 };
    expect(estimateBytes(img, 'original')).toBe(5_000_000);
  });
});

describe('estimateBytes — video', () => {
  it('scales with duration and bitrate tier', () => {
    const vid = { width: 1920, height: 1080, type: 'video' as const, durationMs: 10_000 };
    const std = estimateBytes(vid, 'standard'); // 1.2Mbps * 10s / 8
    expect(std).toBe(Math.round((1_200_000 * 10) / 8));
    expect(estimateBytes(vid, 'hd')).toBeGreaterThan(std);
  });

  it('treats missing duration as at least 1 second', () => {
    const vid = { width: 640, height: 480, type: 'video' as const };
    expect(estimateBytes(vid, 'standard')).toBe(Math.round((1_200_000 * 1) / 8));
  });
});

describe('formatBytes', () => {
  it('formats MB / KB / B thresholds', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(512)).toBe('512 B');
  });
});
