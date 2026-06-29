// FUTUREHAT mobile — Help & Support: FAQ, contact, and ticket submission.
// Covers the master-list Support & Trust items: help center, FAQ, contact
// support, bug report, feedback, ban appeal and grievance redressal.
import React, { useMemo, useState } from 'react';
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

import { supabase } from '../lib/supabase';
import { submitTicket } from '../lib/shared';
import type { TicketKind } from '../lib/shared';
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

export default function HelpSupportScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [open, setOpen] = useState<number | null>(null);
  const [kind, setKind] = useState<TicketKind>('support');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

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
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing(4), paddingBottom: spacing(10) },
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
