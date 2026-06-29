// FUTUREHAT mobile — the chat thread. Realtime messages, media + voice,
// reactions, reply/edit/delete/forward, typing, presence and read receipts.
// All data flows through the shared API; this screen is presentation + glue.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  forwardMessage,
  markMessageAsRead,
  getReceipts,
  subscribeToMessages,
  subscribeToReceipts,
  getReactions,
  toggleReaction,
  subscribeToReactions,
  createTypingChannel,
  joinPresence,
  getCurrentUser,
  getMyConversations,
} from '../lib/shared';
import type { Message, MessageReaction, Profile, ConversationSummary } from '../lib/shared';
import { uploadMediaFromUri } from '../lib/media';
import { formatLastSeen } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import MessageBubble, { type TickStatus } from '../components/MessageBubble';
import { useCalls } from '../calls/CallContext';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Chat'>;
type Rt = RouteProp<RootStackParamList, 'Chat'>;

const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function ChatScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const { conversationId } = params;
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { startCall } = useCalls();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [uid, setUid] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [receipts, setReceipts] = useState<Map<string, TickStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  const [peers, setPeers] = useState<Profile[]>([]);
  const [isGroup, setIsGroup] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [typingName, setTypingName] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardList, setForwardList] = useState<ConversationSummary[]>([]);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList<Message>>(null);
  const typingChannel = useRef<ReturnType<typeof createTypingChannel> | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMsgs = useCallback((updater: (prev: Message[]) => Message[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  // ── Bootstrap: who am I, conversation peers, history ──────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      const user = await getCurrentUser(supabase);
      if (!active) return;
      setUid(user?.id ?? null);

      const summaries = await getMyConversations(supabase);
      const summary = summaries.find((s) => s.conversation.id === conversationId);
      if (summary && active) {
        setIsGroup(summary.conversation.type === 'group');
        setPeers(summary.participants.filter((p) => p.id !== user?.id));
      }

      const msgs = await getMessages(supabase, conversationId, 100);
      if (!active) return;
      const ordered = [...msgs].reverse(); // newest last for inverted list
      setMsgs(() => ordered);
      setLoading(false);

      const ids = msgs.map((m) => m.id);
      const [rx, rc] = await Promise.all([getReactions(supabase, ids), getReceipts(supabase, ids)]);
      if (!active) return;
      setReactions(rx);
      applyReceipts(rc);

      // mark unread incoming as read
      msgs
        .filter((m) => m.sender_id !== user?.id)
        .forEach((m) => markMessageAsRead(supabase, m.id).catch(() => {}));
    })();
    return () => {
      active = false;
    };
  }, [conversationId, setMsgs]);

  const applyReceipts = useCallback((rows: { message_id: string; status: string }[]) => {
    setReceipts((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        const cur = next.get(r.message_id);
        if (r.status === 'read' || cur !== 'read') {
          next.set(r.message_id, r.status as TickStatus);
        }
      }
      return next;
    });
  }, []);

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) return;

    const msgChannel = subscribeToMessages(
      supabase,
      conversationId,
      (incoming) => {
        setMsgs((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
        if (incoming.sender_id !== uid) {
          markMessageAsRead(supabase, incoming.id).catch(() => {});
        }
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
      },
      (updated) => {
        setMsgs((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      },
    );

    const rxChannel = subscribeToReactions(supabase, conversationId, () => {
      getReactions(
        supabase,
        messagesRef.current.map((m) => m.id),
      ).then(setReactions);
    });

    const rcChannel = subscribeToReceipts(supabase, conversationId, (r) =>
      applyReceipts([r as any]),
    );

    const presenceChannel = joinPresence(supabase, uid, setOnlineIds);

    const tc = createTypingChannel(supabase, conversationId, (p) => {
      if (p.userId === uid) return;
      setTypingName(p.typing ? p.name : null);
      if (p.typing) {
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => setTypingName(null), 4000);
      }
    });
    typingChannel.current = tc;

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(rxChannel);
      supabase.removeChannel(rcChannel);
      supabase.removeChannel(presenceChannel);
      supabase.removeChannel(tc.channel);
    };
  }, [uid, conversationId, setMsgs, applyReceipts]);

  // ── Header (title + presence / typing subtitle) ───────────────────────────
  const peerOnline = peers.some((p) => onlineIds.has(p.id));
  const subtitle = typingName
    ? isGroup
      ? `${typingName} is typing…`
      : 'typing…'
    : isGroup
      ? `${peers.length + 1} members`
      : peerOnline
        ? 'online'
        : formatLastSeen(peers[0]?.last_seen);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Pressable onPress={() => peers[0] && navigation.navigate('Profile', { userId: peers[0].id })}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {params.title}
          </Text>
          {!!subtitle && <Text style={styles.headerSub}>{subtitle}</Text>}
        </Pressable>
      ),
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable hitSlop={8} onPress={() => placeCall('audio')}>
            <Ionicons name="call-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => placeCall('video')} style={{ marginLeft: 18 }}>
            <Ionicons name="videocam-outline" size={24} color={colors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, params.title, subtitle, peers, colors, styles]);

  function placeCall(kind: 'audio' | 'video') {
    if (isGroup) {
      Alert.alert('Group calls', 'Group calling is coming soon. Open a 1:1 chat to call now.');
      return;
    }
    const peer = peers[0];
    if (!peer) return;
    startCall(conversationId, peer, kind);
  }

  // ── Compose / send ────────────────────────────────────────────────────────
  function onChangeText(t: string) {
    setText(t);
    typingChannel.current?.notify({ userId: uid ?? '', name: 'Someone', typing: t.length > 0 });
  }

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setText('');
    typingChannel.current?.notify({ userId: uid ?? '', name: 'Someone', typing: false });

    if (editing) {
      const target = editing;
      setEditing(null);
      await editMessage(supabase, target.id, body);
      return;
    }

    setSending(true);
    const replyId = reply?.id;
    setReply(null);
    const { message } = await sendMessage(supabase, conversationId, body, 'text', undefined, replyId);
    if (message) {
      setMsgs((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      setReceipts((prev) => new Map(prev).set(message.id, 'sent'));
    }
    setSending(false);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }

  async function sendMedia(
    uri: string,
    fileName: string,
    type: 'image' | 'file' | 'audio',
    caption?: string,
  ) {
    setSending(true);
    try {
      const { url, error } = await uploadMediaFromUri(conversationId, uri, fileName);
      if (error || !url) {
        Alert.alert('Upload failed', error?.message ?? 'Could not upload file.');
        return;
      }
      const { message } = await sendMessage(supabase, conversationId, caption ?? fileName, type, url);
      if (message) {
        setMsgs((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        setReceipts((prev) => new Map(prev).set(message.id, 'sent'));
      }
    } finally {
      setSending(false);
    }
  }

  async function pickImage(fromCamera: boolean) {
    setAttachOpen(false);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7,
        });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    await sendMedia(a.uri, a.fileName ?? `photo_${Date.now()}.jpg`, 'image');
  }

  async function pickDocument() {
    setAttachOpen(false);
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    await sendMedia(a.uri, a.name, 'file');
  }

  // ── Voice notes ───────────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(recording);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {
      // ignore
    }
  }

  async function stopRecording(send: boolean) {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (send && uri) await sendMedia(uri, `voice_${Date.now()}.m4a`, 'audio');
    } catch {
      setRecording(null);
    }
  }

  // ── Message actions ───────────────────────────────────────────────────────
  async function react(emoji: string) {
    if (!selected) return;
    const target = selected;
    setSelected(null);
    await toggleReaction(supabase, target.id, emoji);
    getReactions(supabase, messagesRef.current.map((m) => m.id)).then(setReactions);
  }

  async function doDelete() {
    if (!selected) return;
    const target = selected;
    setSelected(null);
    await deleteMessage(supabase, target.id);
    setMsgs((prev) => prev.map((m) => (m.id === target.id ? { ...m, is_deleted: true } : m)));
  }

  async function openForward() {
    const list = await getMyConversations(supabase);
    setForwardList(list);
    setForwardOpen(true);
  }

  async function doForward(targetId: string) {
    if (!selected) return;
    const src = selected;
    setForwardOpen(false);
    setSelected(null);
    await forwardMessage(supabase, targetId, {
      type: src.type,
      content: src.content,
      media_url: src.media_url,
    });
  }

  const reactionsByMsg = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const arr = map.get(r.message_id) ?? [];
      arr.push(r);
      map.set(r.message_id, arr);
    }
    return map;
  }, [reactions]);

  const renderItem = ({ item }: { item: Message }) => {
    const mine = item.sender_id === uid;
    const replyTo = item.reply_to ? messages.find((m) => m.id === item.reply_to) ?? null : null;
    const senderName = isGroup ? peers.find((p) => p.id === item.sender_id)?.display_name : null;
    return (
      <MessageBubble
        message={item}
        mine={mine}
        senderName={senderName}
        replyTo={replyTo}
        reactions={reactionsByMsg.get(item.id)}
        tick={mine ? receipts.get(item.id) ?? 'sent' : undefined}
        onLongPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setSelected(item);
        }}
        onOpenImage={(url) => setViewerUrl(url)}
      />
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const inverted = [...messages].reverse();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <FlatList
        ref={listRef}
        data={inverted}
        inverted
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />

      {/* Reply / edit preview bar */}
      {(reply || editing) && (
        <View style={styles.previewBar}>
          <View style={styles.previewLine} />
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle}>{editing ? 'Edit message' : 'Reply'}</Text>
            <Text style={styles.previewText} numberOfLines={1}>
              {(editing ?? reply)?.content ?? 'Attachment'}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => {
              setReply(null);
              setEditing(null);
              setText('');
            }}
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      {/* Composer */}
      {recording ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 6 }]}>
          <Pressable onPress={() => stopRecording(false)} hitSlop={8}>
            <Ionicons name="trash-outline" size={24} color={colors.danger} />
          </Pressable>
          <View style={styles.recordingPill}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>Recording… release to send</Text>
          </View>
          <Pressable onPress={() => stopRecording(true)} style={styles.sendBtn}>
            <Ionicons name="send" size={20} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 6 }]}>
          <Pressable onPress={() => setAttachOpen(true)} hitSlop={8}>
            <Ionicons name="add-circle-outline" size={28} color={colors.textMuted} />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor={colors.textFaint}
            value={text}
            onChangeText={onChangeText}
            multiline
          />
          {text.trim().length > 0 ? (
            <Pressable onPress={handleSend} style={styles.sendBtn} disabled={sending}>
              <Ionicons name={editing ? 'checkmark' : 'send'} size={20} color="#fff" />
            </Pressable>
          ) : (
            <Pressable onPress={startRecording} style={styles.sendBtn}>
              <Ionicons name="mic" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      {/* Attachment sheet */}
      <Modal visible={attachOpen} transparent animationType="slide" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAttachOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <AttachOption icon="image" label="Photo / Video" color="#5B6EF5" onPress={() => pickImage(false)} />
            <AttachOption icon="camera" label="Camera" color="#E8638A" onPress={() => pickImage(true)} />
            <AttachOption icon="document" label="Document" color="#F7A948" onPress={pickDocument} />
          </View>
        </Pressable>
      </Modal>

      {/* Message action sheet */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.emojiRow}>
              {QUICK_EMOJI.map((e) => (
                <Pressable key={e} onPress={() => react(e)} hitSlop={6}>
                  <Text style={styles.emoji}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <ActionRow icon="arrow-undo" label="Reply" onPress={() => { setReply(selected); setSelected(null); }} />
            {selected?.type === 'text' && (
              <ActionRow
                icon="copy"
                label="Copy"
                onPress={async () => {
                  if (selected?.content) await Clipboard.setStringAsync(selected.content);
                  setSelected(null);
                }}
              />
            )}
            <ActionRow icon="arrow-redo" label="Forward" onPress={openForward} />
            {selected?.sender_id === uid && selected?.type === 'text' && (
              <ActionRow
                icon="create"
                label="Edit"
                onPress={() => { setEditing(selected); setText(selected?.content ?? ''); setSelected(null); }}
              />
            )}
            {selected?.sender_id === uid && (
              <ActionRow icon="trash" label="Delete" danger onPress={doDelete} />
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Forward picker */}
      <Modal visible={forwardOpen} transparent animationType="slide" onRequestClose={() => setForwardOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setForwardOpen(false)}>
          <View style={[styles.sheet, styles.forwardSheet, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.sheetTitle}>Forward to</Text>
            <FlatList
              data={forwardList}
              keyExtractor={(c) => c.conversation.id}
              renderItem={({ item }) => (
                <Pressable style={styles.forwardRow} onPress={() => doForward(item.conversation.id)}>
                  <Text style={styles.forwardName}>{item.title}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>

      {/* Full-screen image viewer */}
      <Modal visible={!!viewerUrl} transparent animationType="fade" onRequestClose={() => setViewerUrl(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewerUrl(null)}>
          {viewerUrl && <Image source={{ uri: viewerUrl }} style={styles.viewerImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function AttachOption({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable style={attachStyles.opt} onPress={onPress}>
      <View style={[attachStyles.circle, { backgroundColor: color }]}>
        <Ionicons name={icon} size={24} color="#fff" />
      </View>
      <Text style={[attachStyles.label, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable style={attachStyles.actionRow} onPress={onPress}>
      <Ionicons name={icon} size={22} color={tint} />
      <Text style={[attachStyles.actionLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const attachStyles = StyleSheet.create({
  opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, marginLeft: 16 },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
  actionLabel: { fontSize: 16, marginLeft: 16 },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    listContent: { paddingVertical: 8 },
    headerTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600' },
    headerSub: { color: colors.textMuted, fontSize: font.tiny },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    previewBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    previewLine: { width: 3, height: 32, borderRadius: 2, backgroundColor: colors.primary, marginRight: 8 },
    previewTitle: { color: colors.primary, fontSize: font.small, fontWeight: '700' },
    previewText: { color: colors.textMuted, fontSize: font.small },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 10,
      paddingTop: 6,
      backgroundColor: colors.surface,
    },
    input: {
      flex: 1,
      color: colors.text,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingTop: Platform.OS === 'ios' ? 10 : 6,
      paddingBottom: Platform.OS === 'ios' ? 10 : 6,
      marginHorizontal: 8,
      maxHeight: 120,
      fontSize: font.body,
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recordingPill: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 12 },
    recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginRight: 8 },
    recText: { color: colors.textMuted, fontSize: font.small },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    sheetTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginBottom: 8 },
    forwardSheet: { maxHeight: '60%' },
    forwardRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    forwardName: { color: colors.text, fontSize: font.body },
    emojiRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: 10,
      marginBottom: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    emoji: { fontSize: 30 },
    viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
    viewerImg: { width: '100%', height: '80%' },
  });
