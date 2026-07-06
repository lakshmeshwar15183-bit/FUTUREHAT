// Stub for ./shared — represents the NETWORK boundary. Every sendMessage call is
// the only "network request" sync.ts can make; we record them so a test can prove
// "no network while offline" and "exactly one send on reconnect".
const calls = [];
let nextResult = null; // { message, error } the fake server returns

function sendMessage(client, conversationId, content, type, mediaUrl, replyTo, id) {
  calls.push({ conversationId, content, type, mediaUrl, replyTo, id, at: calls.length });
  // default: succeed, echoing the row with its id
  const res = nextResult ?? {
    message: { id: id ?? 'server-id', conversation_id: conversationId, sender_id: 's', type,
      content, media_url: mediaUrl ?? null, reply_to: replyTo ?? null, is_deleted: false,
      created_at: new Date().toISOString(), edited_at: null },
    error: null,
  };
  return Promise.resolve(res);
}
sendMessage.__calls = calls;
sendMessage.__setNextResult = (r) => { nextResult = r; };
sendMessage.__reset = () => { calls.length = 0; nextResult = null; };

// Recent-contacts removal boundary. The action-queue handler in sync.ts calls
// this shared fn; we record calls so a test can prove "remove syncs exactly once
// on reconnect" and — crucially — that it never routes through a message/
// conversation deletion path (those spies stay at zero).
const removeRecentCalls = [];
let removeRecentResult = { error: null };
function removeRecentContact(client, contactId) {
  removeRecentCalls.push({ contactId, at: removeRecentCalls.length });
  return Promise.resolve(removeRecentResult);
}
removeRecentContact.__calls = removeRecentCalls;
removeRecentContact.__setNextResult = (r) => { removeRecentResult = r; };
removeRecentContact.__reset = () => { removeRecentCalls.length = 0; removeRecentResult = { error: null }; };

module.exports = { sendMessage, removeRecentContact };
