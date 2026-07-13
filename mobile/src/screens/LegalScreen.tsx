// Lumixo mobile — Legal center: Terms, Privacy Policy, Community Guidelines.
// Original Lumixo content. Standalone.
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { CREDIT, APP_VERSION, SUPPORT_EMAIL, GRIEVANCE_TEAM } from '../branding';

type Tab = 'terms' | 'privacy' | 'guidelines';

export default function LegalScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('terms');

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['terms', 'privacy', 'guidelines'] as Tab[]).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'terms' ? 'Terms' : t === 'privacy' ? 'Privacy' : 'Guidelines'}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing(4) }}>
        {tab === 'terms' && (
          <>
            <Text style={styles.h}>Terms of Service</Text>
            <Text style={styles.p}>By using Lumixo you agree to use the service lawfully and respectfully. You are responsible for the content you send and for keeping your account secure.</Text>
            <Text style={styles.h2}>Acceptable use</Text>
            <Text style={styles.p}>Do not harass, defraud, distribute malware, infringe rights, or share illegal content. Accounts violating these terms may be suspended.</Text>
            <Text style={styles.h2}>Premium</Text>
            <Text style={styles.p}>Paid features are billed per your chosen plan. Cancelling stops future renewals; access continues until the period ends.</Text>
            <Text style={styles.h2}>Liability</Text>
            <Text style={styles.p}>Lumixo is provided “as is”. To the extent permitted by law, we are not liable for indirect or consequential damages.</Text>
          </>
        )}
        {tab === 'privacy' && (
          <>
            <Text style={styles.h}>Privacy Policy</Text>
            <Text style={styles.p}>
              Last updated for Play Store / Data Safety readiness. We collect only what is needed to run
              Lumixo as a messaging service.
            </Text>
            <Text style={styles.h2}>Data we process</Text>
            <Text style={styles.p}>
              Account: email, display name, optional phone, profile photo. Messages and media you send
              (including voice notes, images, video, documents). Call metadata (not call audio content
              beyond live transport). Device push tokens for notifications. Basic diagnostics (crash
              logs on-device; optional anonymous crash webhook if configured). Support tickets you submit.
            </Text>
            <Text style={styles.h2}>How we use data</Text>
            <Text style={styles.p}>
              Deliver messages and calls, show presence and read receipts as you configure, send push
              notifications, prevent abuse, and provide account recovery and support.
            </Text>
            <Text style={styles.h2}>Protection</Text>
            <Text style={styles.p}>
              Conversations are protected by row-level security — only participants can read them. Data
              is encrypted in transit (TLS) and at rest with our hosting provider. Media buckets use
              membership-scoped access where applicable.
            </Text>
            <Text style={styles.h2}>Your controls</Text>
            <Text style={styles.p}>
              Edit your profile, manage visibility, block users, mute chats, export your data (Settings →
              Account security → Data export), and request account deletion (Settings → Account security →
              Delete my account) with a recovery window before permanent removal.
            </Text>
            <Text style={styles.h2}>Account deletion</Text>
            <Text style={styles.p}>
              You may request deletion at any time. We schedule permanent removal after a short recovery
              period so you can cancel if the request was accidental. After permanent deletion, message
              and profile data associated with your account are removed subject to legal retention
              obligations (e.g. abuse investigations).
            </Text>
            <Text style={styles.h2}>Sharing</Text>
            <Text style={styles.p}>
              We do not sell your personal data. Limited processors (cloud hosting, push notification
              delivery, and — when enabled — payment processors) handle data only to provide the service.
            </Text>
            <Text style={styles.h2}>Contact</Text>
            <Text style={styles.p}>
              Privacy / support: {SUPPORT_EMAIL}. Grievance Team: {GRIEVANCE_TEAM}.
            </Text>
          </>
        )}
        {tab === 'guidelines' && (
          <>
            <Text style={styles.h}>Community Guidelines</Text>
            <Text style={styles.p}>Lumixo is for everyone. Keep it safe and welcoming:</Text>
            <Text style={styles.li}>• Be respectful — no harassment, hate speech, or threats.</Text>
            <Text style={styles.li}>• No spam, scams, or deceptive behaviour.</Text>
            <Text style={styles.li}>• No illegal content or promotion of violence.</Text>
            <Text style={styles.li}>• Respect privacy — don’t share others’ private information.</Text>
            <Text style={styles.li}>• Report abuse from any chat or profile.</Text>
            <Text style={styles.p}>Violations may lead to removal, suspension, or a ban. You can appeal via Help &amp; Support.</Text>
          </>
        )}
        <Text style={styles.foot}>Lumixo v{APP_VERSION} · {CREDIT}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    tabs: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    tab: { flex: 1, paddingVertical: spacing(3.5), alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabActive: { borderBottomColor: colors.primary },
    tabText: { color: colors.textMuted, fontWeight: '600', fontSize: font.small },
    tabTextActive: { color: colors.primary },
    h: { color: colors.text, fontSize: font.title, fontWeight: '700', marginBottom: spacing(2) },
    h2: { color: colors.primary, fontSize: font.heading, fontWeight: '600', marginTop: spacing(4), marginBottom: spacing(1) },
    p: { color: colors.text, fontSize: font.body, lineHeight: 22, marginBottom: spacing(2) },
    li: { color: colors.text, fontSize: font.body, lineHeight: 22, marginBottom: spacing(1) },
    foot: { color: colors.textFaint, fontSize: font.small, textAlign: 'center', marginTop: spacing(6), marginBottom: spacing(8) },
  });
