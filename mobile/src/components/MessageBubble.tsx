// Lumixo mobile — a single chat bubble. Handles text/image/video/audio/file,
// reply preview, reaction chips, edited marker, and delivery ticks.
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Message, MessageReaction } from '../lib/shared';
import { isVideoMessage } from '../lib/shared';
import { formatTime } from '../lib/time';
import { useColors, radius, font, type Palette } from '../theme';
import AudioMessage from './AudioMessage';
import SignedImage from './SignedImage';

export type TickStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

// Long-press is handled ONCE, natively, by the SwipeToReply wrapper's RNGH
// Gesture.LongPress covering the whole bubble subtree — so no child here needs
// its own onLongPress/delayLongPress. Taps (open image, jump to reply, toggle
// select) stay on these Pressables; the native long-press arbiter sits above.

// Legacy videos may still be type 'file'; detect by extension. New sends use type='video'.
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i;
export const isVideoUrl = (url?: string | null) => !!url && VIDEO_RE.test(url);

// One-line, type-aware summary of a quoted message (matches the composer preview).
export function replySummary(m: { type: string; content: string | null; media_url: string | null }): string {
  if (m.content && m.content.trim()) return m.content;
  if (m.type === 'image') return /\.gif(\?|#|$)/i.test(m.media_url ?? '') ? '🎞️ GIF' : '📷 Photo';
  if (m.type === 'audio') return '🎤 Voice message';
  if (m.type === 'video') return '🎬 Video';
  if (m.type === 'file') return isVideoUrl(m.media_url) ? '🎬 Video' : '📄 Document';
  return 'Attachment';
}

interface Props {
  message: Message;
  mine: boolean;
  /** Current user id — used to highlight reactions I made. */
  myId?: string | null;
  senderName?: string | null;
  replyTo?: Message | null;
  /** Tapping the reply preview jumps to the original message. */
  onReplyPress?: () => void;
  reactions?: MessageReaction[];
  tick?: TickStatus;
  onPress?: () => void;
  selected?: boolean;
  /** Continuation of a run from the same sender — hides the tail + sender name. */
  grouped?: boolean;
  onOpenImage?: (url: string) => void;
  /** Open a document attachment (download + share / OS open). */
  onOpenDocument?: (message: Message) => void;
  /** Tapping an existing reaction pill toggles the current user's reaction for
   *  that emoji (WhatsApp/web parity). */
  onReactionPress?: (emoji: string) => void;
  /** Lowercased search term to highlight inside text bodies. */
  highlight?: string;
  /** This bubble is the active search match (gets a ring). */
  activeMatch?: boolean;
  /** Whether the chat is in multi-select mode (affects tap behaviour). */
  selectionMode?: boolean;
  /** Show a small star in the meta row when this message is bookmarked. */
  starred?: boolean;
  /** View-Once (0030): this View-Once message has already been consumed by the
   *  current user — render an opened/locked state instead of the image. */
  viewOnceSpent?: boolean;
}

/** Split text into <Text> runs, wrapping case-insensitive matches of `term`. */
function renderHighlighted(text: string, term: string, baseStyle: any, hitStyle: any) {
  if (!term) return <Text style={baseStyle}>{text}</Text>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0, k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(term, i);
    if (idx === -1) { parts.push(<Text key={k++}>{text.slice(i)}</Text>); break; }
    if (idx > i) parts.push(<Text key={k++}>{text.slice(i, idx)}</Text>);
    parts.push(<Text key={k++} style={hitStyle}>{text.slice(idx, idx + term.length)}</Text>);
    i = idx + term.length;
  }
  return <Text style={baseStyle}>{parts}</Text>;
}

function groupReactions(
  reactions: MessageReaction[],
  myId?: string | null,
): { emoji: string; count: number; mine: boolean }[] {
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (myId && r.user_id === myId) cur.mine = true;
    map.set(r.emoji, cur);
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }));
}

function MessageBubble({
  message,
  mine,
  myId,
  senderName,
  replyTo,
  onReplyPress,
  reactions = [],
  tick,
  onPress,
  selected,
  grouped: groupedRun,
  onOpenImage,
  onOpenDocument,
  onReactionPress,
  highlight = '',
  activeMatch = false,
  selectionMode = false,
  starred = false,
  viewOnceSpent = false,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tint = mine ? colors.bubbleOutText : colors.text;
  // Continuation bubbles stack tightly with no tail (WhatsApp grouping).
  const bubbleShape = groupedRun
    ? { borderTopRightRadius: radius.lg, borderTopLeftRadius: radius.lg }
    : null;
  const wrapTight = groupedRun ? { marginVertical: 1 } : null;

  if (message.is_deleted) {
    return (
      <View style={[styles.wrap, wrapTight, mine ? styles.wrapMine : styles.wrapTheirs, selected && styles.wrapSelected]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, bubbleShape]}>
          <Text style={[styles.deleted, { color: mine ? colors.bubbleOutMuted : colors.textMuted }]}>
            <Ionicons name="ban-outline" size={13} /> This message was deleted
          </Text>
        </View>
      </View>
    );
  }

  const grouped = groupReactions(reactions, myId);

  return (
    <Pressable
      onPress={onPress}
      // WhatsApp-style press-and-hold feedback: the bubble subtly scales/dims while
      // held (the wrapper's native long-press then fires the action sheet + haptic).
      style={({ pressed }) => [
        styles.wrap, wrapTight,
        mine ? styles.wrapMine : styles.wrapTheirs,
        selected && styles.wrapSelected,
        pressed && styles.wrapPressed,
      ]}
    >
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, bubbleShape, activeMatch && styles.bubbleActiveMatch]}>
        {!mine && senderName && !groupedRun && <Text style={styles.sender}>{senderName}</Text>}

        {message.is_forwarded && (
          <View style={styles.forwarded}>
            <Ionicons name="arrow-redo-outline" size={12} color={mine ? colors.bubbleOutMuted : colors.textFaint} />
            <Text style={[styles.forwardedText, { color: mine ? colors.bubbleOutMuted : colors.textFaint }]}>Forwarded</Text>
          </View>
        )}

        {replyTo && (
          <Pressable
            onPress={selectionMode ? onPress : onReplyPress}
            style={[styles.reply, { borderLeftColor: colors.primary }]}
          >
            <Text style={styles.replyName} numberOfLines={1}>
              {replyTo.is_deleted ? 'Message' : 'Replying to'}
            </Text>
            <Text style={[styles.replyText, { color: mine ? colors.bubbleOutMuted : colors.textMuted }]} numberOfLines={1}>
              {replyTo.is_deleted ? 'This message was deleted' : replySummary(replyTo)}
            </Text>
          </Pressable>
        )}

        {message.type === 'image' && message.media_url && (() => {
          const isVO = !!message.media_meta?.viewOnce;
          const spent = isVO && !mine && viewOnceSpent;
          // Recipient's unopened View-Once shows a locked tile (no thumbnail leak);
          // a spent one shows an "opened" state and can't be reopened. Sender always
          // sees their own thumbnail. Non-View-Once behaves exactly as before.
          if (isVO && !mine) {
            return (
              <Pressable style={styles.voTile} onPress={() => !spent && onOpenImage?.(message.media_url!)}>
                <Ionicons name={spent ? 'eye-off-outline' : 'eye-outline'} size={30} color={spent ? colors.textFaint : colors.primary} />
                <Text style={[styles.voTileText, spent && { color: colors.textFaint }]}>
                  {spent ? 'Opened' : 'View once — tap to view'}
                </Text>
              </Pressable>
            );
          }
          return (
            <>
              <Pressable onPress={() => onOpenImage?.(message.media_url!)}>
                <SignedImage
                  source={message.media_url}
                  containerStyle={styles.image}
                  contentFit="cover"
                  tint={colors.primary}
                />
                {isVO && (
                  <View style={styles.viewOnceTag}>
                    <Ionicons name="eye" size={12} color="#fff" />
                    <Text style={styles.viewOnceText}>View once</Text>
                  </View>
                )}
              </Pressable>
              {!!message.content?.trim() &&
                renderHighlighted(message.content, highlight, [styles.text, { color: tint }], styles.highlightHit)}
            </>
          );
        })()}

        {message.type === 'audio' && message.media_url && (
          <AudioMessage
            uri={message.media_url}
            tint={mine ? colors.bubbleOutText : colors.primary}
          />
        )}

        {message.media_url && isVideoMessage(message) && (
          <>
            <Pressable
              onPress={() => onOpenImage?.(message.media_url!)}
              style={styles.videoTile}
            >
              <Ionicons name="play-circle" size={48} color="#fff" />
              <Text style={styles.videoLabel} numberOfLines={1}>Video</Text>
            </Pressable>
            {!!message.content?.trim() &&
              renderHighlighted(message.content, highlight, [styles.text, { color: tint }], styles.highlightHit)}
          </>
        )}

        {message.type === 'file' && message.media_url && !isVideoUrl(message.media_url) && (
          <Pressable
            style={styles.file}
            onPress={() =>
              selectionMode
                ? onPress?.()
                : onOpenDocument?.(message) ?? onOpenImage?.(message.media_url!)
            }
          >
            <Ionicons name="document-outline" size={28} color={tint} />
            <Text style={[styles.fileName, { color: tint }]} numberOfLines={1}>
              {message.content || 'Attachment'}
            </Text>
            <Ionicons name="download-outline" size={18} color={tint} style={{ marginLeft: 6 }} />
          </Pressable>
        )}

        {message.type === 'text' && !!message.content && (
          renderHighlighted(message.content, highlight, [styles.text, { color: tint }], styles.highlightHit)
        )}

        <View style={styles.meta}>
          {starred && (
            <Ionicons name="star" size={12} color={mine ? colors.bubbleOutMuted : colors.textFaint} style={{ marginRight: 3 }} />
          )}
          {message.edited_at && <Text style={[styles.edited, { color: mine ? colors.bubbleOutMuted : colors.textFaint }]}>edited</Text>}
          <Text style={[styles.time, { color: mine ? colors.bubbleOutMuted : colors.textFaint }]}>
            {formatTime(message.created_at)}
          </Text>
          {mine && tick && (
            <Ionicons
              name={
                tick === 'failed'
                  ? 'alert-circle'
                  : tick === 'sending'
                    ? 'time-outline'
                    : tick === 'sent'
                      ? 'checkmark'
                      : 'checkmark-done'
              }
              size={15}
              color={
                tick === 'failed'
                  ? '#EF4444'
                  : tick === 'read'
                    ? '#53BDEB'
                    : colors.bubbleOutMuted
              }
              style={{ marginLeft: 3 }}
            />
          )}
        </View>
      </View>

      {grouped.length > 0 && (
        <View style={[styles.reactions, mine ? styles.reactionsMine : styles.reactionsTheirs]}>
          {grouped.map((g) => (
            <Pressable key={g.emoji} onPress={() => onReactionPress?.(g.emoji)} hitSlop={4}>
              <Text style={[styles.reactionChip, g.mine && styles.reactionChipMine]}>
                {g.emoji}
                {g.count > 1 ? ` ${g.count}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Pressable>
  );
}

// Re-render only when something that affects the rendered output changes — NOT
// when the parent re-renders for unrelated reasons (e.g. every keystroke in the
// composer). Callback identity is ignored on purpose: their behaviour is fully
// determined by `selectionMode` (compared below) + stable state setters + the
// row's own message, so a stale closure can never misbehave.
function sameReactions(a: MessageReaction[] = [], b: MessageReaction[] = []): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].emoji !== b[i].emoji || a[i].user_id !== b[i].user_id) return false;
  }
  return true;
}

function areEqual(a: Props, b: Props): boolean {
  if (
    a.mine !== b.mine ||
    a.myId !== b.myId ||
    a.grouped !== b.grouped ||
    a.selected !== b.selected ||
    a.selectionMode !== b.selectionMode ||
    a.tick !== b.tick ||
    a.activeMatch !== b.activeMatch ||
    a.highlight !== b.highlight ||
    a.senderName !== b.senderName ||
    a.starred !== b.starred ||
    a.viewOnceSpent !== b.viewOnceSpent
  ) return false;
  const m = a.message, n = b.message;
  if (
    m.id !== n.id || m.content !== n.content || m.type !== n.type ||
    m.media_url !== n.media_url || m.is_deleted !== n.is_deleted || m.edited_at !== n.edited_at ||
    m.pending !== n.pending || m.is_forwarded !== n.is_forwarded
  ) return false;
  if (
    (a.replyTo?.id ?? null) !== (b.replyTo?.id ?? null) ||
    (a.replyTo?.content ?? null) !== (b.replyTo?.content ?? null) ||
    (a.replyTo?.is_deleted ?? null) !== (b.replyTo?.is_deleted ?? null)
  ) return false;
  return sameReactions(a.reactions, b.reactions);
}

export default React.memo(MessageBubble, areEqual);

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { marginVertical: 2, paddingHorizontal: 10, maxWidth: '100%' },
    wrapMine: { alignItems: 'flex-end' },
    wrapTheirs: { alignItems: 'flex-start' },
    wrapSelected: { backgroundColor: colors.primary + '18' },
    wrapPressed: { transform: [{ scale: 0.99 }], opacity: 0.92 },
    bubble: {
      maxWidth: '80%',
      borderRadius: 14,
      paddingHorizontal: 9,
      paddingVertical: 6,
    },
    bubbleMine: { backgroundColor: colors.bubbleOut, borderTopRightRadius: 4 },
    bubbleTheirs: { backgroundColor: colors.bubbleIn, borderTopLeftRadius: 4 },
    bubbleActiveMatch: { borderWidth: 1.5, borderColor: colors.primary },
    highlightHit: { backgroundColor: colors.primary, color: '#fff' },
    sender: { color: colors.primary, fontSize: 12.5, fontWeight: '700', marginBottom: 2, letterSpacing: -0.1 },
    forwarded: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2 },
    forwardedText: { fontSize: font.tiny, fontStyle: 'italic' },
    text: { fontSize: font.body, lineHeight: 19.5, letterSpacing: -0.1 },
    deleted: { fontSize: font.body, fontStyle: 'italic' },
    image: { width: 210, height: 210, borderRadius: 10, marginBottom: 2 },
    viewOnceTag: { position: 'absolute', left: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
    viewOnceText: { color: '#fff', fontSize: 10.5, fontWeight: '600' },
    voTile: { width: 210, height: 110, borderRadius: 10, marginBottom: 2, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    voTileText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
    file: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, minWidth: 168 },
    fileName: { fontSize: font.body, marginLeft: 8, flex: 1 },
    videoTile: {
      width: 210, height: 128, borderRadius: 10, marginBottom: 2,
      backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
    },
    videoLabel: { color: '#fff', fontSize: font.small, marginTop: 4, maxWidth: 190 },
    reply: {
      borderLeftWidth: 2.5,
      paddingLeft: 7,
      paddingVertical: 3,
      marginBottom: 4,
      borderRadius: 4,
      backgroundColor: 'rgba(0,0,0,0.12)',
    },
    replyName: { color: colors.primary, fontSize: font.tiny, fontWeight: '700' },
    replyText: { fontSize: 12.5, lineHeight: 16 },
    meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2 },
    edited: { fontSize: 10, marginRight: 4 },
    time: { fontSize: 10.5, opacity: 0.9 },
    reactions: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      paddingHorizontal: 5,
      paddingVertical: 1,
      marginTop: -5,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    reactionsMine: { marginRight: 6 },
    reactionsTheirs: { marginLeft: 6 },
    reactionChip: { fontSize: 12.5, marginHorizontal: 1, color: colors.text },
    reactionChipMine: { color: colors.primary, fontWeight: '700' },
  });
