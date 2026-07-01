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

test('#2b message cache is bounded to 200 (MSG_CACHE_LIMIT)', async () => {
  reset();
  const many = Array.from({ length: 250 }, (_, i) => ({ id: `m${i}`, conversation_id: CONV, sender_id: 's', type: 'text', content: '', media_url: null, reply_to: null, is_deleted: false, created_at: '', edited_at: null }));
  await LC.cacheMessages(CONV, many);
  const got = await LC.getCachedMessages(CONV);
  console.log('  retained:', got.length, '| first kept:', got[0].id, '(most-recent 200)');
  assert.equal(got.length, 200);
  assert.equal(got[0].id, 'm50'); // oldest 50 trimmed
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
