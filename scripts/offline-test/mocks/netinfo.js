// NetInfo mock: capture the listener startSync() registers, and let the test
// drive connectivity transitions (offline -> online) to prove auto-flush.
let handler = null;
const NetInfo = {
  addEventListener(fn) { handler = fn; return () => { handler = null; }; },
};
NetInfo.__emit = (state) => { if (handler) handler(state); };
NetInfo.__hasListener = () => !!handler;
module.exports = NetInfo;
module.exports.default = NetInfo;
