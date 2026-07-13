// Lumixo mobile — Settings tab. Profile header, grouped settings rows,
// owner credit footer, and sign out.
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { getCurrentUser, getMyProfile, signOut, getServerAdmin, getServerModerator, getServerOwner, getMailboxUnseenCount } from '../lib/shared';
import type { Profile } from '../lib/shared';
import { getCachedProfile, cacheProfile, getCache, setCache } from '../lib/localCache';
import { unregisterForPush } from '../lib/notifications';
import { usePremium } from '../premium';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, APP_VERSION, CREDIT } from '../branding';
import { LumixoCat } from '../components/LumixoCat';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Live premium from global context — updates instantly after purchase (no focus wait).
  const { isPremium: premium } = usePremium();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [owner, setOwner] = useState(false);
  const [moderator, setModerator] = useState(false);
  const [unseenMail, setUnseenMail] = useState(0);
  // Diagnostics is hidden from the main list; open by tapping the version 7×.
  const [diagTaps, setDiagTaps] = useState(0);

  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      (async () => {
        const user = await getCurrentUser(supabase); // local session — instant
        const id = user?.id ?? null;
        if (!alive) return;
        setUid(id);
        // Instant: cached profile + admin flags so the header + gated
        // rows render immediately, offline included. Premium is global (usePremium).
        if (id) { const cached = await getCachedProfile(id); if (alive && cached) setProfile(cached); }
        const [ca, co] = await Promise.all([
          getCache<boolean>('me:admin', false),
          getCache<boolean>('me:owner', false),
        ]);
        if (alive) { setAdmin(ca); setOwner(co); }
        // Background refresh + cache rewrite (kept even if offline throws).
        const p = await getMyProfile(supabase).catch(() => null);
        if (alive && p) { setProfile(p); cacheProfile(p); }
        const adm = await getServerAdmin(supabase).catch(() => false);
        if (alive) { setAdmin(adm); setCache('me:admin', adm); }
        // Admin Dashboard is OWNER-only (the single permanent owner). is_owner is
        // the immutable developer allowlist, independent of profiles.role.
        const own = await getServerOwner(supabase).catch(() => false);
        if (alive) { setOwner(own); setCache('me:owner', own); }
        const mod = await getServerModerator(supabase).catch(() => false);
        if (alive) setModerator(mod);
        const mail = await getMailboxUnseenCount(supabase).catch(() => 0);
        if (alive) setUnseenMail(mail);
      })();
      return () => { alive = false; };
    }, []),
  );

  async function doSignOut() {
    Alert.alert('Sign out', 'Sign out of this device only, or every device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'This device',
        style: 'destructive',
        // Drop this device's push token first so the next user on this phone doesn't
        // inherit the previous user's notifications, then sign out.
        onPress: async () => {
          await unregisterForPush().catch(() => {});
          await signOut(supabase);
        },
      },
      {
        text: 'All devices',
        style: 'destructive',
        onPress: async () => {
          await unregisterForPush().catch(() => {});
          await signOut(supabase, { allDevices: true });
        },
      },
    ]);
  }

  // Tab bar already clears the system nav; add extra scroll padding so the
  // footer mascot + version never collide with the last group or the tab bar.
  const footerPad = Math.max(spacing(10), insets.bottom + spacing(8));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: footerPad }}
      // Keep footer layout stable across font scale / short screens.
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
        style={styles.profileRow}
        onPress={() => uid && navigation.navigate('Profile', { userId: uid })}
      >
        <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={56} />
        <View style={styles.profileBody}>
          <View style={styles.nameRow}>
            <Text style={styles.profileName} numberOfLines={1}>{profile?.display_name ?? 'Your name'}</Text>
            {(premium || admin) && <Text style={styles.plusBadge}>+</Text>}
            {moderator && !admin && <Text style={styles.modBadge}>🛡 MOD</Text>}
            {admin && <Text style={styles.devBadge}>DEV</Text>}
          </View>
          {profile?.username ? <Text style={styles.handle} numberOfLines={1}>@{profile.username}</Text> : null}
          <Text style={styles.profileAbout} numberOfLines={1}>
            {admin
              ? `${APP_NAME}+ · Lifetime membership`
              : premium
              ? `${APP_NAME}+ member`
              : profile?.about || 'Hey there! I am using Lumixo.'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>

      <Pressable style={styles.premiumCard} onPress={() => navigation.navigate('Premium')}>
        <Ionicons name="diamond" size={22} color={colors.accentPlusText} />
        <View style={{ flex: 1, marginLeft: spacing(3) }}>
          <View style={styles.premiumTitleRow}>
            <Text style={styles.premiumTitle}>{APP_NAME}+{admin ? ' · Lifetime' : premium ? ' · Active' : ''}</Text>
          </View>
          <Text style={styles.premiumSub}>
            {admin
              ? 'Developer · lifetime Lumixo+ + Admin'
              : premium
              ? 'Thanks for supporting Lumixo'
              : 'Monthly ₹25 · Yearly ₹249 · Secure Razorpay'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
      </Pressable>

      {/* Primary — daily-use settings only (WhatsApp-class quiet list). */}
      <Group>
        <Row icon="person-outline" label="Account" onPress={() => navigation.navigate('EditProfile')} />
        <Row icon="key-outline" label="Account & security" onPress={() => navigation.navigate('AccountSecurity')} />
        <Row icon="lock-closed-outline" label="Privacy" onPress={() => navigation.navigate('Privacy')} />
        <Row icon="notifications-outline" label="Notifications" onPress={() => navigation.navigate('Notifications')} />
        <Row
          icon="shield-checkmark-outline"
          label="App lock"
          locked={!(premium || admin)}
          onPress={() =>
            premium || admin
              ? navigation.navigate('AppLockSetup')
              : Alert.alert(
                  'App lock',
                  'Require a PIN / Face ID when opening Lumixo. This is a Lumixo+ feature.',
                  [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'See Lumixo+', onPress: () => navigation.navigate('Premium') },
                  ],
                )
          }
        />
      </Group>

      <Group>
        <Row icon="color-palette-outline" label="Appearance" onPress={() => navigation.navigate('Appearance')} />
        <Row icon="chatbubble-ellipses-outline" label="Chats" onPress={() => navigation.navigate('ChatSettings')} />
        <Row icon="folder-outline" label="Storage & data" onPress={() => navigation.navigate('StorageData')} />
      </Group>

      <Group>
        <Row icon="star-outline" label="Starred messages" onPress={() => navigation.navigate('Starred')} />
        <Row icon="archive-outline" label="Archived chats" onPress={() => navigation.navigate('ArchivedChats')} />
        <Row icon="flame-outline" label="Streaks" onPress={() => navigation.navigate('Streaks')} />
        <Row icon="download-outline" label="Export my data" onPress={() => navigation.navigate('DataExport')} />
      </Group>

      <Group>
        <Row icon="mail-outline" label="Mailbox" badge={unseenMail} onPress={() => { setUnseenMail(0); navigation.navigate('Mailbox'); }} />
        {moderator && (
          <Row icon="shield-checkmark-outline" label="Moderator dashboard" onPress={() => navigation.navigate('Moderator')} />
        )}
        {owner && (
          <Row icon="shield-half-outline" label="Admin dashboard" onPress={() => navigation.navigate('Admin')} />
        )}
      </Group>

      <Group>
        <Row icon="share-social-outline" label="Invite a friend" onPress={() => navigation.navigate('Invite')} />
        <Row icon="help-circle-outline" label="Help & Support" onPress={() => navigation.navigate('HelpSupport')} />
        <Row icon="document-text-outline" label="Legal & policies" onPress={() => navigation.navigate('Legal')} />
        <Row icon="log-out-outline" label="Sign out" danger onPress={doSignOut} />
      </Group>

      {/* About footer — fixed vertical stack: mascot box → credit → version.
          Mascot is clipped to a fixed height so animations never overlap text. */}
      <View style={styles.aboutFooter} accessibilityRole="summary">
        <View style={styles.aboutMascot} pointerEvents="none">
          <LumixoCat mood="wave" size="xs" decorative />
        </View>
        <Text style={styles.credit} numberOfLines={2}>
          {CREDIT}
        </Text>
        <Text style={styles.mascotCredit} numberOfLines={1}>
          Mascot: Lumi
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${APP_NAME} version ${APP_VERSION}`}
          hitSlop={12}
          style={styles.versionHit}
          onPress={() => {
            const next = diagTaps + 1;
            if (next >= 7) {
              setDiagTaps(0);
              navigation.navigate('Diagnostics');
            } else {
              setDiagTaps(next);
            }
          }}
        >
          <Text style={styles.version} numberOfLines={1}>
            {APP_NAME} v{APP_VERSION}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        marginTop: spacing(2.5),
        borderRadius: radius.md,
        marginHorizontal: spacing(3),
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.isLight ? 'rgba(0,0,0,0.05)' : colors.border,
      }}
    >
      {children}
    </View>
  );
}

function Row({
  icon,
  label,
  onPress,
  danger,
  locked,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  locked?: boolean;
  badge?: number;
}) {
  const colors = useColors();
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        locked
          ? `${label}, Lumixo Plus required`
          : badge
            ? `${label}, ${badge} unread`
            : label
      }
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing(3.5),
          paddingVertical: 12,
          minHeight: 48,
        },
        pressed && { backgroundColor: colors.surfaceAlt },
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.textMuted} />
      <Text style={{ flex: 1, color: tint, fontSize: font.body, marginLeft: spacing(3.5), letterSpacing: -0.1 }}>
        {label}
      </Text>
      {badge ? (
        <View
          style={{
            minWidth: 18,
            height: 18,
            paddingHorizontal: 5,
            borderRadius: 9,
            backgroundColor: colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: spacing(2),
          }}
        >
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
      {locked && (
        <Ionicons name="lock-closed" size={13} color={colors.textFaint} style={{ marginRight: spacing(1.5) }} />
      )}
      {!danger && <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />}
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
      paddingHorizontal: spacing(3.5),
      paddingVertical: spacing(3.5),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    profileBody: { flex: 1, marginLeft: spacing(3.5), minWidth: 0 },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    profileName: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      flexShrink: 1,
      letterSpacing: -0.25,
    },
    handle: { color: colors.textMuted, fontSize: font.small, marginTop: 1 },
    profileAbout: { color: colors.textMuted, fontSize: font.small, marginTop: 2, lineHeight: 17 },
    plusBadge: {
      marginLeft: spacing(2),
      color: '#0b141a',
      backgroundColor: colors.accentPlus,
      fontSize: 10.5,
      fontWeight: '800',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    modBadge: {
      marginLeft: spacing(2),
      color: '#fff',
      backgroundColor: '#3b82f6',
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.2,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    devBadge: {
      marginLeft: spacing(2),
      color: '#0b141a',
      backgroundColor: '#f5b62a',
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.3,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    premiumTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    soonTag: {
      marginLeft: spacing(2),
      color: colors.isLight ? '#2952CC' : '#cfe9ff',
      backgroundColor: colors.isLight ? 'rgba(91,110,245,0.10)' : 'rgba(91,110,245,0.18)',
      borderColor: colors.isLight ? 'rgba(41,82,204,0.35)' : 'rgba(120,150,255,0.4)',
      borderWidth: StyleSheet.hairlineWidth,
      fontSize: 10.5,
      fontWeight: '700',
      paddingHorizontal: 7,
      paddingVertical: 1,
      borderRadius: 999,
      overflow: 'hidden',
    },
    premiumCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      marginTop: spacing(2.5),
      marginHorizontal: spacing(3),
      borderRadius: radius.md,
      paddingHorizontal: spacing(3.5),
      paddingVertical: spacing(3),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accentPlus + '55',
    },
    premiumTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700', letterSpacing: -0.15 },
    premiumSub: { color: colors.textMuted, fontSize: font.small, marginTop: 2, lineHeight: 17 },
    aboutFooter: {
      marginTop: spacing(6),
      paddingHorizontal: spacing(4),
      alignItems: 'center',
      gap: spacing(1.5),
    },
    aboutMascot: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 64,
      width: '100%',
      marginBottom: spacing(1),
      overflow: 'hidden',
    },
    credit: {
      color: colors.textMuted,
      textAlign: 'center',
      fontSize: font.small,
      fontWeight: '600',
      lineHeight: 18,
      maxWidth: 320,
    },
    mascotCredit: {
      color: colors.textFaint,
      textAlign: 'center',
      fontSize: font.tiny,
      lineHeight: 15,
    },
    versionHit: {
      minHeight: 32,
      justifyContent: 'center',
      paddingVertical: spacing(1),
      paddingHorizontal: spacing(3),
    },
    version: {
      color: colors.textFaint,
      textAlign: 'center',
      fontSize: font.tiny,
      lineHeight: 15,
    },
  });
