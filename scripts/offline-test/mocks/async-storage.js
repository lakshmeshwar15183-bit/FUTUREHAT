// In-memory AsyncStorage mock that records every call, so tests can assert
// exact storage keys, hit/miss, and read/write ordering against the REAL code.
const store = new Map();
const log = [];
const AsyncStorage = {
  async getItem(k) { log.push(['getItem', k]); return store.has(k) ? store.get(k) : null; },
  async setItem(k, v) { log.push(['setItem', k]); store.set(k, v); },
  async removeItem(k) { log.push(['removeItem', k]); store.delete(k); },
  async clear() { store.clear(); },
};
AsyncStorage.__store = store;
AsyncStorage.__log = log;
AsyncStorage.__reset = () => { store.clear(); log.length = 0; };
module.exports = AsyncStorage;
module.exports.default = AsyncStorage;
