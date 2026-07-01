// FUTUREHAT mobile — Settings tab. Profile header, grouped settings rows,
// owner credit footer, and sign out.
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getCurrentUser, getMyProfile, signOut, getSubscription, isSubscriptionActive, getServerAdmin } from '../lib/shared';
import type { Profile } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, APP_VERSION, CREDIT } from '../branding';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [premium, setPremium] = useState(false);
  const [admin, setAdmin] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        const user = await getCurrentUser(supabase);
        setUid(user?.id ?? null);
        setProfile(await getMyProfile(supabase));
        setPremium(isSubscriptionActive(await getSubscription(supabase)));
        setAdmin(await getServerAdmin(supabase).catch(() => false));
      })();
    }, []),
  );

  async function doSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => signOut(supabase),
      },
    ]);
  }

  return (
    <ScrollView style={styles.container}>
      <Pressable
        style={styles.profileRow}
        onPress={() => uid && navigation.navigate('Profile', { userId: uid })}
      >
        <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={64} />
        <View style={styles.profileBody}>
          <View style={styles.nameRow}>
            <Text style={styles.profileName} numberOfLines={1}>{profile?.display_name ?? 'Your name'}</Text>
            {(premium || admin) && <Text style={styles.plusBadge}>+</Text>}
            {admin && <Text style={styles.devBadge}>DEV</Text>}
          </View>
          {profile?.username ? <Text style={styles.handle} numberOfLines={1}>@{profile.username}</Text> : null}
          <Text style={styles.profileAbout} numberOfLines={1}>
            {admin
              ? `${APP_NAME}+ · Lifetime membership`
              : premium
              ? `${APP_NAME}+ member`
              : profile?.about || 'Hey there! I am using FUTUREHAT.'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.textFaint} />
      </Pressable>

      <Pressable style={styles.premiumCard} onPress={() => navigation.navigate('Premium')}>
        <Ionicons name="diamond" size={26} color={colors.accentPlusText} />
        <View style={{ flex: 1, marginLeft: spacing(3) }}>
          <View style={styles.premiumTitleRow}>
            <Text style={styles.premiumTitle}>{APP_NAME}+{admin ? ' · Lifetime' : premium ? ' · Active' : ''}</Text>
            {!premium && !admin && <Text style={styles.soonTag}>Available soon</Text>}
          </View>
          <Text style={styles.premiumSub}>
            {admin
              ? 'Developer · lifetime FUTUREHAT+ + Admin'
              : premium
              ? 'Thanks for supporting FUTUREHAT'
              : 'Themes, AI, scheduling & more'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
      </Pressable>

      <Group>
        <Row icon="person-outline" label="Account" onPress={() => navigation.navigate('EditProfile')} />
        <Row icon="key-outline" label="Account & security" onPress={() => navigation.navigate('AccountSecurity')} />
        <Row icon="lock-closed-outline" label="Privacy" onPress={() => navigation.navigate('Privacy')} />
        <Row icon="shield-checkmark-outline" label="App lock" onPress={() => navigation.navigate('AppLockSetup')} />
        <Row icon="notifications-outline" label="Notifications" onPress={() => navigation.navigate('Notifications')} />
      </Group>

      <Group>
        <Row icon="color-palette-outline" label="Appearance & Themes" onPress={() => navigation.navigate('Appearance')} />
        <Row icon="chatbubble-ellipses-outline" label="Chats" onPress={() => navigation.navigate('ChatSettings')} />
        <Row icon="folder-outline" label="Storage & Data" onPress={() => navigation.navigate('StorageData')} />
        <Row icon="archive-outline" label="Archived chats" onPress={() => navigation.navigate('ArchivedChats')} />
        <Row icon="download-outline" label="Export my data" onPress={() => navigation.navigate('DataExport')} />
      </Group>

      <Group>
        <Row icon="share-social-outline" label="Invite a friend" onPress={() => navigation.navigate('Invite')} />
        <Row icon="help-circle-outline" label="Help & Support" onPress={() => navigation.navigate('HelpSupport')} />
        <Row icon="document-text-outline" label="Legal & policies" onPress={() => navigation.navigate('Legal')} />
        <Row icon="pulse-outline" label="Diagnostics" onPress={() => navigation.navigate('Diagnostics')} />
        <Row icon="log-out-outline" label="Sign out" danger onPress={doSignOut} />
      </Group>

      <Text style={styles.credit}>{CREDIT}</Text>
      <Text style={styles.version}>{APP_NAME} v{APP_VERSION}</Text>
    </ScrollView>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ backgroundColor: colors.surface, marginTop: spacing(3), borderRadius: radius.md, marginHorizontal: spacing(3), overflow: 'hidden' }}>
      {children}
    </View>
  );
}

function Row({
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
    <Pressable
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5) },
        pressed && { backgroundColor: colors.surfaceAlt },
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.textMuted} />
      <Text style={{ flex: 1, color: tint, fontSize: font.body, marginLeft: spacing(4) }}>{label}</Text>
      {!danger && <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />}
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      padding: spacing(4),
    },
    profileBody: { flex: 1, marginLeft: spacing(4) },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    profileName: { color: colors.text, fontSize: font.title, fontWeight: '600', flexShrink: 1 },
    handle: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
    profileAbout: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    plusBadge: {
      marginLeft: spacing(2),
      color: '#0b141a',
      backgroundColor: colors.accentPlus,
      fontSize: font.tiny,
      fontWeight: '800',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 5,
      overflow: 'hidden',
    },
    devBadge: {
      marginLeft: spacing(2),
      color: '#0b141a',
      backgroundColor: '#f5b62a',
      fontSize: font.tiny,
      fontWeight: '800',
      letterSpacing: 0.5,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 5,
      overflow: 'hidden',
    },
    premiumTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    soonTag: {
      marginLeft: spacing(2),
      // Theme-aware: light blue on dark, but a readable dark blue on light (the
      // old light-blue text washed out on the near-white light-mode surface).
      color: colors.isLight ? '#2952CC' : '#cfe9ff',
      backgroundColor: colors.isLight ? 'rgba(91,110,245,0.10)' : 'rgba(91,110,245,0.18)',
      borderColor: colors.isLight ? 'rgba(41,82,204,0.35)' : 'rgba(120,150,255,0.4)',
      borderWidth: 1,
      fontSize: font.tiny,
      fontWeight: '700',
      paddingHorizontal: 8,
      paddingVertical: 1,
      borderRadius: 999,
      overflow: 'hidden',
    },
    premiumCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      marginTop: spacing(3),
      marginHorizontal: spacing(3),
      borderRadius: radius.md,
      padding: spacing(4),
      borderWidth: 1,
      borderColor: colors.accentPlus + '44',
    },
    premiumTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    premiumSub: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    credit: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(8), fontSize: font.small, fontWeight: '600' },
    version: { color: colors.textFaint, textAlign: 'center', marginTop: 4, marginBottom: spacing(8), fontSize: font.tiny },
  });
