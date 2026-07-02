// FUTUREHAT mobile — Help & Support: FAQ, contact, ticket submission and a
// "My tickets" list of previously submitted tickets. Covers the master-list
// Support & Trust items: help center, FAQ, contact support, bug report,
// feedback, ban appeal and grievance redressal.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { submitTicket, getMyTickets } from '../lib/shared';
import type { TicketKind, SupportTicket } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, APP_VERSION, CREDIT, SUPPORT_EMAIL, GRIEVANCE_OFFICER } from '../branding';

const FAQ: { q: string; a: string }[] = [
  { q: 'How do I start a chat?', a: 'Open the Chats tab and tap the compose button, then pick a contact or add one by username.' },
  { q: 'How do communities work?', a: 'Communities group people into channels. Create one from the Communities tab; each channel is a full chat with messages, media and calls.' },
  { q: 'Are my messages private?', a: `${APP_NAME} secures messages in transit and at rest. Group and community messages are visible to their members only.` },
  { q: 'How do I block or mute someone?', a: 'Open a chat or profile and choose Block or Mute. Blocked users can no longer message you; muted chats stop notifying you.' },
  { q: 'How do I get FUTUREHAT+?', a: `Go to Settings → ${APP_NAME}+ to subscribe. Premium unlocks themes, wallpapers, AI replies, scheduling and more.` },
  { q: 'I was banned — can I appeal?', a: 'Yes. Submit a ticket below with the “Ban appeal” type and describe your case. We review every appeal.' },
];

const KINDS: { kind: TicketKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: 'support', label: 'Support', icon: 'help-buoy-outline' },
  { kind: 'bug', label: 'Bug report', icon: 'bug-outline' },
  { kind: 'feedback', label: 'Feedback', icon: 'bulb-outline' },
  { kind: 'appeal', label: 'Ban appeal', icon: 'shield-outline' },
  { kind: 'grievance', label: 'Grievance', icon: 'document-text-outline' },
];

const STATUS_COLORS: Record<SupportTicket['status'], string> = {
  open: '#eab308',
  in_progress: '#3b82f6',
  resolved: '#22c55e',
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

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    const t = await getMyTickets(supabase);
    setTickets(t);
    setLoadingTickets(false);
  }, []);

  // Refresh tickets whenever the Tickets tab is shown (or the screen refocuses on it).
  useFocusEffect(
    useCallback(() => {
      if (tab === 'tickets') loadTickets();
    }, [tab, loadTickets]),
  );

  async function send() {
    if (!subject.trim() || !body.trim()) {
      Alert.alert('Add details', 'Please fill in both a subject and a description.');
      return;
    }
    setBusy(true);
    const deviceInfo = `${Platform.OS} ${String(Platform.Version)} · ${APP_NAME} v${APP_VERSION}`;
    const { error } = await submitTicket(supabase, kind, subject.trim(), body.trim(), { deviceInfo });
    setBusy(false);
    if (error) {
      Alert.alert('Could not send', error.message);
      return;
    }
    setSubject('');
    setBody('');
    Alert.alert('Thank you', 'Your ticket has been submitted. We’ll get back to you by email.');
    setTab('tickets');
    loadTickets();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, tab === 'help' && styles.tabOn]} onPress={() => setTab('help')}>
          <Text style={[styles.tabText, tab === 'help' && styles.tabTextOn]}>Get help</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'tickets' && styles.tabOn]} onPress={() => setTab('tickets')}>
          <Text style={[styles.tabText, tab === 'tickets' && styles.tabTextOn]}>My tickets</Text>
        </Pressable>
      </View>

      {tab === 'tickets' ? (
        loadingTickets ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : tickets.length === 0 ? (
          <Text style={styles.empty}>No tickets yet. Submit one from “Get help”.</Text>
        ) : (
          <View style={{ marginTop: spacing(3) }}>
            {tickets.map((t) => {
              const meta = KINDS.find((k) => k.kind === t.kind);
              return (
                <View key={t.id} style={styles.ticketCard}>
                  <View style={styles.ticketHead}>
                    <View style={styles.ticketKind}>
                      {meta && <Ionicons name={meta.icon} size={15} color={colors.textMuted} />}
                      <Text style={styles.ticketKindText}>{meta?.label ?? t.kind}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[t.status] + '22' }]}>
                      <Text style={[styles.statusText, { color: STATUS_COLORS[t.status] }]}>
                        {t.status.replace('_', ' ')}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.ticketSubject}>{t.subject}</Text>
                  <Text style={styles.ticketBody} numberOfLines={3}>{t.body}</Text>
                  <Text style={styles.ticketDate}>{new Date(t.created_at).toLocaleString()}</Text>
                </View>
              );
            })}
          </View>
        )
      ) : (
        <>
          <Text style={styles.section}>Frequently asked</Text>
          <View style={styles.card}>
            {FAQ.map((item, i) => (
              <View key={i} style={i > 0 ? styles.faqDivider : undefined}>
                <Pressable style={styles.faqQRow} onPress={() => setOpen(open === i ? null : i)}>
                  <Text style={styles.faqQ}>{item.q}</Text>
                  <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                </Pressable>
                {open === i && <Text style={styles.faqA}>{item.a}</Text>}
              </View>
            ))}
          </View>

          <Text style={styles.section}>Contact a human</Text>
          <Pressable style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
            <Ionicons name="mail-outline" size={20} color={colors.primary} />
            <Text style={styles.contactText}>{SUPPORT_EMAIL}</Text>
          </Pressable>

          <Text style={styles.section}>Submit a ticket</Text>
          <View style={styles.kindRow}>
            {KINDS.map((k) => (
              <Pressable
                key={k.kind}
                style={[styles.kindChip, kind === k.kind && styles.kindChipOn]}
                onPress={() => setKind(k.kind)}
              >
                <Ionicons name={k.icon} size={15} color={kind === k.kind ? '#fff' : colors.textMuted} />
                <Text style={[styles.kindLabel, kind === k.kind && styles.kindLabelOn]}>{k.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Subject"
            placeholderTextColor={colors.textFaint}
            value={subject}
            onChangeText={setSubject}
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
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Send ticket</Text>}
          </Pressable>

          <View style={styles.grievance}>
            <Text style={styles.grievanceTitle}>Grievance Redressal</Text>
            <Text style={styles.grievanceText}>
              Grievance Officer: {GRIEVANCE_OFFICER}{'\n'}
              For complaints under applicable IT rules, submit a “Grievance” ticket above or
              write to {SUPPORT_EMAIL}. We acknowledge within 48 hours and resolve within 15 days.
            </Text>
          </View>

          <Text style={styles.about}>{APP_NAME} v{APP_VERSION}</Text>
          <Text style={styles.credit}>{CREDIT}</Text>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing(4), paddingBottom: spacing(10) },
    tabs: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3, marginBottom: spacing(2) },
    tab: { flex: 1, alignItems: 'center', paddingVertical: spacing(2.5), borderRadius: radius.pill },
    tabOn: { backgroundColor: colors.primary },
    tabText: { color: colors.textMuted, fontSize: font.body, fontWeight: '700' },
    tabTextOn: { color: '#fff' },
    center: { paddingVertical: spacing(10), alignItems: 'center' },
    empty: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', marginTop: spacing(10) },
    ticketCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(4), marginBottom: spacing(3) },
    ticketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing(2) },
    ticketKind: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
    ticketKindText: { color: colors.textMuted, fontSize: font.small, fontWeight: '700' },
    statusPill: { borderRadius: radius.pill, paddingHorizontal: spacing(2.5), paddingVertical: 2 },
    statusText: { fontSize: font.tiny, fontWeight: '700', textTransform: 'capitalize' },
    ticketSubject: { color: colors.text, fontSize: font.body, fontWeight: '700', marginBottom: 2 },
    ticketBody: { color: colors.textMuted, fontSize: font.small, lineHeight: 19 },
    ticketDate: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing(2) },
    section: { color: colors.textMuted, fontSize: font.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing(5), marginBottom: spacing(2) },
    card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing(4) },
    faqDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    faqQRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing(3.5) },
    faqQ: { flex: 1, color: colors.text, fontSize: font.body, fontWeight: '600', marginRight: spacing(2) },
    faqA: { color: colors.textMuted, fontSize: font.small, lineHeight: 20, paddingBottom: spacing(3.5) },
    contactRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(4) },
    contactText: { color: colors.primary, fontSize: font.body, fontWeight: '600', marginLeft: spacing(3) },
    kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginBottom: spacing(3) },
    kindChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing(3), paddingVertical: spacing(2), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    kindChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    kindLabel: { color: colors.textMuted, fontSize: font.small, fontWeight: '600', marginLeft: spacing(1.5) },
    kindLabelOn: { color: '#fff' },
    input: { backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), fontSize: font.body, marginBottom: spacing(3) },
    multiline: { minHeight: 110, textAlignVertical: 'top' },
    submit: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center' },
    submitText: { color: '#fff', fontSize: font.heading, fontWeight: '700' },
    grievance: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(4), marginTop: spacing(5) },
    grievanceTitle: { color: colors.text, fontSize: font.body, fontWeight: '700', marginBottom: spacing(2) },
    grievanceText: { color: colors.textMuted, fontSize: font.small, lineHeight: 20 },
    about: { color: colors.textMuted, fontSize: font.small, textAlign: 'center', marginTop: spacing(6) },
    credit: { color: colors.textFaint, fontSize: font.small, textAlign: 'center', marginTop: spacing(1) },
  });
