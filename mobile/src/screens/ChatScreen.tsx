// FUTUREHAT mobile — the chat thread. Realtime messages, media + voice,
// reactions, reply/edit/delete/forward, typing, presence and read receipts.
// All data flows through the shared API; this screen is presentation + glue.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  createPoll,
  getPolls,
  getPollVotes,
  votePoll,
  messageMatchesKind,
} from '../lib/shared';
import type { Message, MessageReaction, Profile, ConversationSummary, Poll, PollVote, SearchKind } from '../lib/shared';
import { uploadMediaFromUri } from '../lib/media';
import { formatLastSeen, formatDaySeparator } from '../lib/time';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import MessageBubble, { type TickStatus, isVideoUrl } from '../components/MessageBubble';
import MediaViewer, { type ViewerItem } from '../components/MediaViewer';
import PollCard from '../components/PollCard';
import { useCalls } from '../calls/CallContext';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Chat'>;
type Rt = RouteProp<RootStackParamList, 'Chat'>;

const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// The thread renders messages and polls interleaved by time.
type TimelineItem =
  | { kind: 'msg'; id: string; at: string; message: Message; grouped?: boolean }
  | { kind: 'poll'; id: string; at: string; poll: Poll }
  | { kind: 'day'; id: string; at: string; label: string };

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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionForward, setSelectionForward] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchKind, setSearchKind] = useState<SearchKind>('all');
  const [activeMatch, setActiveMatch] = useState(0);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardList, setForwardList] = useState<ConversationSummary[]>([]);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sending, setSending] = useState(false);

  const [polls, setPolls] = useState<Poll[]>([]);
  const [pollVotes, setPollVotes] = useState<Map<string, PollVote[]>>(new Map());
  const [pollBuilder, setPollBuilder] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);

  const listRef = useRef<FlatList<TimelineItem>>(null);
  const typingChannel = useRef<ReturnType<typeof createTypingChannel> | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMsgs = useCallback((updater: (prev: Message[]) => Message[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const loadPolls = useCallback(async () => {
    const ps = await getPolls(supabase, conversationId);
    setPolls(ps);
    const entries = await Promise.all(
      ps.map(async (p) => [p.id, await getPollVotes(supabase, p.id)] as const),
    );
    setPollVotes(new Map(entries));
  }, [conversationId]);

  const onVotePoll = useCallback(
    async (poll: Poll, optionIndex: number) => {
      await votePoll(supabase, poll.id, optionIndex, poll.multiple);
      const fresh = await getPollVotes(supabase, poll.id);
      setPollVotes((prev) => new Map(prev).set(poll.id, fresh));
    },
    [],
  );

  async function submitPoll() {
    const q = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) {
      Alert.alert('Incomplete poll', 'Add a question and at least two options.');
      return;
    }
    setPollBuilder(false);
    const { error } = await createPoll(supabase, conversationId, q, opts, pollMultiple);
    if (error) {
      Alert.alert('Could not create poll', error.message);
      return;
    }
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollMultiple(false);
    await loadPolls();
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }

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
      loadPolls().catch(() => {});

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
    if (selectionMode) {
      navigation.setOptions({
        headerTitle: () => <Text style={styles.headerTitle}>{selectedIds.size} selected</Text>,
        headerLeft: () => (
          <Pressable hitSlop={8} onPress={exitSelection}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        ),
        headerRight: () => (
          <View style={styles.headerActions}>
            <Pressable hitSlop={8} onPress={copySelected}>
              <Ionicons name="copy-outline" size={21} color={colors.text} />
            </Pressable>
            <Pressable hitSlop={8} onPress={forwardSelectedMany} style={{ marginLeft: 18 }}>
              <Ionicons name="arrow-redo-outline" size={22} color={colors.text} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => deleteMany([...selectedIds])} style={{ marginLeft: 18 }}>
              <Ionicons name="trash-outline" size={21} color={colors.danger} />
            </Pressable>
          </View>
        ),
      });
      return;
    }
    navigation.setOptions({
      headerLeft: undefined,
      headerTitle: () => (
        <Pressable onPress={() => peers[0] && navigation.navigate('Profile', { userId: peers[0].id, conversationId })}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {params.title}
          </Text>
          {!!subtitle && <Text style={styles.headerSub}>{subtitle}</Text>}
        </Pressable>
      ),
      // Group calling isn't implemented yet, so 1:1 call buttons are only shown
      // in direct chats — no dead/"coming soon" buttons in groups.
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable hitSlop={8} onPress={() => setSearchOpen((v) => !v)}>
            <Ionicons name="search-outline" size={21} color={colors.text} />
          </Pressable>
          {!isGroup && (
            <>
              <Pressable hitSlop={8} onPress={() => placeCall('audio')} style={{ marginLeft: 18 }}>
                <Ionicons name="call-outline" size={22} color={colors.text} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => placeCall('video')} style={{ marginLeft: 18 }}>
                <Ionicons name="videocam-outline" size={24} color={colors.text} />
              </Pressable>
            </>
          )}
        </View>
      ),
    });
  }, [navigation, params.title, subtitle, peers, colors, styles, selectionMode, selectedIds, isGroup]);

  function placeCall(kind: 'audio' | 'video') {
    // Only reachable from direct chats (call buttons are hidden in groups).
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

  // ── Multi-select ──────────────────────────────────────────────────────────
  function enterSelection(m: Message) {
    setSelectionMode(true);
    setSelectedIds(new Set([m.id]));
  }
  function toggleSelect(m: Message) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }
  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setSelectionForward(false);
  }
  async function copySelected() {
    const texts = messagesRef.current.filter((m) => selectedIds.has(m.id) && m.content).map((m) => m.content as string);
    if (texts.length) await Clipboard.setStringAsync(texts.join('\n'));
    exitSelection();
  }
  async function forwardSelectedMany() {
    const list = await getMyConversations(supabase);
    setForwardList(list);
    setSelectionForward(true);
    setForwardOpen(true);
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
    Alert.alert('Delete message', 'Are you sure you want to delete this message?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete for everyone',
        style: 'destructive',
        onPress: async () => {
          setSelected(null);
          await deleteMessage(supabase, target.id);
          setMsgs((prev) => prev.map((m) => (m.id === target.id ? { ...m, is_deleted: true } : m)));
        },
      },
    ]);
  }

  // Bulk delete for multi-select (delete-for-everyone).
  async function deleteMany(ids: string[]) {
    Alert.alert('Delete messages', `Delete ${ids.length} message${ids.length === 1 ? '' : 's'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete for everyone',
        style: 'destructive',
        onPress: async () => {
          exitSelection();
          await Promise.all(ids.map((id) => deleteMessage(supabase, id).catch(() => {})));
          setMsgs((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, is_deleted: true } : m)));
        },
      },
    ]);
  }

  async function openForward() {
    const list = await getMyConversations(supabase);
    setForwardList(list);
    setForwardOpen(true);
  }

  async function doForward(targetId: string) {
    setForwardOpen(false);
    if (selectionForward) {
      const srcs = messagesRef.current.filter((m) => selectedIds.has(m.id));
      for (const m of srcs) {
        await forwardMessage(supabase, targetId, { type: m.type, content: m.content, media_url: m.media_url });
      }
      exitSelection();
      return;
    }
    if (!selected) return;
    const src = selected;
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

  // Image/video messages — backs the swipeable full-screen viewer.
  const viewerItems = useMemo<ViewerItem[]>(() => messages
    .filter((m) => !m.is_deleted && m.media_url && (m.type === 'image' || (m.type === 'file' && isVideoUrl(m.media_url))))
    .map((m) => ({ id: m.id, url: m.media_url!, kind: m.type === 'image' ? ('image' as const) : ('video' as const) })),
    [messages]);
  const viewerIndex = viewerUrl ? Math.max(0, viewerItems.findIndex((v) => v.url === viewerUrl)) : -1;

  // Merge messages and polls into one chronological timeline, then insert day
  // separators and flag consecutive same-sender messages (WhatsApp grouping).
  const timeline = useMemo<TimelineItem[]>(() => {
    const merged: TimelineItem[] = [
      ...messages.map((m): TimelineItem => ({ kind: 'msg', id: m.id, at: m.created_at, message: m })),
      ...polls.map((p): TimelineItem => ({ kind: 'poll', id: `poll:${p.id}`, at: p.created_at, poll: p })),
    ];
    merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const GROUP_WINDOW_MS = 5 * 60 * 1000;
    const out: TimelineItem[] = [];
    let lastDay = '';
    let prevMsg: Message | null = null;
    for (const it of merged) {
      const day = formatDaySeparator(it.at);
      if (day !== lastDay) {
        out.push({ kind: 'day', id: `day:${day}:${it.id}`, at: it.at, label: day });
        lastDay = day;
        prevMsg = null; // a new day always restarts grouping
      }
      if (it.kind === 'msg') {
        const grouped = !!prevMsg && prevMsg.sender_id === it.message.sender_id &&
          new Date(it.at).getTime() - new Date(prevMsg.created_at).getTime() < GROUP_WINDOW_MS;
        out.push({ ...it, grouped });
        prevMsg = it.message;
      } else {
        out.push(it);
        prevMsg = null; // a poll breaks the run
      }
    }
    return out;
  }, [messages, polls]);

  const renderItem = ({ item }: { item: TimelineItem }) => {
    if (item.kind === 'day') {
      return (
        <View style={styles.daySep}>
          <Text style={styles.daySepText}>{item.label}</Text>
        </View>
      );
    }
    if (item.kind === 'poll') {
      return (
        <PollCard
          poll={item.poll}
          votes={pollVotes.get(item.poll.id) ?? []}
          myUserId={uid}
          onVote={(optionIndex) => onVotePoll(item.poll, optionIndex)}
        />
      );
    }
    const msg = item.message;
    const mine = msg.sender_id === uid;
    const replyTo = msg.reply_to ? messages.find((m) => m.id === msg.reply_to) ?? null : null;
    const senderName = isGroup ? peers.find((p) => p.id === msg.sender_id)?.display_name : null;
    return (
      <MessageBubble
        message={msg}
        mine={mine}
        myId={uid}
        grouped={item.grouped}
        senderName={senderName}
        replyTo={replyTo}
        reactions={reactionsByMsg.get(msg.id)}
        tick={mine ? receipts.get(msg.id) ?? 'sent' : undefined}
        selected={selectionMode && selectedIds.has(msg.id)}
        onLongPress={() => {
          Haptics.selectionAsync().catch(() => {});
          if (selectionMode) toggleSelect(msg);
          else setSelected(msg);
        }}
        onPress={selectionMode ? () => toggleSelect(msg) : undefined}
        onOpenImage={(url) => (selectionMode ? toggleSelect(msg) : setViewerUrl(url))}
        highlight={searchActive ? search : ''}
        activeMatch={msg.id === activeMatchId}
      />
    );
  };

  const inverted = useMemo(() => [...timeline].reverse(), [timeline]);

  // In-chat search: jump between matching messages (no filtering).
  const search = searchTerm.trim().toLowerCase();
  const searchActive = searchOpen && (!!search || searchKind !== 'all');
  const matchIds = useMemo(() => {
    if (!searchActive) return [] as string[];
    return messages
      .filter((m) => !m.is_deleted && messageMatchesKind(m, searchKind) && (!search || (m.content ?? '').toLowerCase().includes(search)))
      .map((m) => m.id);
  }, [messages, search, searchKind, searchActive]);
  const activeMatchId = matchIds[activeMatch];

  const scrollToMessage = useCallback((id: string) => {
    const idx = inverted.findIndex((it) => it.id === id);
    if (idx >= 0) {
      try { listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }); } catch { /* measured later */ }
    }
  }, [inverted]);
  function jumpMatch(delta: number) {
    if (matchIds.length === 0) return;
    const next = (activeMatch + delta + matchIds.length) % matchIds.length;
    setActiveMatch(next);
    scrollToMessage(matchIds[next]);
  }
  useEffect(() => {
    if (!searchActive || matchIds.length === 0) { setActiveMatch(0); return; }
    setActiveMatch(0);
    const t = setTimeout(() => scrollToMessage(matchIds[0]), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchKind, searchActive]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {searchOpen && (
        <View style={styles.searchBar}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              autoFocus
              style={styles.searchInput}
              placeholder="Search in this chat"
              placeholderTextColor={colors.textFaint}
              value={searchTerm}
              onChangeText={setSearchTerm}
              returnKeyType="search"
              onSubmitEditing={() => jumpMatch(1)}
            />
            {searchActive && (
              <Text style={styles.searchCount}>
                {matchIds.length === 0 ? '0' : `${activeMatch + 1}/${matchIds.length}`}
              </Text>
            )}
            <Pressable hitSlop={8} disabled={matchIds.length === 0} onPress={() => jumpMatch(-1)}>
              <Ionicons name="chevron-up" size={20} color={matchIds.length ? colors.text : colors.textFaint} />
            </Pressable>
            <Pressable hitSlop={8} disabled={matchIds.length === 0} onPress={() => jumpMatch(1)} style={{ marginLeft: 12 }}>
              <Ionicons name="chevron-down" size={20} color={matchIds.length ? colors.text : colors.textFaint} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => { setSearchOpen(false); setSearchTerm(''); setSearchKind('all'); }} style={{ marginLeft: 12 }}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.searchChips}>
            {(['all', 'media', 'links', 'docs', 'voice'] as SearchKind[]).map((k) => (
              <Pressable key={k} onPress={() => setSearchKind(k)} style={[styles.searchChip, searchKind === k && styles.searchChipActive]}>
                <Text style={[styles.searchChipText, searchKind === k && styles.searchChipTextActive]}>
                  {k === 'all' ? 'All' : k === 'media' ? 'Media' : k === 'links' ? 'Links' : k === 'docs' ? 'Docs' : 'Voice'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={inverted}
        inverted
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            try { listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }); } catch { /* give up */ }
          }, 120);
        }}
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
            <Text style={styles.recText}>Recording… 🗑 cancel · ➤ send</Text>
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
            <Pressable onPress={handleSend} style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed]} disabled={sending}>
              <Ionicons name={editing ? 'checkmark' : 'send'} size={20} color="#fff" />
            </Pressable>
          ) : (
            <Pressable onPress={startRecording} style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed]}>
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
            <AttachOption
              icon="bar-chart"
              label="Poll"
              color="#00A884"
              onPress={() => {
                setAttachOpen(false);
                setPollBuilder(true);
              }}
            />
          </View>
        </Pressable>
      </Modal>

      {/* Poll builder */}
      <Modal visible={pollBuilder} transparent animationType="slide" onRequestClose={() => setPollBuilder(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPollBuilder(false)}>
          <Pressable style={[styles.sheet, styles.pollSheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>New poll</Text>
            <TextInput
              style={styles.pollInput}
              placeholder="Ask a question"
              placeholderTextColor={colors.textFaint}
              value={pollQuestion}
              onChangeText={setPollQuestion}
            />
            {pollOptions.map((opt, i) => (
              <TextInput
                key={i}
                style={styles.pollInput}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={colors.textFaint}
                value={opt}
                onChangeText={(t) => setPollOptions((prev) => prev.map((o, j) => (j === i ? t : o)))}
              />
            ))}
            {pollOptions.length < 6 && (
              <Pressable style={styles.pollAddOpt} onPress={() => setPollOptions((prev) => [...prev, ''])}>
                <Ionicons name="add" size={18} color={colors.primary} />
                <Text style={styles.pollAddOptText}>Add option</Text>
              </Pressable>
            )}
            <Pressable style={styles.pollToggle} onPress={() => setPollMultiple((v) => !v)}>
              <Ionicons name={pollMultiple ? 'checkbox' : 'square-outline'} size={20} color={colors.primary} />
              <Text style={styles.pollToggleText}>Allow multiple answers</Text>
            </Pressable>
            <Pressable style={styles.pollCreate} onPress={submitPoll}>
              <Text style={styles.pollCreateText}>Create poll</Text>
            </Pressable>
          </Pressable>
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
            <ActionRow icon="checkmark-circle-outline" label="Select" onPress={() => { if (selected) enterSelection(selected); setSelected(null); }} />
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

      {/* Full-screen media viewer (swipe / zoom / video) */}
      {viewerIndex >= 0 && (
        <MediaViewer items={viewerItems} index={viewerIndex} onClose={() => setViewerUrl(null)} />
      )}
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
    daySep: { alignItems: 'center', marginVertical: 10 },
    daySepText: {
      color: colors.textMuted, fontSize: font.tiny, fontWeight: '600',
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 5,
      borderRadius: radius.sm, overflow: 'hidden',
    },
    headerTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600' },
    headerSub: { color: colors.textMuted, fontSize: font.tiny },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    searchBar: {
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 8,
    },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: font.body, paddingVertical: 2 },
    searchCount: { color: colors.textMuted, fontSize: font.small, minWidth: 36, textAlign: 'right' },
    searchChips: { flexDirection: 'row', gap: 6 },
    searchChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
    searchChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    searchChipText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    searchChipTextActive: { color: '#fff' },
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
    sendBtnPressed: { transform: [{ scale: 0.9 }], opacity: 0.9 },
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
    pollSheet: { maxHeight: '80%' },
    pollInput: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: font.body,
      marginBottom: 8,
    },
    pollAddOpt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    pollAddOptText: { color: colors.primary, fontSize: font.body, fontWeight: '600', marginLeft: 6 },
    pollToggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    pollToggleText: { color: colors.text, fontSize: font.body, marginLeft: 10 },
    pollCreate: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    pollCreateText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
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
  });
