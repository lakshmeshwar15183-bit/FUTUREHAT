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
module.exports = { sendMessage };
