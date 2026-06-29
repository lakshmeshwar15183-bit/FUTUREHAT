// FUTUREHAT mobile — Account & Security: email/password/phone, two-step
// verification (Supabase TOTP), login history, and account deletion with a
// 30-day recovery window. Standalone; persists via accountApi + Supabase auth.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '../lib/supabase';
import {
  changeEmail, changePassword, requestAccountDeletion, cancelAccountDeletion,
  getDeletionRequest, getSecurityEvents, type DeletionRequest, type SecurityEvent,
} from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';

export default function AccountSecurityScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [deletion, setDeletion] = useState<DeletionRequest | null>(null);
  const [twofaOn, setTwofaOn] = useState(false);

  useEffect(() => {
    getSecurityEvents(supabase).then(setEvents).catch(() => {});
    getDeletionRequest(supabase).then(setDeletion).catch(() => {});
    (async () => {
      try {
        const { data } = await (supabase.auth as any).mfa.listFactors();
        setTwofaOn(!!data?.totp?.find((f: any) => f.status === 'verified'));
      } catch { /* MFA may be off */ }
    })();
  }, []);

  async function saveEmail() {
    if (!email.trim()) return;
    const { error } = await changeEmail(supabase, email.trim());
    Alert.alert(error ? 'Error' : 'Check your inbox', error ? error.message : 'Confirmation sent to your new email.');
    if (!error) setEmail('');
  }
  async function savePassword() {
    if (password.length < 8) return Alert.alert('Weak password', 'Use at least 8 characters.');
    const { error } = await changePassword(supabase, password);
    Alert.alert(error ? 'Error' : 'Done', error ? error.message : 'Password updated.');
    if (!error) setPassword('');
  }
  async function savePhone() {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return;
    const { error } = await supabase.from('profiles').update({ phone: phone.trim() || null }).eq('id', u.user.id);
    Alert.alert(error ? 'Error' : 'Done', error ? 'Could not update phone.' : 'Phone updated.');
  }

  function confirmDelete() {
    Alert.alert('Delete account', 'You will have 30 days to cancel before data is permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Request deletion', style: 'destructive', onPress: async () => {
          const { request, error } = await requestAccountDeletion(supabase);
          if (error) return Alert.alert('Error', error.message);
          setDeletion(request);
        },
      },
    ]);
  }
  async function undoDelete() {
    const { error } = await cancelAccountDeletion(supabase);
    if (!error) setDeletion(null);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionLabel}>EMAIL</Text>
      <View style={styles.group}>
        <TextInput style={styles.input} placeholder="New email" placeholderTextColor={colors.textFaint} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      </View>
      <Pressable style={styles.btnPrimary} onPress={saveEmail}><Text style={styles.btnPrimaryText}>Update email</Text></Pressable>

      <Text style={styles.sectionLabel}>PASSWORD</Text>
      <View style={styles.group}>
        <TextInput style={styles.input} placeholder="New password (min 8)" placeholderTextColor={colors.textFaint} secureTextEntry value={password} onChangeText={setPassword} />
      </View>
      <Pressable style={styles.btnPrimary} onPress={savePassword}><Text style={styles.btnPrimaryText}>Change password</Text></Pressable>

      <Text style={styles.sectionLabel}>PHONE</Text>
      <View style={styles.group}>
        <TextInput style={styles.input} placeholder="+countrycode number" placeholderTextColor={colors.textFaint} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      </View>
      <Pressable style={styles.btn} onPress={savePhone}><Text style={styles.btnText}>Save phone</Text></Pressable>

      <Text style={styles.sectionLabel}>TWO-STEP VERIFICATION</Text>
      <View style={styles.group}>
        <Text style={styles.note}>
          {twofaOn
            ? '✅ Two-step verification is on for your account.'
            : 'Set up two-step verification from the FUTUREHAT web app — it then protects every device you sign in on.'}
        </Text>
      </View>

      <Text style={styles.sectionLabel}>LOGIN & SECURITY HISTORY</Text>
      <View style={styles.group}>
        {events.length === 0 ? <Text style={styles.empty}>No recent security events.</Text> : events.slice(0, 10).map((e) => (
          <View key={e.id} style={styles.histRow}>
            <Text style={styles.histKind}>{e.kind.replace('_', ' ')}</Text>
            <Text style={styles.histMeta}>{e.user_agent || 'Unknown device'} · {new Date(e.created_at).toLocaleString()}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>DANGER ZONE</Text>
      {deletion ? (
        <>
          <Text style={styles.note}>⚠️ Deletion scheduled for {new Date(deletion.purge_after).toLocaleDateString()}.</Text>
          <Pressable style={styles.btnPrimary} onPress={undoDelete}><Text style={styles.btnPrimaryText}>Cancel deletion</Text></Pressable>
        </>
      ) : (
        <Pressable style={styles.btnDanger} onPress={confirmDelete}><Text style={styles.btnDangerText}>Delete my account</Text></Pressable>
      )}
      <View style={{ height: spacing(10) }} />
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: { color: colors.textMuted, fontSize: font.tiny, fontWeight: '700', marginTop: spacing(5), marginBottom: spacing(2), marginHorizontal: spacing(4), letterSpacing: 0.5 },
    group: { backgroundColor: colors.surface, marginHorizontal: spacing(3), borderRadius: radius.md, overflow: 'hidden' },
    input: { color: colors.text, fontSize: font.body, paddingHorizontal: spacing(4), paddingVertical: spacing(3.5) },
    btn: { backgroundColor: colors.surfaceAlt, marginHorizontal: spacing(3), marginTop: spacing(2), borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center' },
    btnText: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    btnPrimary: { backgroundColor: colors.primary, marginHorizontal: spacing(3), marginTop: spacing(2), borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center' },
    btnPrimaryText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    btnDanger: { backgroundColor: colors.danger + '22', marginHorizontal: spacing(3), marginTop: spacing(2), borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center' },
    btnDangerText: { color: colors.danger, fontSize: font.body, fontWeight: '700' },
    empty: { color: colors.textMuted, fontSize: font.small, padding: spacing(4) },
    histRow: { paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    histKind: { color: colors.text, fontSize: font.body, textTransform: 'capitalize' },
    histMeta: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    note: { color: colors.textMuted, fontSize: font.small, marginHorizontal: spacing(4), marginTop: spacing(2) },
  });
