var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// entry.js
var entry_exports = {};
__export(entry_exports, {
  localCache: () => localCache_exports,
  sync: () => sync_exports
});
module.exports = __toCommonJS(entry_exports);

// ../../mobile/src/lib/localCache.ts
var localCache_exports = {};
__export(localCache_exports, {
  MSG_CACHE_LIMIT: () => MSG_CACHE_LIMIT,
  cacheConversations: () => cacheConversations,
  cacheMessages: () => cacheMessages,
  cacheProfile: () => cacheProfile,
  cacheRecentContacts: () => cacheRecentContacts,
  enqueueAction: () => enqueueAction,
  enqueueOutbox: () => enqueueOutbox,
  getActionQueue: () => getActionQueue,
  getCache: () => getCache,
  getCachedConversations: () => getCachedConversations,
  getCachedMessages: () => getCachedMessages,
  getCachedProfile: () => getCachedProfile,
  getCachedRecentContacts: () => getCachedRecentContacts,
  getDraft: () => getDraft,
  getOutbox: () => getOutbox,
  getPendingMessages: () => getPendingMessages,
  mergeEffects: () => mergeEffects,
  pendingConversationEffects: () => pendingConversationEffects,
  reconcileIds: () => reconcileIds,
  removeAction: () => removeAction,
  removeFromOutbox: () => removeFromOutbox,
  setCache: () => setCache,
  setDraft: () => setDraft,
  updateAction: () => updateAction,
  updateOutboxItem: () => updateOutboxItem,
  upsertCachedMessage: () => upsertCachedMessage,
  uuidv4: () => uuidv4
});
var import_async_storage = __toESM(require("/Users/lakshmeshwarpandey/Lumixo/scripts/offline-test/mocks/async-storage.js"));
var K = {
  convs: (uid) => `fh:cache:convs:${uid}`,
  msgs: (convId) => `fh:cache:msgs:${convId}`,
  profile: (id) => `fh:cache:profile:${id}`,
  recent: (uid) => `fh:cache:recent:${uid}`,
  draft: (convId) => `fh:draft:${convId}`,
  outbox: "fh:outbox:v1",
  actions: "fh:actions:v1"
};
var MSG_CACHE_LIMIT = 800;
function uuidv4() {
  const g = globalThis;
  if (g.crypto?.randomUUID) {
    try {
      return g.crypto.randomUUID();
    } catch {
    }
  }
  if (g.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    g.crypto.getRandomValues(bytes);
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
async function readJSON(key, fallback) {
  try {
    const raw = await import_async_storage.default.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
async function writeJSON(key, value) {
  try {
    await import_async_storage.default.setItem(key, JSON.stringify(value));
  } catch {
  }
}
async function getCache(key, fallback) {
  return readJSON(`fh:cache:kv:${key}`, fallback);
}
async function setCache(key, value) {
  await writeJSON(`fh:cache:kv:${key}`, value);
}
async function getCachedConversations(uid) {
  return readJSON(K.convs(uid), []);
}
async function cacheConversations(uid, list) {
  await writeJSON(K.convs(uid), list);
  try {
    await Promise.all(
      list.flatMap((c) => c.participants).map((p) => writeJSON(K.profile(p.id), p))
    );
  } catch {
  }
}
async function getCachedMessages(convId) {
  return readJSON(K.msgs(convId), []);
}
var msgCacheChains = /* @__PURE__ */ new Map();
function withMsgCacheLock(convId, fn) {
  const prev = msgCacheChains.get(convId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  msgCacheChains.set(
    convId,
    run.then(
      () => void 0,
      () => void 0
    )
  );
  return run;
}
async function cacheMessages(convId, messages) {
  return withMsgCacheLock(convId, async () => {
    const existing = await getCachedMessages(convId);
    const map = /* @__PURE__ */ new Map();
    for (const m of existing) map.set(m.id, m);
    for (const m of messages) map.set(m.id, m);
    const merged = [...map.values()].sort(
      (a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    );
    const trimmed = merged.slice(-MSG_CACHE_LIMIT);
    await writeJSON(K.msgs(convId), trimmed);
  });
}
async function upsertCachedMessage(convId, message) {
  return withMsgCacheLock(convId, async () => {
    const cur = await getCachedMessages(convId);
    const idx = cur.findIndex((m) => m.id === message.id);
    if (idx >= 0) cur[idx] = message;
    else cur.push(message);
    const trimmed = cur.slice().sort(
      (a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    ).slice(-MSG_CACHE_LIMIT);
    await writeJSON(K.msgs(convId), trimmed);
  });
}
async function getCachedProfile(id) {
  return readJSON(K.profile(id), null);
}
async function cacheProfile(profile) {
  await writeJSON(K.profile(profile.id), profile);
}
async function getCachedRecentContacts(uid) {
  return readJSON(K.recent(uid), []);
}
async function cacheRecentContacts(uid, list) {
  await writeJSON(K.recent(uid), list);
}
async function getDraft(convId) {
  try {
    return await import_async_storage.default.getItem(K.draft(convId)) ?? "";
  } catch {
    return "";
  }
}
async function setDraft(convId, text) {
  try {
    if (text) await import_async_storage.default.setItem(K.draft(convId), text);
    else await import_async_storage.default.removeItem(K.draft(convId));
  } catch {
  }
}
async function getOutbox() {
  return readJSON(K.outbox, []);
}
var outboxChain = Promise.resolve();
function withOutboxLock(fn) {
  const run = outboxChain.then(fn, fn);
  outboxChain = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
async function enqueueOutbox(item) {
  return withOutboxLock(async () => {
    const cur = await getOutbox();
    cur.push(item);
    await writeJSON(K.outbox, cur);
  });
}
async function removeFromOutbox(tempId) {
  return withOutboxLock(async () => {
    const cur = await getOutbox();
    await writeJSON(K.outbox, cur.filter((i) => i.tempId !== tempId));
  });
}
async function updateOutboxItem(tempId, patch) {
  return withOutboxLock(async () => {
    const cur = await getOutbox();
    const next = cur.map((i) => i.tempId === tempId ? { ...i, ...patch } : i);
    await writeJSON(K.outbox, next);
  });
}
async function getActionQueue() {
  return readJSON(K.actions, []);
}
var actionChain = Promise.resolve();
function withActionLock(fn) {
  const run = actionChain.then(fn, fn);
  actionChain = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
async function enqueueAction(action) {
  return withActionLock(async () => {
    const cur = await getActionQueue();
    cur.push(action);
    await writeJSON(K.actions, cur);
  });
}
async function removeAction(id) {
  return withActionLock(async () => {
    const cur = await getActionQueue();
    await writeJSON(K.actions, cur.filter((a) => a.id !== id));
  });
}
async function updateAction(id, patch) {
  return withActionLock(async () => {
    const cur = await getActionQueue();
    await writeJSON(K.actions, cur.map((a) => a.id === id ? { ...a, ...patch } : a));
  });
}
async function pendingConversationEffects(addKinds, removeKinds) {
  const adds = /* @__PURE__ */ new Set();
  const removes = /* @__PURE__ */ new Set();
  try {
    const queue = await getActionQueue();
    for (const a of queue) {
      const cid = a?.payload?.conversationId;
      if (!cid) continue;
      if (addKinds.includes(a.kind)) {
        adds.add(cid);
        removes.delete(cid);
      } else if (removeKinds.includes(a.kind)) {
        removes.add(cid);
        adds.delete(cid);
      }
    }
  } catch {
  }
  return { adds, removes };
}
function mergeEffects(a, b) {
  const adds = new Set(a.adds);
  const removes = new Set(a.removes);
  b.adds.forEach((id) => {
    adds.add(id);
    removes.delete(id);
  });
  b.removes.forEach((id) => {
    removes.add(id);
    adds.delete(id);
  });
  return { adds, removes };
}
function reconcileIds(serverIds, eff) {
  const set = new Set(serverIds);
  eff.adds.forEach((id) => set.add(id));
  eff.removes.forEach((id) => set.delete(id));
  return set;
}
async function getPendingMessages(convId) {
  const box = await getOutbox();
  return box.filter((i) => i.conversationId === convId).map((i) => ({
    id: i.tempId,
    conversation_id: i.conversationId,
    sender_id: i.senderId,
    type: i.type,
    content: i.content,
    // Show the local file while it's still uploading (localUri), else the remote url.
    media_url: i.mediaUrl ?? i.localUri ?? null,
    reply_to: i.replyTo ?? null,
    is_deleted: false,
    created_at: i.createdAt,
    edited_at: null,
    pending: true,
    media_meta: i.mediaMeta ?? null
  }));
}

// ../../mobile/src/lib/sync.ts
var sync_exports = {};
__export(sync_exports, {
  flushActions: () => flushActions,
  flushOutbox: () => flushOutbox,
  isOnline: () => isOnline,
  onConnectivity: () => onConnectivity,
  onOutboxDeadLetter: () => onOutboxDeadLetter,
  onOutboxSent: () => onOutboxSent,
  queueAction: () => queueAction,
  startSync: () => startSync
});
var import_netinfo = __toESM(require("/Users/lakshmeshwarpandey/Lumixo/scripts/offline-test/mocks/netinfo.js"));
var import_supabase = require("/Users/lakshmeshwarpandey/Lumixo/scripts/offline-test/mocks/supabase.js");
var import_media = require("/Users/lakshmeshwarpandey/Lumixo/scripts/offline-test/mocks/media.js");
var import_mediaCache = require("/Users/lakshmeshwarpandey/Lumixo/scripts/offline-test/mocks/mediaCache.js");
var import_shared = require("/Users/lakshmeshwarpandey/Lumixo/scripts/offline-test/mocks/shared.js");
var online = true;
var flushing = false;
var outboxNeedsReflush = false;
var onlineListeners = /* @__PURE__ */ new Set();
var sentListeners = /* @__PURE__ */ new Set();
var deadLetterListeners = /* @__PURE__ */ new Set();
function isOnline() {
  return online;
}
function onConnectivity(fn) {
  onlineListeners.add(fn);
  fn(online);
  return () => onlineListeners.delete(fn);
}
function onOutboxSent(fn) {
  sentListeners.add(fn);
  return () => sentListeners.delete(fn);
}
function onOutboxDeadLetter(fn) {
  deadLetterListeners.add(fn);
  return () => deadLetterListeners.delete(fn);
}
var MAX_OUTBOX_ATTEMPTS = 30;
async function flushOutbox() {
  if (flushing) {
    outboxNeedsReflush = true;
    return;
  }
  flushing = true;
  outboxNeedsReflush = false;
  try {
    do {
      outboxNeedsReflush = false;
      const box = await getOutbox();
      for (const item of box) {
        if (!online) break;
        if ((item.attempts ?? 0) >= MAX_OUTBOX_ATTEMPTS) {
          try {
            const failedMsg = {
              id: item.tempId,
              conversation_id: item.conversationId,
              sender_id: item.senderId,
              type: item.type,
              content: item.content,
              media_url: item.mediaUrl ?? null,
              reply_to: item.replyTo ?? null,
              created_at: item.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
              updated_at: (/* @__PURE__ */ new Date()).toISOString(),
              is_deleted: false,
              edited_at: null,
              media_meta: item.mediaMeta ?? null,
              pending: false,
              failed: true
            };
            await upsertCachedMessage(item.conversationId, failedMsg);
          } catch {
          }
          await removeFromOutbox(item.tempId);
          deadLetterListeners.forEach((l) => {
            try {
              l(item, "max_attempts");
            } catch {
            }
          });
          continue;
        }
        try {
          let mediaUrl = item.mediaUrl;
          if (item.localUri && !mediaUrl) {
            const { url, error: upErr } = await (0, import_media.uploadMediaFromUri)(
              item.conversationId,
              item.localUri,
              item.fileName ?? `media_${item.tempId}`
            );
            if (upErr || !url) {
              await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
              continue;
            }
            mediaUrl = url;
            if (item.localUri) void (0, import_mediaCache.registerLocalMedia)(url, item.localUri);
            await updateOutboxItem(item.tempId, { mediaUrl: url, localUri: void 0 });
          }
          const { message, error } = await (0, import_shared.sendMessage)(
            import_supabase.supabase,
            item.conversationId,
            item.content,
            item.type,
            mediaUrl,
            item.replyTo,
            item.tempId,
            // reuse the optimistic id as the real row id
            item.mediaMeta
          );
          const dupe = !!error && (error.code === "23505" || /duplicate key|already exists/i.test(error.message ?? ""));
          if (message && !error || dupe) {
            if (message) await upsertCachedMessage(item.conversationId, message);
            await removeFromOutbox(item.tempId);
            sentListeners.forEach((l) => l(item, message?.id ?? item.tempId));
            (0, import_shared.recordStreakActivity)(import_supabase.supabase, item.conversationId).catch(() => {
            });
            try {
              const mid = message?.id ?? item.tempId;
              const preview = item.type === "text" ? (item.content || "Message").slice(0, 180) : item.type === "image" ? /\.gif(\?|#|$)/i.test(item.mediaUrl ?? item.localUri ?? "") ? "\u{1F39E}\uFE0F GIF" : "\u{1F4F7} Photo" : item.type === "video" ? "\u{1F3A5} Video" : item.type === "audio" ? "\u{1F3A4} Voice message" : item.type === "file" ? item.content?.trim() ? `\u{1F4C4} ${item.content}` : "\u{1F4C4} Document" : "New message";
              void (0, import_shared.sendPush)(import_supabase.supabase, {
                conversationId: item.conversationId,
                kind: "message",
                title: "",
                // empty → Edge uses sender display name (not "New message")
                body: preview,
                data: {
                  messageId: mid,
                  messageType: item.type,
                  type: "message",
                  senderId: item.senderId
                }
              });
            } catch {
            }
          } else {
            await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
          }
        } catch {
          await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
        }
      }
    } while (outboxNeedsReflush && online);
  } finally {
    flushing = false;
    if (outboxNeedsReflush && online) {
      outboxNeedsReflush = false;
      void flushOutbox();
    }
  }
}
function deepSet(root, path, value) {
  const base = root && typeof root === "object" ? { ...root } : {};
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  base[head] = rest.length === 0 ? value : deepSet(base[head], rest, value);
  return base;
}
async function mergeExtra(payload) {
  const prefs = await (0, import_shared.getPreferences)(import_supabase.supabase).catch(() => null);
  if (!prefs) return { error: new Error("could not read preferences") };
  const extra = prefs.extra && typeof prefs.extra === "object" ? prefs.extra : {};
  const nextExtra = deepSet(extra, payload.path, payload.value);
  return (0, import_shared.updatePreferences)(import_supabase.supabase, { extra: nextExtra });
}
var actionHandlers = {
  pin: (p) => (0, import_shared.pinConversation)(import_supabase.supabase, p.conversationId),
  unpin: (p) => (0, import_shared.unpinConversation)(import_supabase.supabase, p.conversationId),
  favorite: (p) => (0, import_shared.favoriteConversation)(import_supabase.supabase, p.conversationId),
  unfavorite: (p) => (0, import_shared.unfavoriteConversation)(import_supabase.supabase, p.conversationId),
  mute: (p) => (0, import_shared.muteConversation)(import_supabase.supabase, p.conversationId),
  unmute: (p) => (0, import_shared.unmuteConversation)(import_supabase.supabase, p.conversationId),
  archive: (p) => (0, import_shared.archiveConversation)(import_supabase.supabase, p.conversationId),
  unarchive: (p) => (0, import_shared.unarchiveConversation)(import_supabase.supabase, p.conversationId),
  // Chat Lock (0027): device-secured per-chat lock. Only the user's CHOICE to
  // lock syncs here — never a PIN/biometric (those stay on-device).
  lockChat: (p) => (0, import_shared.lockConversation)(import_supabase.supabase, p.conversationId),
  unlockChat: (p) => (0, import_shared.unlockConversation)(import_supabase.supabase, p.conversationId),
  markRead: (p) => (0, import_shared.markConversationRead)(import_supabase.supabase, p.conversationId),
  block: (p) => (0, import_shared.blockUser)(import_supabase.supabase, p.userId),
  unblock: (p) => (0, import_shared.unblockUser)(import_supabase.supabase, p.userId),
  star: (p) => (0, import_shared.starMessage)(import_supabase.supabase, p.messageId),
  unstar: (p) => (0, import_shared.unstarMessage)(import_supabase.supabase, p.messageId),
  hideMessage: (p) => (0, import_shared.hideMessageForMe)(import_supabase.supabase, p.messageId),
  deleteForMe: (p) => (0, import_shared.deleteConversationForMe)(import_supabase.supabase, p.conversationId),
  deleteForEveryone: (p) => (0, import_shared.deleteConversationForEveryone)(import_supabase.supabase, p.conversationId),
  updateProfile: (p) => (0, import_shared.updateMyProfile)(import_supabase.supabase, p.updates),
  updatePreferences: (p) => (0, import_shared.updatePreferences)(import_supabase.supabase, p.updates),
  // Remove one person from the New Chat "recent contacts" history. Removal-only:
  // does not delete messages/conversation, block, or touch the other account.
  removeRecentContact: (p) => (0, import_shared.removeRecentContact)(import_supabase.supabase, p.contactId),
  updateChatSettings: (p) => (0, import_shared.setChatSettings)(import_supabase.supabase, p.patch),
  updatePrivacy: (p) => (0, import_shared.setPrivacy)(import_supabase.supabase, p.patch),
  // Conflict-safe partial write into user_preferences.extra (notifications,
  // storage, and any future extra.<section>). See mergeExtra() above.
  mergeExtra: (p) => mergeExtra(p)
};
var MAX_ACTION_ATTEMPTS = 25;
var flushingActions = false;
var actionsNeedReflush = false;
async function flushActions() {
  if (flushingActions) {
    actionsNeedReflush = true;
    return;
  }
  flushingActions = true;
  actionsNeedReflush = false;
  try {
    do {
      actionsNeedReflush = false;
      const queue = await getActionQueue();
      for (const action of queue) {
        if (!online) break;
        const handler = actionHandlers[action.kind];
        if (!handler) {
          await removeAction(action.id);
          continue;
        }
        try {
          const res = await handler(action.payload);
          const err = res && typeof res === "object" ? res.error : null;
          if (err) {
            const attempts = (action.attempts ?? 0) + 1;
            if (attempts >= MAX_ACTION_ATTEMPTS) await removeAction(action.id);
            else await updateAction(action.id, { attempts });
          } else {
            await removeAction(action.id);
          }
        } catch {
          const attempts = (action.attempts ?? 0) + 1;
          if (attempts >= MAX_ACTION_ATTEMPTS) await removeAction(action.id);
          else await updateAction(action.id, { attempts });
        }
      }
    } while (actionsNeedReflush && online);
  } finally {
    flushingActions = false;
    if (actionsNeedReflush && online) {
      actionsNeedReflush = false;
      void flushActions();
    }
  }
}
async function queueAction(kind, payload) {
  await enqueueAction({ id: uuidv4(), kind, payload, createdAt: (/* @__PURE__ */ new Date()).toISOString(), attempts: 0 });
  if (online) flushActions().catch(() => {
  });
}
var started = false;
function startSync() {
  if (started) return () => {
  };
  started = true;
  const unsub = import_netinfo.default.addEventListener((state) => {
    const nowOnline = !!state.isConnected && state.isInternetReachable !== false;
    const cameOnline = nowOnline && !online;
    online = nowOnline;
    onlineListeners.forEach((l) => l(online));
    if (cameOnline) {
      flushOutbox();
      flushActions();
    }
  });
  flushOutbox();
  flushActions();
  return () => {
    unsub();
    started = false;
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  localCache,
  sync
});
