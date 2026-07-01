// Stub for ./supabase — sync.ts only passes this object through to sendMessage,
// which we also stub, so it just needs to be a distinct sentinel.
const supabase = { __isMockSupabaseClient: true };
module.exports = { supabase };
