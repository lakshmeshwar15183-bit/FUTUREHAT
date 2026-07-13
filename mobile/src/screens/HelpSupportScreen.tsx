// Lumixo mobile — production Help & Support center.
// FAQ, contact (mailto), tickets with public IDs, status, in-app replies, grievance notice.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import {
  submitTicket,
  getMyTickets,
  getTicketReplies,
  replyToTicket,
  formatTicketId,
} from '../lib/shared';
import type { TicketKind, SupportTicket, SupportTicketReply } from '../lib/shared';
import { useColors, spacing, radius, font, elevation, type Palette } from '../theme';
import {
  APP_NAME,
  APP_VERSION,
  CREDIT,
  SUPPORT_EMAIL,
  GRIEVANCE_TEAM,
  supportMailto,
} from '../branding';
import { LumixoCat } from '../components/LumixoCat';
import { Alert } from '../ui/dialog';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I start a chat?',
    a: 'Open the Chats tab and tap the compose button, then pick a contact or add one by username.',
  },
  {
    q: 'How do communities work?',
    a: 'Communities group people into channels. Create one from the Communities tab; each channel is a full chat with messages, media and calls.',
  },
  {
    q: 'Are my messages private?',
    a: `${APP_NAME} secures messages in transit and at rest. Group and community messages are visible to their members only.`,
  },
  {
    q: 'How do I block or mute someone?',
    a: 'Open a chat or profile and choose Block or Mute. Blocked users can no longer message you; muted chats stop notifying you.',
  },
  {
    q: `How do I get ${APP_NAME}+?`,
    a: `Go to Settings → ${APP_NAME}+ to subscribe. Premium unlocks themes, wallpapers, scheduling, app lock, ghost mode and more.`,
  },
  {
    q: 'I was banned — can I appeal?',
    a: 'Yes. Submit a ticket below with the “Ban appeal” type and describe your case. We review every appeal.',
  },
];

const KINDS: { kind: TicketKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: 'support', label: 'Support', icon: 'help-buoy-outline' },
  { kind: 'bug', label: 'Bug', icon: 'bug-outline' },
  { kind: 'feedback', label: 'Feedback', icon: 'bulb-outline' },
  { kind: 'appeal', label: 'Appeal', icon: 'shield-outline' },
  { kind: 'grievance', label: 'Grievance', icon: 'document-text-outline' },
];

const STATUS_COLORS: Record<SupportTicket['status'], string> = {
  open: '#eab308',
  in_progress: '#3b82f6',
  resolved: '#22c55e',
};

const STATUS_LABEL: Record<SupportTicket['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

export default function HelpSupportScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [tab, setTab] = useState<'help' | 'tickets'>('help');
  const [open, setOpen] = useState<number | null>(null);
  const [kind, setKind] = useState<TicketKind>('support');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [replies, setReplies] = useState<SupportTicketReply[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const t = await getMyTickets(supabase);
      setTickets(t);
    } finally {
      setLoadingTickets(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (tab === 'tickets') void loadTickets();
    }, [tab, loadTickets]),
  );

  async function openTicket(t: SupportTicket) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelected(t);
    setLoadingReplies(true);
    setReplyText('');
    try {
      const r = await getTicketReplies(supabase, t.id);
      setReplies(r);
    } catch {
      setReplies([]);
    } finally {
      setLoadingReplies(false);
    }
  }

  async function sendReply() {
    if (!selected || !replyText.trim()) return;
    setReplyBusy(true);
    const { reply, error } = await replyToTicket(supabase, selected.id, replyText.trim());
    setReplyBusy(false);
    if (error) {
      Alert.alert('Could not send', error.message);
      return;
    }
    if (reply) setReplies((prev) => [...prev, reply]);
    setReplyText('');
  }

  function emailSupport() {
    void Linking.openURL(supportMailto('Lumixo Support Request'));
  }

  async function send() {
    if (!subject.trim() || !body.trim()) {
      Alert.alert('Add details', 'Please fill in both a subject and a description.');
      return;
    }
    setBusy(true);
    const deviceInfo = `${Platform.OS} ${String(Platform.Version)} · ${APP_NAME} v${APP_VERSION}`;
    const { ticket, error } = await submitTicket(supabase, kind, subject.trim(), body.trim(), {
      deviceInfo,
    });
    setBusy(false);
    if (error || !ticket) {
      Alert.alert('Could not send', error?.message || 'Please try again.');
      return;
    }
    const id = formatTicketId(ticket);
    setSubject('');
    setBody('');
    Alert.alert(
      'Ticket submitted',
      `Your ticket ${id} has been received.\n\nStatus: Open\n\nWe’ll update you in My Tickets. You can also email ${SUPPORT_EMAIL} anytime.`,
      [
        {
          text: 'Email support',
          onPress: () => {
            void Linking.openURL(
              supportMailto(
                `Lumixo Support Request — ${id}`,
                `Ticket ID: ${id}\n\n(Optional notes for our team)\n`,
              ),
            );
          },
        },
        {
          text: 'View tickets',
          style: 'default',
          onPress: () => {
            setTab('tickets');
            void loadTickets();
          },
        },
      ],
    );
    setTab('tickets');
    void loadTickets();
  }

  // ── Ticket detail ─────────────────────────────────────────────────────────
  if (selected) {
    const tid = formatTicketId(selected);
    const meta = KINDS.find((k) => k.kind === selected.kind);
    return (
      <View style={styles.container}>
        <View style={styles.detailHeader}>
          <Pressable
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setSelected(null);
            }}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
            <Text style={styles.backText}>My tickets</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.ticketCard}>
            <View style={styles.ticketHead}>
              <Text style={styles.ticketId}>{tid}</Text>
              <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[selected.status] + '22' }]}>
                <Text style={[styles.statusText, { color: STATUS_COLORS[selected.status] }]}>
                  {STATUS_LABEL[selected.status]}
                </Text>
              </View>
            </View>
            <Text style={styles.ticketKindText}>{meta?.label ?? selected.kind}</Text>
            <Text style={styles.ticketSubject}>{selected.subject}</Text>
            <Text style={styles.ticketBody}>{selected.body}</Text>
            <Text style={styles.ticketDate}>{new Date(selected.created_at).toLocaleString()}</Text>
          </View>

          <Text style={styles.section}>Conversation</Text>
          {loadingReplies ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing(4) }} />
          ) : (
            <View style={styles.thread}>
              <View style={[styles.bubble, styles.bubbleUser]}>
                <Text style={styles.bubbleMeta}>You · original</Text>
                <Text style={styles.bubbleText}>{selected.body}</Text>
              </View>
              {replies.map((r) => (
                <View
                  key={r.id}
                  style={[styles.bubble, r.is_staff ? styles.bubbleStaff : styles.bubbleUser]}
                >
                  <Text style={styles.bubbleMeta}>
                    {r.is_staff ? 'Lumixo Support' : 'You'} ·{' '}
                    {new Date(r.created_at).toLocaleString()}
                  </Text>
                  <Text style={styles.bubbleText}>{r.body}</Text>
                </View>
              ))}
              {replies.length === 0 && (
                <Text style={styles.threadHint}>
                  No replies yet. Add an update below — our team responds here.
                </Text>
              )}
            </View>
          )}

          {selected.status !== 'resolved' && (
            <>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Write a reply…"
                placeholderTextColor={colors.textFaint}
                value={replyText}
                onChangeText={setReplyText}
                multiline
              />
              <Pressable
                style={[styles.submit, !replyText.trim() && styles.submitDisabled]}
                onPress={sendReply}
                disabled={replyBusy || !replyText.trim()}
              >
                {replyBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Send reply</Text>
                )}
              </Pressable>
            </>
          )}

          <Pressable style={styles.contactRow} onPress={emailSupport}>
            <Ionicons name="mail-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: spacing(3) }}>
              <Text style={styles.contactText}>{SUPPORT_EMAIL}</Text>
              <Text style={styles.contactSub}>Opens your email app · Ticket {tid}</Text>
            </View>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="headset-outline" size={28} color={colors.primary} />
        </View>
        <Text style={styles.heroTitle}>Help & Support</Text>
        <Text style={styles.heroSub}>We’re here for you — FAQs, tickets, and the Grievance Team.</Text>
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === 'help' && styles.tabOn]}
          onPress={() => setTab('help')}
        >
          <Text style={[styles.tabText, tab === 'help' && styles.tabTextOn]}>Get help</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'tickets' && styles.tabOn]}
          onPress={() => setTab('tickets')}
        >
          <Text style={[styles.tabText, tab === 'tickets' && styles.tabTextOn]}>My tickets</Text>
        </Pressable>
      </View>

      {tab === 'tickets' ? (
        loadingTickets ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : tickets.length === 0 ? (
          <View style={styles.emptyWrap}>
            <LumixoCat mood="sleeping" size="md" decorative />
            <Text style={styles.empty}>No tickets yet. Submit one from “Get help”.</Text>
          </View>
        ) : (
          <View style={{ marginTop: spacing(3) }}>
            {tickets.map((t) => {
              const meta = KINDS.find((k) => k.kind === t.kind);
              const tid = formatTicketId(t);
              return (
                <Pressable key={t.id} style={styles.ticketCard} onPress={() => openTicket(t)}>
                  <View style={styles.ticketHead}>
                    <Text style={styles.ticketId}>{tid}</Text>
                    <View
                      style={[styles.statusPill, { backgroundColor: STATUS_COLORS[t.status] + '22' }]}
                    >
                      <Text style={[styles.statusText, { color: STATUS_COLORS[t.status] }]}>
                        {STATUS_LABEL[t.status]}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.ticketKind}>
                    {meta && <Ionicons name={meta.icon} size={15} color={colors.textMuted} />}
                    <Text style={styles.ticketKindText}>{meta?.label ?? t.kind}</Text>
                  </View>
                  <Text style={styles.ticketSubject}>{t.subject}</Text>
                  <Text style={styles.ticketBody} numberOfLines={2}>
                    {t.body}
                  </Text>
                  <View style={styles.ticketFoot}>
                    <Text style={styles.ticketDate}>{new Date(t.created_at).toLocaleString()}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )
      ) : (
        <>
          <Text style={styles.section}>Frequently asked</Text>
          <View style={[styles.card, colors.isLight && elevation.cardLight]}>
            {FAQ.map((item, i) => (
              <View key={i} style={i > 0 ? styles.faqDivider : undefined}>
                <Pressable
                  style={styles.faqQRow}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setOpen(open === i ? null : i);
                  }}
                >
                  <Text style={styles.faqQ}>{item.q}</Text>
                  <Ionicons
                    name={open === i ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textMuted}
                  />
                </Pressable>
                {open === i && <Text style={styles.faqA}>{item.a}</Text>}
              </View>
            ))}
          </View>

          <Text style={styles.section}>Contact us</Text>
          <Pressable style={[styles.contactRow, colors.isLight && elevation.cardLight]} onPress={emailSupport}>
            <View style={styles.contactIcon}>
              <Ionicons name="mail-outline" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactLabel}>Email support</Text>
              <Text style={styles.contactText}>{SUPPORT_EMAIL}</Text>
              <Text style={styles.contactSub}>Opens your email app with subject pre-filled</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textFaint} />
          </Pressable>

          <Text style={styles.section}>Submit a ticket</Text>
          <View style={styles.kindRow}>
            {KINDS.map((k) => (
              <Pressable
                key={k.kind}
                style={[styles.kindChip, kind === k.kind && styles.kindChipOn]}
                onPress={() => setKind(k.kind)}
              >
                <Ionicons
                  name={k.icon}
                  size={15}
                  color={kind === k.kind ? '#fff' : colors.textMuted}
                />
                <Text style={[styles.kindLabel, kind === k.kind && styles.kindLabelOn]}>
                  {k.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Subject"
            placeholderTextColor={colors.textFaint}
            value={subject}
            onChangeText={setSubject}
            maxLength={120}
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Describe the issue, idea or request…"
            placeholderTextColor={colors.textFaint}
            value={body}
            onChangeText={setBody}
            multiline
          />
          <Pressable style={styles.submit} onPress={send} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Submit ticket</Text>
            )}
          </Pressable>

          <View style={styles.grievance}>
            <View style={styles.grievanceHead}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
              <Text style={styles.grievanceTitle}>Grievance notice</Text>
            </View>
            <Text style={styles.grievanceTeam}>{GRIEVANCE_TEAM}</Text>
            <Text style={styles.grievanceText}>
              For complaints under applicable IT Rules, submit a “Grievance” ticket above or email{' '}
              {SUPPORT_EMAIL}.
              {'\n\n'}
              Our Grievance Team acknowledges complaints within 48 hours and aims to resolve them
              within 15 days, subject to applicable law.
            </Text>
          </View>

          <Text style={styles.about}>
            {APP_NAME} v{APP_VERSION}
          </Text>
          <Text style={styles.credit}>{CREDIT}</Text>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing(4), paddingBottom: spacing(12) },
    hero: { alignItems: 'center', marginBottom: spacing(4), paddingTop: spacing(2) },
    heroIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary + '18',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(2),
    },
    heroTitle: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
    heroSub: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(1),
      lineHeight: 18,
      paddingHorizontal: spacing(4),
    },
    tabs: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.pill,
      padding: 3,
      marginBottom: spacing(2),
    },
    tab: { flex: 1, alignItems: 'center', paddingVertical: spacing(2.5), borderRadius: radius.pill },
    tabOn: { backgroundColor: colors.primary },
    tabText: { color: colors.textMuted, fontSize: font.body, fontWeight: '700' },
    tabTextOn: { color: '#fff' },
    center: { paddingVertical: spacing(10), alignItems: 'center' },
    emptyWrap: { alignItems: 'center', paddingVertical: spacing(8), paddingHorizontal: spacing(4) },
    empty: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', marginTop: spacing(3) },
    ticketCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing(4),
      marginBottom: spacing(3),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    ticketHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing(1.5),
    },
    ticketId: {
      color: colors.primary,
      fontSize: font.small,
      fontWeight: '800',
      letterSpacing: 0.3,
    },
    ticketKind: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginBottom: 4 },
    ticketKindText: { color: colors.textMuted, fontSize: font.small, fontWeight: '700' },
    statusPill: { borderRadius: radius.pill, paddingHorizontal: spacing(2.5), paddingVertical: 3 },
    statusText: { fontSize: font.tiny, fontWeight: '700', textTransform: 'capitalize' },
    ticketSubject: { color: colors.text, fontSize: font.body, fontWeight: '700', marginBottom: 4 },
    ticketBody: { color: colors.textMuted, fontSize: font.small, lineHeight: 19 },
    ticketDate: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing(2) },
    ticketFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing(2),
    },
    section: {
      color: colors.textMuted,
      fontSize: font.tiny,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: spacing(5),
      marginBottom: spacing(2),
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingHorizontal: spacing(4),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    faqDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    faqQRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing(3.5),
      minHeight: 48,
    },
    faqQ: {
      flex: 1,
      color: colors.text,
      fontSize: font.body,
      fontWeight: '600',
      marginRight: spacing(2),
    },
    faqA: {
      color: colors.textMuted,
      fontSize: font.small,
      lineHeight: 20,
      paddingBottom: spacing(3.5),
    },
    contactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing(4),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginTop: spacing(1),
    },
    contactIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary + '14',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing(3),
    },
    contactLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '600' },
    contactText: { color: colors.primary, fontSize: font.body, fontWeight: '700', marginTop: 1 },
    contactSub: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
    kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginBottom: spacing(3) },
    kindChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      paddingHorizontal: spacing(3),
      paddingVertical: spacing(2),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      minHeight: 36,
    },
    kindChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    kindLabel: {
      color: colors.textMuted,
      fontSize: font.small,
      fontWeight: '600',
      marginLeft: spacing(1.5),
    },
    kindLabelOn: { color: '#fff' },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      fontSize: font.body,
      marginBottom: spacing(3),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    multiline: { minHeight: 120, textAlignVertical: 'top' },
    submit: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing(3.5),
      alignItems: 'center',
      minHeight: 48,
      justifyContent: 'center',
    },
    submitDisabled: { opacity: 0.45 },
    submitText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
    grievance: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing(4),
      marginTop: spacing(5),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    grievanceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(1) },
    grievanceTitle: { color: colors.text, fontSize: font.body, fontWeight: '700' },
    grievanceTeam: {
      color: colors.primary,
      fontSize: font.small,
      fontWeight: '700',
      marginBottom: spacing(2),
    },
    grievanceText: { color: colors.textMuted, fontSize: font.small, lineHeight: 20 },
    about: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(6),
    },
    credit: {
      color: colors.textFaint,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(1),
      marginBottom: spacing(2),
    },
    detailHeader: {
      paddingHorizontal: spacing(2),
      paddingVertical: spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', padding: spacing(2), minHeight: 44 },
    backText: { color: colors.primary, fontSize: font.body, fontWeight: '600' },
    thread: { gap: spacing(2), marginBottom: spacing(3) },
    threadHint: { color: colors.textFaint, fontSize: font.small, textAlign: 'center', padding: spacing(3) },
    bubble: {
      borderRadius: radius.md,
      padding: spacing(3),
      maxWidth: '92%',
    },
    bubbleUser: {
      alignSelf: 'flex-end',
      backgroundColor: colors.isLight ? '#D9FDD3' : colors.bubbleOut,
    },
    bubbleStaff: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    bubbleMeta: { color: colors.textFaint, fontSize: font.tiny, marginBottom: 4, fontWeight: '600' },
    bubbleText: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  });
