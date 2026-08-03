// Lumixo mobile — live chat header fields without re-running navigation.setOptions.
// Typing / online / title / streak update via this store; only the header
// subtree re-renders (useSyncExternalStore). Critical for 60fps while chatting.

export type ChatHeaderLive = {
  conversationId: string | null;
  title: string;
  /** Presence / members line (not typing). */
  baseSubtitle: string;
  /** When set, subtitle becomes typing copy. */
  typingName: string | null;
  avatarUri: string | null;
  avatarName: string;
  peerUserId: string | null;
  isGroup: boolean;
  streakScore: number;
  streakEmoji: string;
  disappearSecs: number;
  ghost: boolean;
};

const EMPTY: ChatHeaderLive = {
  conversationId: null,
  title: '',
  baseSubtitle: '',
  typingName: null,
  avatarUri: null,
  avatarName: '',
  peerUserId: null,
  isGroup: false,
  streakScore: 0,
  streakEmoji: '',
  disappearSecs: 0,
  ghost: false,
};

let state: ChatHeaderLive = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* never break header */
    }
  });
}

/** Bind header store to an open chat (clears typing). */
export function bindChatHeaderLive(conversationId: string, seed?: Partial<ChatHeaderLive>): void {
  state = {
    ...EMPTY,
    ...seed,
    conversationId,
    typingName: null,
  };
  emit();
}

export function patchChatHeaderLive(
  conversationId: string,
  patch: Partial<Omit<ChatHeaderLive, 'conversationId'>>,
): void {
  if (state.conversationId !== conversationId) return;
  let changed = false;
  const next = { ...state };
  (Object.keys(patch) as (keyof typeof patch)[]).forEach((k) => {
    const v = patch[k];
    if (v !== undefined && (next as any)[k] !== v) {
      (next as any)[k] = v;
      changed = true;
    }
  });
  if (!changed) return;
  state = next;
  emit();
}

export function setChatHeaderTyping(conversationId: string, name: string | null): void {
  patchChatHeaderLive(conversationId, { typingName: name });
}

export function clearChatHeaderLive(conversationId?: string): void {
  if (conversationId && state.conversationId !== conversationId) return;
  state = EMPTY;
  emit();
}

export function getChatHeaderLive(): ChatHeaderLive {
  return state;
}

export function subscribeChatHeaderLive(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** Resolved subtitle for display. */
export function resolveHeaderSubtitle(live: ChatHeaderLive): string {
  if (live.typingName) {
    return live.isGroup ? `${live.typingName} is typing…` : 'typing…';
  }
  return live.baseSubtitle;
}
