// Mock InCallManager — records audio-routing calls so tests can assert speaker/
// earpiece/ringtone behavior at the API level (real routing needs a device).
const log = [];
const InCallManager = {
  start(o) { log.push(['start', o?.media]); },
  stop() { log.push(['stop']); },
  setForceSpeakerphoneOn(on) { log.push(['speaker', on]); },
  startRingtone(x) { log.push(['ringtone', x]); },
  stopRingtone() { log.push(['stopRingtone']); },
};
InCallManager.__log = log;
InCallManager.__reset = () => { log.length = 0; };
module.exports = InCallManager;
module.exports.default = InCallManager;
