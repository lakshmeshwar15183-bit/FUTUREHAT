// Lumixo — turn MediaLibrary assets / picker URIs into a reliably displayable
// local file path. Android 10–16 Photo Picker and MediaStore often hand out
// content:// (or opaque) URIs that render as a black frame in full-screen
// expo-image / fail ImageManipulator. We resolve localUri via getAssetInfoAsync
// and, when needed, copy into the app cache as file://.
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

export type ResolvedLocalMedia = {
  uri: string;
  width: number;
  height: number;
  /** True when we copied into cache (caller may treat as ephemeral). */
  cachedCopy: boolean;
};

function extFromName(name?: string | null, mediaType?: string): string {
  const m = name?.match(/\.([a-zA-Z0-9]{2,5})$/);
  if (m) return m[1].toLowerCase();
  if (mediaType === 'video') return 'mp4';
  return 'jpg';
}

/** True for URIs that are already local files / data (no resolution needed). */
export function isDirectlyLoadableUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  return (
    uri.startsWith('file://') ||
    uri.startsWith('data:') ||
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('asset:/') ||
    uri.startsWith('assets-library:') // legacy iOS
  );
}

/**
 * Copy a content:// (or other non-file) URI into the app cache so Image /
 * ImageManipulator / Skia can open it without a black frame.
 */
export async function materializeToCache(
  uri: string,
  opts?: { id?: string; fileName?: string; mediaType?: 'image' | 'video' },
): Promise<string> {
  if (isDirectlyLoadableUri(uri) && uri.startsWith('file://')) return uri;
  const base = FileSystem.cacheDirectory;
  if (!base) return uri;
  const ext = extFromName(opts?.fileName, opts?.mediaType);
  const safeId = (opts?.id || 'media').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  const dest = `${base}lumixo_media_${safeId}_${Date.now()}.${ext}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest.startsWith('file://') ? dest : `file://${dest}`;
  } catch {
    // Some providers need downloadAsync instead of copyAsync.
    try {
      const res = await FileSystem.downloadAsync(uri, dest);
      const out = res.uri;
      return out.startsWith('file://') ? out : `file://${out}`;
    } catch {
      return uri;
    }
  }
}

/**
 * Resolve a MediaLibrary asset to a URI that full-screen preview + editors can
 * open on Android 11–16 and iOS. Prefer localUri; materialize content://.
 */
export async function resolveMediaLibraryAsset(
  asset: MediaLibrary.Asset,
): Promise<ResolvedLocalMedia> {
  let uri = asset.uri;
  let width = asset.width || 0;
  let height = asset.height || 0;
  let cachedCopy = false;

  try {
    const info = await MediaLibrary.getAssetInfoAsync(asset, {
      shouldDownloadFromNetwork: true,
    });
    uri = info.localUri || info.uri || asset.uri;
    width = info.width || width;
    height = info.height || height;
  } catch {
    // keep asset.uri
  }

  if (!isDirectlyLoadableUri(uri) || uri.startsWith('content://')) {
    const next = await materializeToCache(uri, {
      id: asset.id,
      fileName: asset.filename,
      mediaType: asset.mediaType === MediaLibrary.MediaType.video ? 'video' : 'image',
    });
    if (next !== uri) {
      uri = next;
      cachedCopy = true;
    }
  }

  // Ensure file:// prefix for bare absolute paths (some Android builds).
  if (uri.startsWith('/') && !uri.startsWith('file://')) {
    uri = `file://${uri}`;
  }

  return { uri, width, height, cachedCopy };
}

/** Resolve an already-picked URI (e.g. camera capture) the same way. */
export async function resolvePickedUri(
  uri: string,
  opts?: { id?: string; fileName?: string; mediaType?: 'image' | 'video'; width?: number; height?: number },
): Promise<ResolvedLocalMedia> {
  let out = uri;
  let cachedCopy = false;
  if (!isDirectlyLoadableUri(out) || out.startsWith('content://')) {
    const next = await materializeToCache(out, opts);
    if (next !== out) {
      out = next;
      cachedCopy = true;
    }
  }
  if (out.startsWith('/') && !out.startsWith('file://')) out = `file://${out}`;
  return {
    uri: out,
    width: opts?.width ?? 0,
    height: opts?.height ?? 0,
    cachedCopy,
  };
}
