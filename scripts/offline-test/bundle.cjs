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
var import_async_storage = __toESM(require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/offline-test/mocks/async-storage.js"));
var K = {
  convs: (uid) => `fh:cache:convs:${uid}`,
  msgs: (convId) => `fh:cache:msgs:${convId}`,
  profile: (id) => `fh:cache:profile:${id}`,
  recent: (uid) => `fh:cache:recent:${uid}`,
  draft: (convId) => `fh:draft:${convId}`,
  outbox: "fh:outbox:v1",
  actions: "fh:actions:v1"
};
var MSG_CACHE_LIMIT = 200;
function uuidv4() {
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
async function cacheMessages(convId, messages) {
  const trimmed = messages.slice(-MSG_CACHE_LIMIT);
  await writeJSON(K.msgs(convId), trimmed);
}
async function upsertCachedMessage(convId, message) {
  const cur = await getCachedMessages(convId);
  const idx = cur.findIndex((m) => m.id === message.id);
  if (idx >= 0) cur[idx] = message;
  else cur.push(message);
  await cacheMessages(convId, cur);
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
async function enqueueOutbox(item) {
  const cur = await getOutbox();
  cur.push(item);
  await writeJSON(K.outbox, cur);
}
async function removeFromOutbox(tempId) {
  const cur = await getOutbox();
  await writeJSON(K.outbox, cur.filter((i) => i.tempId !== tempId));
}
async function updateOutboxItem(tempId, patch) {
  const cur = await getOutbox();
  const next = cur.map((i) => i.tempId === tempId ? { ...i, ...patch } : i);
  await writeJSON(K.outbox, next);
}
async function getActionQueue() {
  return readJSON(K.actions, []);
}
async function enqueueAction(action) {
  const cur = await getActionQueue();
  cur.push(action);
  await writeJSON(K.actions, cur);
}
async function removeAction(id) {
  const cur = await getActionQueue();
  await writeJSON(K.actions, cur.filter((a) => a.id !== id));
}
async function updateAction(id, patch) {
  const cur = await getActionQueue();
  await writeJSON(K.actions, cur.map((a) => a.id === id ? { ...a, ...patch } : a));
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
    media_url: i.mediaUrl ?? null,
    reply_to: i.replyTo ?? null,
    is_deleted: false,
    created_at: i.createdAt,
    edited_at: null,
    pending: true
  }));
}

// ../../mobile/src/lib/sync.ts
var sync_exports = {};
__export(sync_exports, {
  flushActions: () => flushActions,
  flushOutbox: () => flushOutbox,
  isOnline: () => isOnline,
  onConnectivity: () => onConnectivity,
  onOutboxSent: () => onOutboxSent,
  queueAction: () => queueAction,
  startSync: () => startSync
});
var import_netinfo = __toESM(require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/offline-test/mocks/netinfo.js"));
var import_supabase = require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/offline-test/mocks/supabase.js");
var import_shared = require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/offline-test/mocks/shared.js");
var online = true;
var flushing = false;
var onlineListeners = /* @__PURE__ */ new Set();
var sentListeners = /* @__PURE__ */ new Set();
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
async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    const box = await getOutbox();
    for (const item of box) {
      if (!online) break;
      try {
        const { message, error } = await (0, import_shared.sendMessage)(
          import_supabase.supabase,
          item.conversationId,
          item.content,
          item.type,
          item.mediaUrl,
          item.replyTo,
          item.tempId
          // reuse the optimistic id as the real row id
        );
        const dupe = !!error && (error.code === "23505" || /duplicate key|already exists/i.test(error.message ?? ""));
        if (message && !error || dupe) {
          if (message) await upsertCachedMessage(item.conversationId, message);
          await removeFromOutbox(item.tempId);
          sentListeners.forEach((l) => l(item, message?.id ?? item.tempId));
        } else {
          await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
        }
      } catch {
        await updateOutboxItem(item.tempId, { attempts: (item.attempts ?? 0) + 1 });
      }
    }
  } finally {
    flushing = false;
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
async function flushActions() {
  if (flushingActions) return;
  flushingActions = true;
  try {
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
  } finally {
    flushingActions = false;
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
