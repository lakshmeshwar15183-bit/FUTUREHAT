// No-op media upload for offline/outbox tests.
module.exports = {
  uploadMediaFromUri: async () => ({ url: null, error: new Error('offline mock') }),
  guessMime: () => 'application/octet-stream',
};
