// Lumixo mobile — production forward flow. Pick one OR many chats (search +
// Recent + Direct + Groups, multi-select) → preview what's being forwarded →
// Send. Generic: used by the media viewer AND ChatScreen's message-selection
// forward. It only resolves recipients and calls onConfirm(ids); the caller owns
// the actual forwardMessage() writes (which set the "Forwarded" indicator).
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ConversationSummary } from '../lib/shared';
import { useColors, radius, type Palette } from '../theme';
import Avatar from './Avatar';
import SignedImage from './SignedImage';

const SHEET_RADIUS = 26;

export interface ForwardPreview {
  kind: 'image' | 'video';
  url: string;
  caption?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  conversations: ConversationSummary[];
  /** Forward to these conversation ids. May be async (network writes). */
  onConfirm: (targetIds: string[]) => void | Promise<void>;
  /** Optional media/message preview shown on the confirm step. */
  preview?: ForwardPreview | null;
  /** How many items are being forwarded (for the "Forward N items" label). */
  count?: number;
}

export default function ForwardSheet({ visible, onClose, conversations, onConfirm, preview, count = 1 }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [sending, setSending] = useState(false);

  // Reset transient state whenever the sheet is (re)opened.
  const reset = () => { setQuery(''); setSelected(new Set()); setStep('pick'); setSending(false); };
  const close = () => { reset(); onClose(); };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Recent = most-recent-message first (getMyConversations already returns them in
  // that order). Search filters by chat title across everything.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  const recent = useMemo(() => (query ? [] : filtered.slice(0, 6)), [filtered, query]);
  const groups = useMemo(() => filtered.filter((c) => c.conversation.type === 'group'), [filtered]);
  const directs = useMemo(() => filtered.filter((c) => c.conversation.type === 'direct'), [filtered]);

  const selectedSummaries = useMemo(
    () => conversations.filter((c) => selected.has(c.conversation.id)),
    [conversations, selected],
  );

  const send = async () => {
    if (!selected.size || sending) return;
    setSending(true);
    try {
      await onConfirm([...selected]);
      close();
    } finally {
      setSending(false);
    }
  };

  const Row = ({ item }: { item: ConversationSummary }) => {
    const id = item.conversation.id;
    const on = selected.has(id);
    return (
      <Pressable style={styles.row} onPress={() => toggle(id)}>
        <Avatar uri={item.avatarUrl} name={item.title} size={44} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {item.conversation.type === 'group' ? `Group · ${item.participants.length} members` : 'Direct message'}
          </Text>
        </View>
        <View style={[styles.check, on && styles.checkOn]}>
          {on && <Ionicons name="checkmark" size={15} color="#fff" />}
        </View>
      </Pressable>
    );
  };

  const Section = ({ label }: { label: string }) => <Text style={styles.section}>{label}</Text>;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
          <Pressable style={styles.backdrop} onPress={close} />
        </Animated.View>
        <Animated.View
          entering={SlideInDown.springify().damping(18).stiffness(180)}
          exiting={SlideOutDown.duration(180)}
          style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}
        >
          <View style={styles.handle} />
          {/* Header */}
          <View style={styles.header}>
            {step === 'confirm' ? (
              <Pressable hitSlop={10} onPress={() => setStep('pick')} style={styles.headerBtn}>
                <Ionicons name="arrow-back" size={22} color={colors.text} />
              </Pressable>
            ) : (
              <Pressable hitSlop={10} onPress={close} style={styles.headerBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            )}
            <Text style={styles.headerTitle}>
              {step === 'confirm' ? 'Send to' : count > 1 ? `Forward ${count} items` : 'Forward to'}
            </Text>
            <View style={styles.headerBtn} />
          </View>

          {step === 'pick' ? (
            <>
              <View style={styles.searchBar}>
                <Ionicons name="search" size={16} color={colors.textFaint} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search chats"
                  placeholderTextColor={colors.textFaint}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                />
                {!!query && (
                  <Pressable hitSlop={8} onPress={() => setQuery('')}>
                    <Ionicons name="close-circle" size={16} color={colors.textFaint} />
                  </Pressable>
                )}
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {recent.length > 0 && (
                  <>
                    <Section label="Recent" />
                    {recent.map((c) => <Row key={`r-${c.conversation.id}`} item={c} />)}
                  </>
                )}
                {directs.length > 0 && (
                  <>
                    <Section label="Direct messages" />
                    {directs.map((c) => <Row key={`d-${c.conversation.id}`} item={c} />)}
                  </>
                )}
                {groups.length > 0 && (
                  <>
                    <Section label="Groups" />
                    {groups.map((c) => <Row key={`g-${c.conversation.id}`} item={c} />)}
                  </>
                )}
                {filtered.length === 0 && (
                  <Text style={styles.empty}>No chats found</Text>
                )}
              </ScrollView>

              <Pressable
                style={[styles.cta, !selected.size && styles.ctaDisabled]}
                disabled={!selected.size}
                onPress={() => (preview ? setStep('confirm') : send())}
              >
                <Text style={styles.ctaText}>
                  {selected.size ? `Next · ${selected.size} selected` : 'Select chats'}
                </Text>
                {!!selected.size && <Ionicons name="arrow-forward" size={18} color="#fff" />}
              </Pressable>
            </>
          ) : (
            // ── Confirm / preview step ──────────────────────────────────────────
            <View style={styles.confirm}>
              {preview && (
                <View style={styles.previewCard}>
                  <SignedImage source={preview.url} containerStyle={styles.previewImg} contentFit="cover" tint={colors.primary} />
                  {preview.kind === 'video' && (
                    <View style={styles.previewPlay}><Ionicons name="play" size={16} color="#fff" /></View>
                  )}
                  <View style={styles.previewMeta}>
                    <Text style={styles.previewKind}>{preview.kind === 'video' ? 'Video' : 'Photo'}</Text>
                    {!!preview.caption && <Text style={styles.previewCaption} numberOfLines={2}>{preview.caption}</Text>}
                  </View>
                </View>
              )}

              <Text style={styles.section}>Recipients</Text>
              <View style={styles.chips}>
                {selectedSummaries.map((c) => (
                  <View key={c.conversation.id} style={styles.chip}>
                    <Avatar uri={c.avatarUrl} name={c.title} size={22} />
                    <Text style={styles.chipText} numberOfLines={1}>{c.title}</Text>
                    <Pressable hitSlop={8} onPress={() => toggle(c.conversation.id)}>
                      <Ionicons name="close" size={14} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>

              <Pressable style={[styles.cta, sending && styles.ctaDisabled]} disabled={sending} onPress={send}>
                {sending ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Text style={styles.ctaText}>Send</Text>
                    <Ionicons name="send" size={16} color="#fff" />
                  </>
                )}
              </Pressable>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.isLight ? 'rgba(15, 23, 28, 0.45)' : 'rgba(0, 0, 0, 0.62)',
    },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: SHEET_RADIUS,
      borderTopRightRadius: SHEET_RADIUS,
      paddingHorizontal: 16,
      paddingTop: 8,
      maxHeight: '88%',
      minHeight: '55%',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: -6 },
      elevation: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.textFaint,
      opacity: 0.55,
      marginBottom: 6,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
    headerTitle: { color: c.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surfaceAlt,
      borderRadius: 14, paddingHorizontal: 12, height: 44, marginBottom: 6,
    },
    searchInput: { flex: 1, color: c.text, fontSize: 15, padding: 0 },
    section: { color: c.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    rowText: { flex: 1 },
    rowTitle: { color: c.text, fontSize: 15, fontWeight: '600' },
    rowSub: { color: c.textFaint, fontSize: 12, marginTop: 1 },
    check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: c.primary, borderColor: c.primary },
    empty: { color: c.textFaint, textAlign: 'center', paddingVertical: 30 },
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.primary, borderRadius: 16, height: 52, marginTop: 12,
    },
    ctaDisabled: { opacity: 0.45 },
    ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    confirm: { flex: 1 },
    previewCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surfaceAlt, borderRadius: 16, padding: 12, marginTop: 8 },
    previewImg: { width: 60, height: 60, borderRadius: radius.sm },
    previewPlay: { position: 'absolute', left: 28, top: 28, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, padding: 3 },
    previewMeta: { flex: 1 },
    previewKind: { color: c.text, fontWeight: '700', fontSize: 14 },
    previewCaption: { color: c.textMuted, fontSize: 13, marginTop: 2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceAlt, borderRadius: 20, paddingLeft: 4, paddingRight: 10, paddingVertical: 4, maxWidth: '48%' },
    chipText: { color: c.text, fontSize: 13, flexShrink: 1 },
  });
}
