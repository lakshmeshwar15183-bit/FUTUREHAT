// Lumixo web — durable offline outbox.
// Metadata in localStorage; media bytes in IndexedDB (mediaBlobStore).
// Survives refresh; flushes on online / interval / manual flushOutbox().

import { supabase } from '../supabase';
import { sendMessage, editMessage, uploadMedia, retryDelayMs } from '@shared/api';
import { sendPush } from '@shared/pushApi';
import type { Message, MessageType, UUID } from '@shared/types';
import { deleteMediaBlob, getMediaBlob, putMediaBlob } from './mediaBlobStore';

const KEY = 'lumixo_outbox_v1';
const MAX_ATTEMPTS = 25;
/** Per-item next-retry timestamp (ms). Survives only in-memory for this tab. */
const nextRetryAt = new Map<string, number>();

export interface WebOutboxItem {
  id: string; // client id (also used as message PK when possible)
  conversationId: UUID;
  kind: 'send' | 'edit';
  content: string;
  type: MessageType;
  mediaUrl?: string | null;
  /** IndexedDB key for offline blob upload on flush. */
  blobKey?: string | null;
  fileName?: string;
  replyTo?: UUID | null;
  messageId?: UUID; // for edit
  createdAt: string;
  attempts: number;
  senderId?: string;
  /** Sticker / View Once / quality meta (0030+). */
  mediaMeta?: Record<string, unknown> | null;
}

type Listener = (item: WebOutboxItem, result: Message | null, error?: string) => void;

const listeners = new Set<Listener>();
let flushing = false;
let needsReflush = false;
let started = false;

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function read(): WebOutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: WebOutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota — drop oldest */
    try {
      localStorage.setItem(KEY, JSON.stringify(items.slice(-50)));
    } catch { /* ignore */ }
  }
}

export function onOutboxEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getOutbox(): WebOutboxItem[] {
  return read();
}

export function getOutboxForConversation(conversationId: string): WebOutboxItem[] {
  return read().filter((i) => i.conversationId === conversationId);
}

export async function enqueueSend(args: {
  conversationId: UUID;
  content: string;
  type?: MessageType;
  mediaUrl?: string | null;
  /** Local file/blob for offline-first upload on reconnect. */
  file?: File | Blob | null;
  fileName?: string;
  replyTo?: UUID | null;
  senderId?: string;
  id?: string;
  mediaMeta?: Record<string, unknown> | null;
}): Promise<WebOutboxItem> {
  const id = args.id ?? uuid();
  let blobKey: string | undefined;
  if (args.file && !args.mediaUrl) {
    blobKey = `blob_${id}`;
    try {
      await putMediaBlob(blobKey, args.file, {
        fileName: args.fileName ?? (args.file instanceof File ? args.file.name : 'file'),
        mime: args.file.type || undefined,
      });
    } catch {
      blobKey = undefined; // fall through — may fail offline without IDB
    }
  }
  const item: WebOutboxItem = {
    id,
    conversationId: args.conversationId,
    kind: 'send',
    content: args.content,
    type: args.type ?? 'text',
    mediaUrl: args.mediaUrl,
    blobKey,
    fileName: args.fileName,
    replyTo: args.replyTo,
    createdAt: new Date().toISOString(),
    attempts: 0,
    senderId: args.senderId,
    mediaMeta: args.mediaMeta ?? null,
  };
  const box = read();
  box.push(item);
  write(box);
  void flushOutbox();
  return item;
}

export async function enqueueEdit(args: {
  conversationId: UUID;
  messageId: UUID;
  content: string;
}): Promise<WebOutboxItem> {
  const item: WebOutboxItem = {
    id: uuid(),
    conversationId: args.conversationId,
    kind: 'edit',
    content: args.content,
    type: 'text',
    messageId: args.messageId,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const box = read();
  box.push(item);
  write(box);
  void flushOutbox();
  return item;
}

export async function flushOutbox(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (flushing) {
    needsReflush = true;
    return;
  }
  flushing = true;
  needsReflush = false;
  try {
    do {
      needsReflush = false;
      const box = read();
      const next: WebOutboxItem[] = [];
      for (const item of box) {
        if (item.attempts >= MAX_ATTEMPTS) {
          nextRetryAt.delete(item.id);
          listeners.forEach((l) => l(item, null, 'max_attempts'));
          continue;
        }
        // Exponential backoff — skip items not yet due (poor network resilience).
        const due = nextRetryAt.get(item.id) ?? 0;
        if (due > Date.now()) {
          next.push(item);
          continue;
        }
        try {
          if (item.kind === 'edit' && item.messageId) {
            const { message, error } = await editMessage(supabase, item.messageId, item.content);
            if (error || !message) {
              const attempts = item.attempts + 1;
              nextRetryAt.set(item.id, Date.now() + retryDelayMs(attempts));
              next.push({ ...item, attempts });
              continue;
            }
            nextRetryAt.delete(item.id);
            listeners.forEach((l) => l(item, message));
            continue;
          }

          // Offline media: upload IndexedDB blob → remote URL before insert.
          let mediaUrl = item.mediaUrl ?? undefined;
          if (item.blobKey && !mediaUrl) {
            const stored = await getMediaBlob(item.blobKey);
            if (!stored) {
              const attempts = item.attempts + 1;
              nextRetryAt.set(item.id, Date.now() + retryDelayMs(attempts));
              next.push({ ...item, attempts });
              continue;
            }
            const { url, error: upErr } = await uploadMedia(
              supabase,
              item.conversationId,
              stored.blob,
              item.fileName || stored.fileName || `media_${item.id}`,
              stored.mime,
            );
            if (upErr || !url) {
              const attempts = item.attempts + 1;
              nextRetryAt.set(item.id, Date.now() + retryDelayMs(attempts));
              next.push({ ...item, attempts });
              continue;
            }
            mediaUrl = url;
            // Persist URL so a mid-flush crash does not re-upload forever.
            const cur = read().map((x) =>
              x.id === item.id ? { ...x, mediaUrl: url, blobKey: undefined } : x,
            );
            write(cur);
            void deleteMediaBlob(item.blobKey).catch(() => {});
            item.mediaUrl = url;
            item.blobKey = undefined;
          }

          const { message, error } = await sendMessage(
            supabase,
            item.conversationId,
            item.content,
            item.type,
            mediaUrl,
            item.replyTo ?? undefined,
            item.id,
            item.mediaMeta as import('@shared/types').MediaMeta | undefined,
          );
          const dupe =
            !!error &&
            ((error as { code?: string }).code === '23505' ||
              /duplicate key|already exists/i.test(error.message ?? ''));
          if ((message && !error) || dupe) {
            const mid = message?.id ?? item.id;
            if (item.blobKey) void deleteMediaBlob(item.blobKey).catch(() => {});
            nextRetryAt.delete(item.id);
            listeners.forEach((l) => l(item, message));
            if (item.kind === 'send') {
              const preview =
                item.type === 'text'
                  ? (item.content || 'Message').slice(0, 180)
                  : item.type === 'image'
                    ? (item.mediaMeta as { sticker?: boolean } | null | undefined)?.sticker
                      ? `${(item.mediaMeta as { emoji?: string })?.emoji || '🎀'} Sticker`
                      : '📷 Photo'
                    : item.type === 'video'
                      ? '🎥 Video'
                      : item.type === 'audio'
                        ? '🎤 Voice message'
                        : 'New message';
              void sendPush(supabase, {
                conversationId: item.conversationId,
                kind: 'message',
                title: '',
                body: preview,
                data: {
                  messageId: mid,
                  messageType: item.type,
                  type: 'message',
                },
              });
            }
          } else {
            const attempts = item.attempts + 1;
            nextRetryAt.set(item.id, Date.now() + retryDelayMs(attempts));
            next.push({ ...item, attempts });
          }
        } catch {
          const attempts = item.attempts + 1;
          nextRetryAt.set(item.id, Date.now() + retryDelayMs(attempts));
          next.push({ ...item, attempts });
        }
      }
      write(next);
    } while (needsReflush);
  } finally {
    flushing = false;
    if (needsReflush) {
      needsReflush = false;
      void flushOutbox();
    }
  }
}

/** Call once from app root. */
export function startWebOutbox(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  const onOnline = () => void flushOutbox();
  window.addEventListener('online', onOnline);
  void flushOutbox();
  const interval = window.setInterval(() => void flushOutbox(), 30_000);
  return () => {
    window.removeEventListener('online', onOnline);
    clearInterval(interval);
    started = false;
  };
}

export function optimisticFromOutbox(item: WebOutboxItem, senderId: string): Message {
  return {
    id: item.id,
    conversation_id: item.conversationId,
    sender_id: senderId,
    type: item.type,
    content: item.content,
    media_url: item.mediaUrl ?? null,
    reply_to: item.replyTo ?? null,
    is_deleted: false,
    created_at: item.createdAt,
    edited_at: null,
    pending: true,
    media_meta: (item.mediaMeta ?? null) as Message['media_meta'],
  } as Message;
}
