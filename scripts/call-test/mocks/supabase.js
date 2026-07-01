// Sentinel — CallSession only passes `supabase` through to createSignalingChannel,
// which we also mock, so it just needs to be a distinct object.
const supabase = { __isMockSupabase: true };
module.exports = { supabase };
