// FUTUREHAT mobile — tiny decoupled bridge so the full-screen MediaPreview editor
// can hand finished attachments back to the owning ChatScreen WITHOUT threading a
// function through navigation params (which React Navigation warns against and which
// breaks serialization/deep-links). ChatScreen registers a handler while focused;
// the preview screen calls submitMedia() then navigates back. Keeps ChatScreen the
// single owner of the real send/upload/outbox pipeline.
import type { UUID } from '../lib/shared';
import type { MediaMeta } from '../lib/shared';

export interface OutgoingMedia {
  uri: string;
  fileName: string;
  type: 'image' | 'file';   // 'file' carries video (schema has no 'video' type)
  caption?: string;
  mediaMeta?: MediaMeta;
}

export interface MediaSubmission {
  conversationId: UUID;
  items: OutgoingMedia[];
}

type Handler = (sub: MediaSubmission) => void;

const handlers = new Map<UUID, Handler>();

/** ChatScreen registers a handler for its conversation while focused. Returns an
 *  unsubscribe. If two screens register the same conversation, the latest wins. */
export function registerMediaHandler(conversationId: UUID, fn: Handler): () => void {
  handlers.set(conversationId, fn);
  return () => { if (handlers.get(conversationId) === fn) handlers.delete(conversationId); };
}

/** The preview screen calls this when the user taps Send. Returns true if a live
 *  handler consumed it (ChatScreen was mounted), false otherwise. */
export function submitMedia(sub: MediaSubmission): boolean {
  const fn = handlers.get(sub.conversationId);
  if (!fn) return false;
  fn(sub);
  return true;
}
