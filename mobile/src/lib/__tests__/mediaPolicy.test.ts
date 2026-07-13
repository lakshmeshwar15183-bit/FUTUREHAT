/**
 * On-demand media policy (WhatsApp/Telegram-class defaults).
 */
import {
  DEFAULT_MEDIA_STORAGE,
  formatBytes,
  formatDurationMs,
  shouldAutoDownload,
  setMediaStorageSettings,
  getMediaStorageSettings,
} from '../mediaPolicy';

describe('mediaPolicy defaults', () => {
  it('defaults to download-only-when-tapped (no reinstall flood)', () => {
    expect(DEFAULT_MEDIA_STORAGE.downloadOnlyWhenTapped).toBe(true);
    expect(DEFAULT_MEDIA_STORAGE.autoDownloadWifi).toBe(false);
    expect(DEFAULT_MEDIA_STORAGE.autoDownloadCellular).toBe(false);
    expect(DEFAULT_MEDIA_STORAGE.autoDownloadRoaming).toBe(false);
  });

  it('never auto-downloads when tap-only is on', async () => {
    const s = {
      ...DEFAULT_MEDIA_STORAGE,
      downloadOnlyWhenTapped: true,
      autoDownloadWifi: true,
    };
    await setMediaStorageSettings(s);
    expect(shouldAutoDownload('image', 'wifi', false, s)).toBe(false);
    expect(shouldAutoDownload('video', 'wifi', false, s)).toBe(false);
    expect(shouldAutoDownload('document', 'cellular', false, s)).toBe(false);
  });

  it('allows wifi auto-download when explicitly enabled', async () => {
    const s = {
      ...DEFAULT_MEDIA_STORAGE,
      downloadOnlyWhenTapped: false,
      autoDownloadWifi: true,
      autoDownloadCellular: false,
      autoDownloadRoaming: false,
    };
    await setMediaStorageSettings(s);
    expect(shouldAutoDownload('image', 'wifi', false, s)).toBe(true);
    expect(shouldAutoDownload('image', 'cellular', false, s)).toBe(false);
    expect(shouldAutoDownload('image', 'none', false, s)).toBe(false);
  });

  it('formats helpers', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toMatch(/KB/);
    expect(formatDurationMs(65_000)).toBe('1:05');
    expect(formatDurationMs(null)).toBe('');
  });

  it('exposes current settings after set', async () => {
    await setMediaStorageSettings({ maxCacheBytes: 256 * 1024 * 1024 });
    expect(getMediaStorageSettings().maxCacheBytes).toBe(256 * 1024 * 1024);
  });
});
