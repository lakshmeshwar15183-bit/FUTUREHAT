// Lumixo mobile — invite friends: shareable link + native share sheet. The
// link carries an optional ?ref=username. QR generation is deferred (needs a QR
// lib). Standalone.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import SafeScrollView from '../ui/SafeScrollView';
import * as Clipboard from 'expo-clipboard';

import { supabase } from '../lib/supabase';
import { getMyProfile, type Profile } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, STREAK_PITCH, inviteShareMessage } from '../branding';

const ORIGIN = 'https://futurehat-app.netlify.app';

export default function InviteScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { getMyProfile(supabase).then(setProfile).catch(() => {}); }, []);

  const link = profile?.username ? `${ORIGIN}/?ref=${encodeURIComponent(profile.username)}` : ORIGIN;
  const message = inviteShareMessage(link, APP_NAME);

  async function copy() { await Clipboard.setStringAsync(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  function share() { Share.share({ message }); }

  return (
    <SafeScrollView style={styles.container} contentContainerStyle={{ padding: spacing(4) }}>
      <Text style={styles.title}>Invite friends</Text>
      <Text style={styles.desc}>
        Keep a streak with someone you care about on {APP_NAME}.
      </Text>
      <Text style={styles.pitch}>{STREAK_PITCH}</Text>

      <View style={styles.linkBox}><Text style={styles.link} numberOfLines={1}>{link}</Text></View>
      <Pressable style={styles.btnSecondary} onPress={copy}><Text style={styles.btnSecondaryText}>{copied ? 'Copied ✓' : 'Copy link'}</Text></Pressable>
      <Pressable style={styles.btn} onPress={share}><Text style={styles.btnText}>Invite through apps</Text></Pressable>

      <Text style={styles.note}>
        Anyone with this link can create an account and start chatting — message daily to build a streak.
      </Text>
    </SafeScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    title: { color: colors.text, fontSize: font.title, fontWeight: '700', marginBottom: spacing(2) },
    desc: { color: colors.text, fontSize: font.body, fontWeight: '600', marginBottom: spacing(2) },
    pitch: { color: colors.textMuted, fontSize: font.small, lineHeight: 20, marginBottom: spacing(5) },
    linkBox: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), marginBottom: spacing(3) },
    link: { color: colors.text, fontSize: font.body },
    btnSecondary: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing(3.5), alignItems: 'center', marginBottom: spacing(3) },
    btnSecondaryText: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing(4), alignItems: 'center' },
    btnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
    note: { color: colors.textFaint, fontSize: font.small, textAlign: 'center', marginTop: spacing(4) },
  });
