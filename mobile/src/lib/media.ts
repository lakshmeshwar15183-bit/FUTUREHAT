// FUTUREHAT mobile — file I/O adapter between native pickers (which hand back
// local `file://` URIs) and the shared Supabase upload helpers (which take raw
// bytes). This is platform glue, not business logic — the bucket/path/URL rules
// all live in `shared/api.ts`.
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';

import { supabase } from './supabase';
import { uploadMedia, uploadAvatar, uploadStatusMedia } from './shared';
import type { UUID } from './shared';

async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return decode(base64);
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
};

export function guessMime(fileName: string, fallback = 'application/octet-stream'): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? fallback;
}

/** Upload a picked media file (image/video/doc/audio) to a conversation. */
export async function uploadMediaFromUri(
  conversationId: UUID,
  uri: string,
  fileName: string,
  mimeType?: string,
): Promise<{ url: string | null; error: Error | null }> {
  try {
    const buf = await uriToArrayBuffer(uri);
    return uploadMedia(
      supabase,
      conversationId,
      buf,
      fileName,
      mimeType ?? guessMime(fileName),
    );
  } catch (e: any) {
    return { url: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Upload status media (image/video/audio) from a local URI to the `status` bucket. */
export async function uploadStatusMediaFromUri(
  userId: UUID,
  uri: string,
  ext: string,
  mimeType?: string,
): Promise<{ url: string | null; error: Error | null }> {
  try {
    const buf = await uriToArrayBuffer(uri);
    return uploadStatusMedia(supabase, userId, buf, ext, mimeType ?? guessMime(`f.${ext}`));
  } catch (e: any) {
    return { url: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Upload a profile photo from a local URI. */
export async function uploadAvatarFromUri(
  userId: UUID,
  uri: string,
): Promise<{ url: string | null; error: Error | null }> {
  try {
    const buf = await uriToArrayBuffer(uri);
    return uploadAvatar(supabase, userId, buf, 'image/jpeg');
  } catch (e: any) {
    return { url: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
