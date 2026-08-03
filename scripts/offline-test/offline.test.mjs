// Runtime verification of the REAL localCache.ts + sync.ts (bundled to bundle.cjs).
// Each test prints EVIDENCE: storage keys touched, cache hit/miss, execution order,
// and network (sendMessage) calls or their absence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const bundle = require('./bundle.cjs');
const { localCache: LC, sync: SYNC } = bundle;
const AS = require('./mocks/async-storage.js');
const NET = require('./mocks/netinfo.js');
const SHARED = require('./mocks/shared.js');

const reset = () => { AS.__reset(); SHARED.sendMessage.__reset(); };
const keysTouched = () => AS.__log.map(([op, k]) => `${op} ${k}`);
const UID = 'user-123';
const CONV = 'conv-abc';

test('#1 conversations: cache read hits AsyncStorage with exact key, no network', async () => {
  reset();
  const list = [{ conversation: { id: CONV, type: 'direct' }, participants: [{ id: 'p1' }], lastMessage: null, unreadCount: 0, title: 'x', avatarUrl: null }];
  await LC.cacheConversations(UID, list);
  AS.__log.length = 0; // isolate the READ
  const got = await LC.getCachedConversations(UID);
  console.log('  key read:', keysTouched()[0]);
  console.log('  cache hit:', got.length === 1, '| network calls:', SHARED.sendMessage.__calls.length);
  assert.equal(keysTouched()[0], `getItem fh:cache:convs:${UID}`);
  assert.equal(got.length, 1);
  assert.equal(SHARED.sendMessage.__calls.length, 0, 'no network during a cache read');
});

test('#1b cacheConversations also persists participant profiles offline', async () => {
  reset();
  const list = [{ conversation: { id: CONV, type: 'direct' }, participants: [{ id: 'p1', display_name: 'Ana' }, { id: 'p2', display_name: 'Bo' }], lastMessage: null, unreadCount: 0, title: 'x', avatarUrl: null }];
  await LC.cacheConversations(UID, list);
  const p1 = await LC.getCachedProfile('p1');
  console.log('  profile keys in store:', [...AS.__store.keys()].filter((k) => k.includes('profile')));
  assert.equal(p1.display_name, 'Ana'); // #4 profile cached locally
});

test('#2 messages: cached thread returned oldest→newest, exact key, no network', async () => {
  reset();
  const msgs = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, conversation_id: CONV, sender_id: 's', type: 'text', content: `msg ${i}`, media_url: null, reply_to: null, is_deleted: false, created_at: `2026-01-0${i + 1}`, edited_at: null }));
  await LC.cacheMessages(CONV, msgs);
  AS.__log.length = 0;
  const got = await LC.getCachedMessages(CONV);
  console.log('  key read:', keysTouched()[0], '| count:', got.length, '| order ok:', got[0].id === 'm0' && got[2].id === 'm2');
  assert.equal(keysTouched()[0], `getItem fh:cache:msgs:${CONV}`);
  assert.deepEqual(got.map((m) => m.id), ['m0', 'm1', 'm2']);
  assert.equal(SHARED.sendMessage.__calls.length, 0);
});

test('#2b message cache is bounded to MSG_CACHE_LIMIT', async () => {
  reset();
  const limit = LC.MSG_CACHE_LIMIT ?? 800;
  const total = limit + 50;
  const many = Array.from({ length: total }, (_, i) => ({ id: `m${i}`, conversation_id: CONV, sender_id: 's', type: 'text', content: '', media_url: null, reply_to: null, is_deleted: false, created_at: '', edited_at: null }));
  await LC.cacheMessages(CONV, many);
  const got = await LC.getCachedMessages(CONV);
  console.log('  retained:', got.length, '| first kept:', got[0].id, `(most-recent ${limit})`);
  assert.equal(got.length, limit);
  // Oldest `total - limit` trimmed; first kept is m{total-limit}.
  assert.equal(got[0].id, `m${total - limit}`);
});

test('#5 drafts survive "restart" (persist to disk key, re-read from fresh store view)', async () => {
  reset();
  await LC.setDraft(CONV, 'unsent hello');
  console.log('  draft key:', [...AS.__store.keys()].find((k) => k.startsWith('fh:draft')));
  // simulate restart: store persists (same Map == disk); a fresh read must return it
  const d = await LC.getDraft(CONV);
  console.log('  recovered draft:', JSON.stringify(d));
  assert.equal(d, 'unsent hello');
  // empty clears it
  await LC.setDraft(CONV, '');
  assert.equal(await LC.getDraft(CONV), '');
});

test('#6b outbox lock: concurrent enqueue does not drop items', async () => {
  reset();
  await Promise.all([
    LC.enqueueOutbox({ tempId: 'a', conversationId: CONV, senderId: UID, content: '1', type: 'text', createdAt: 't', attempts: 0 }),
    LC.enqueueOutbox({ tempId: 'b', conversationId: CONV, senderId: UID, content: '2', type: 'text', createdAt: 't', attempts: 0 }),
    LC.enqueueOutbox({ tempId: 'c', conversationId: CONV, senderId: UID, content: '3', type: 'text', createdAt: 't', attempts: 0 }),
  ]);
  const box = await LC.getOutbox();
  console.log('  concurrent enqueued:', box.length, box.map((i) => i.tempId).join(','));
  assert.equal(box.length, 3);
  assert.deepEqual(box.map((i) => i.tempId).sort(), ['a', 'b', 'c']);
});

test('#6 outbox: enqueue persists to fh:outbox:v1 and surfaces as pending message', async () => {
  reset();
  await LC.enqueueOutbox({ tempId: 't1', conversationId: CONV, senderId: UID, content: 'queued', type: 'text', createdAt: '2026-01-01', attempts: 0 });
  const raw = AS.__store.get('fh:outbox:v1');
  console.log('  outbox key present:', !!raw, '| items:', JSON.parse(raw).length);
  const pending = await LC.getPendingMessages(CONV);
  console.log('  pending msg:', pending[0].content, '| pending flag:', pending[0].pending, '| id===tempId:', pending[0].id === 't1');
  assert.equal(pending[0].pending, true);
  assert.equal(pending[0].id, 't1');
});

test('#7 auto-send on reconnect: offline enqueue → NetInfo online → flush sends once & dequeues', async () => {
  reset();
  // queue two messages while "offline"
  await LC.enqueueOutbox({ tempId: 'a', conversationId: CONV, senderId: UID, content: 'first', type: 'text', createdAt: '1', attempts: 0 });
  await LC.enqueueOutbox({ tempId: 'b', conversationId: CONV, senderId: UID, content: 'second', type: 'text', createdAt: '2', attempts: 0 });

  const stop = SYNC.startSync();
  console.log('  NetInfo listener registered:', NET.__hasListener());
  // Go OFFLINE first — a flush here must send NOTHING.
  NET.__emit({ isConnected: false, isInternetReachable: false });
  await new Promise((r) => setTimeout(r, 20));
  console.log('  sends while offline:', SHARED.sendMessage.__calls.length, '| isOnline:', SYNC.isOnline());
  assert.equal(SHARED.sendMessage.__calls.length, 0, 'MUST NOT send while offline');

  // Now come ONLINE — startSync flushes automatically.
  NET.__emit({ isConnected: true, isInternetReachable: true });
  await new Promise((r) => setTimeout(r, 50));
  const sent = SHARED.sendMessage.__calls;
  const box = await LC.getOutbox();
  console.log('  sends after reconnect:', sent.length, '| order:', sent.map((c) => c.content).join(','), '| tempId reused as row id:', sent.map((c) => c.id).join(','));
  console.log('  outbox remaining after flush:', box.length);
  assert.equal(sent.length, 2, 'both queued messages sent on reconnect');
  assert.deepEqual(sent.map((c) => c.content), ['first', 'second'], 'sent oldest-first');
  assert.deepEqual(sent.map((c) => c.id), ['a', 'b'], 'reuses tempId as server row id (dedupe)');
  assert.equal(box.length, 0, 'outbox drained after successful send');
  stop();
});

test('#7b duplicate-key (23505) is treated as already-sent and dequeued', async () => {
  reset();
  await LC.enqueueOutbox({ tempId: 'dup', conversationId: CONV, senderId: UID, content: 'x', type: 'text', createdAt: '1', attempts: 0 });
  SHARED.sendMessage.__setNextResult({ message: null, error: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) });
  await SYNC.flushOutbox();
  const box = await LC.getOutbox();
  console.log('  outbox after dupe-error flush:', box.length, '(dequeued, no infinite retry)');
  assert.equal(box.length, 0);
});

test('#7c a real send failure keeps the item queued and increments attempts', async () => {
  reset();
  await LC.enqueueOutbox({ tempId: 'fail', conversationId: CONV, senderId: UID, content: 'x', type: 'text', createdAt: '1', attempts: 0 });
  SHARED.sendMessage.__setNextResult({ message: null, error: new Error('network down') });
  await SYNC.flushOutbox();
  const box = await LC.getOutbox();
  console.log('  still queued:', box.length === 1, '| attempts:', box[0].attempts);
  assert.equal(box.length, 1);
  assert.equal(box[0].attempts, 1);
});

test('#8 cache survives "restart": data written persists across a fresh module read', async () => {
  reset();
  await LC.cacheMessages(CONV, [{ id: 'm1', conversation_id: CONV, sender_id: 's', type: 'text', content: 'persisted', media_url: null, reply_to: null, is_deleted: false, created_at: '1', edited_at: null }]);
  // The mock Map IS the disk. A brand-new getCachedMessages call (as a fresh app
  // launch would do) reads the same persisted bytes.
  const afterRestart = await LC.getCachedMessages(CONV);
  console.log('  survived restart:', afterRestart[0]?.content);
  assert.equal(afterRestart[0].content, 'persisted');
});

test('#9 corrupt cache entry degrades to empty (no crash), still no network', async () => {
  reset();
  AS.__store.set(`fh:cache:msgs:${CONV}`, '{ this is : not json');
  const got = await LC.getCachedMessages(CONV);
  console.log('  corrupt read returned:', JSON.stringify(got), '(safe fallback)');
  assert.deepEqual(got, []);
  assert.equal(SHARED.sendMessage.__calls.length, 0);
});

// ── Recent contacts (New Chat persistent "previously chatted users") ────────────

test('#10 recent contacts: cached list renders after "restart" with exact key, no network', async () => {
  reset();
  const list = [
    { contact: { id: 'b', display_name: 'User B', username: 'userb' }, first_interaction_at: '1', last_interaction_at: '2' },
  ];
  await LC.cacheRecentContacts(UID, list);
  AS.__log.length = 0; // isolate the READ (as a fresh New Chat open / app restart would do)
  const got = await LC.getCachedRecentContacts(UID);
  console.log('  key read:', keysTouched()[0], '| contacts:', got.length, '| network:', SHARED.sendMessage.__calls.length);
  assert.equal(keysTouched()[0], `getItem fh:cache:recent:${UID}`);
  assert.equal(got[0].contact.id, 'b');
  assert.equal(SHARED.sendMessage.__calls.length, 0, 'no network to render cached recent contacts');
});

test('#11 remove recent contact: queued offline, syncs exactly once on reconnect, dequeues, and never deletes messages/conversation', async () => {
  reset();
  SHARED.removeRecentContact.__reset();

  const stop = SYNC.startSync();
  NET.__emit({ isConnected: false, isInternetReachable: false }); // go offline
  await new Promise((r) => setTimeout(r, 10));

  // The New Chat screen removes from UI+cache immediately, then queues the sync.
  await LC.cacheRecentContacts(UID, []); // optimistic local removal already applied by the screen
  await SYNC.queueAction('removeRecentContact', { contactId: 'b' });

  console.log('  removeRecentContact calls while offline:', SHARED.removeRecentContact.__calls.length);
  assert.equal(SHARED.removeRecentContact.__calls.length, 0, 'no sync while offline');
  assert.equal((await LC.getActionQueue()).length, 1, 'removal persisted in durable queue');

  NET.__emit({ isConnected: true, isInternetReachable: true }); // reconnect → auto-flush
  await new Promise((r) => setTimeout(r, 30));

  console.log('  removeRecentContact calls after reconnect:', SHARED.removeRecentContact.__calls.length,
    '| contactId:', SHARED.removeRecentContact.__calls[0]?.contactId,
    '| sendMessage calls:', SHARED.sendMessage.__calls.length);
  assert.equal(SHARED.removeRecentContact.__calls.length, 1, 'removal synced exactly once');
  assert.equal(SHARED.removeRecentContact.__calls[0].contactId, 'b');
  assert.equal((await LC.getActionQueue()).length, 0, 'dequeued after success');
  // Removal-only: it must NOT go anywhere near message/conversation deletion.
  assert.equal(SHARED.sendMessage.__calls.length, 0, 'removing a recent contact sends/deletes no messages');
  stop();
});
