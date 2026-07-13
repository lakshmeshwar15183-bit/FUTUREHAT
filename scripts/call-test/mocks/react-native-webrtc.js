// Mock of react-native-webrtc that models the SDP/ICE state machine faithfully
// enough to drive the REAL CallSession, plus test triggers to fire connection
// states. Every created peer connection is registered so a test can grab it.
const peers = [];

function makeTrack(kind) {
  return {
    kind,
    enabled: true,
    id: `${kind}-${Math.random().toString(36).slice(2, 9)}`,
    stop() {
      this.__stopped = true;
    },
    _switchCamera() {
      this.__switched = (this.__switched || 0) + 1;
    },
  };
}

class MediaStreamMock {
  constructor(tracks) {
    this._tracks = tracks ? [...tracks] : [];
  }
  getTracks() {
    return this._tracks;
  }
  getAudioTracks() {
    return this._tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this._tracks.filter((t) => t.kind === 'video');
  }
  addTrack(track) {
    if (!this._tracks.some((t) => t.id === track.id)) this._tracks.push(track);
  }
  removeTrack(track) {
    this._tracks = this._tracks.filter((t) => t !== track && t.id !== track?.id);
  }
  toURL() {
    return 'stream://mock';
  }
}

class RTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.iceGatheringState = 'new';
    this.signalingState = 'stable';
    this.localDescription = null;
    this.remoteDescription = null;
    this.tracks = [];
    this.addedCandidates = [];
    this._senders = [];
    this.ontrack = null;
    this.onicecandidate = null;
    this.onicegatheringstatechange = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    peers.push(this);
  }
  addTrack(track, stream) {
    this.tracks.push({ track, stream });
    const sender = {
      track,
      replaceTrack: async (next) => {
        sender.track = next;
        sender.__replaced = (sender.__replaced || 0) + 1;
        return undefined;
      },
    };
    this._senders.push(sender);
    return sender;
  }
  getSenders() {
    return this._senders;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'FAKE_SDP_OFFER' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'FAKE_SDP_ANSWER' };
  }
  async setLocalDescription(desc) {
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
    // Simulate ICE gathering: emit one host candidate, then "complete".
    queueMicrotask(() => {
      this.onicecandidate?.({
        candidate: {
          candidate: 'candidate:1 1 udp 2130706431 10.0.0.1 54321 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      });
      this.iceGatheringState = 'complete';
      this.onicegatheringstatechange?.();
      this.onicecandidate?.({ candidate: null }); // gathering complete sentinel
    });
  }
  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate(c) {
    this.addedCandidates.push(c);
  }
  close() {
    this.__closed = true;
  }
  // ── test triggers ──
  __fireIce(state) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
  __fireConn(state) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  __fireRemoteTrack(kind = 'audio') {
    this.ontrack?.({
      track: { kind },
      streams: [new MediaStreamMock([makeTrack(kind)])],
    });
  }
}

class RTCIceCandidate {
  constructor(x) {
    Object.assign(this, x);
  }
}
class RTCSessionDescription {
  constructor(x) {
    Object.assign(this, x);
  }
}

const mediaDevices = {
  async getUserMedia(constraints) {
    const tracks = [];
    // Match production: audio-only gUM for camera flip uses audio:false + video
    if (constraints?.audio) tracks.push(makeTrack('audio'));
    if (constraints?.video) tracks.push(makeTrack('video'));
    // Initial call path always requests audio (and maybe video)
    if (!constraints?.audio && !constraints?.video) {
      tracks.push(makeTrack('audio'));
    }
    return new MediaStreamMock(tracks);
  },
};

module.exports = {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream: MediaStreamMock,
  mediaDevices,
  __peers: peers,
  __resetPeers: () => {
    peers.length = 0;
  },
};
