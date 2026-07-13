// No-op media cache for offline tests.
module.exports = {
  registerLocalMedia: async () => {},
  ensureMediaCached: async () => null,
  peekCachedMediaUri: () => null,
  prefetchMedia: async () => {},
};
