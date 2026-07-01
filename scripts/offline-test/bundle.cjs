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
  enqueueOutbox: () => enqueueOutbox,
  getCachedConversations: () => getCachedConversations,
  getCachedMessages: () => getCachedMessages,
  getCachedProfile: () => getCachedProfile,
  getDraft: () => getDraft,
  getOutbox: () => getOutbox,
  getPendingMessages: () => getPendingMessages,
  removeFromOutbox: () => removeFromOutbox,
  setDraft: () => setDraft,
  updateOutboxItem: () => updateOutboxItem,
  upsertCachedMessage: () => upsertCachedMessage,
  uuidv4: () => uuidv4
});
var import_async_storage = __toESM(require("/Users/lakshmeshwarpandey/FUTUREHAT/scripts/offline-test/mocks/async-storage.js"));
var K = {
  convs: (uid) => `fh:cache:convs:${uid}`,
  msgs: (convId) => `fh:cache:msgs:${convId}`,
  profile: (id) => `fh:cache:profile:${id}`,
  draft: (convId) => `fh:draft:${convId}`,
  outbox: "fh:outbox:v1"
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
  flushOutbox: () => flushOutbox,
  isOnline: () => isOnline,
  onConnectivity: () => onConnectivity,
  onOutboxSent: () => onOutboxSent,
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
    if (cameOnline) flushOutbox();
  });
  flushOutbox();
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
