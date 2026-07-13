// Lumixo mobile — Settings hub (Material 3–inspired, flagship polish).
// Instant cache-first profile, global search, grouped destinations.
// All existing features preserved; no API rewrites.
import React, { useCallback, useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View
} from 'react-native';
import SafeScrollView from '../ui/SafeScrollView';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import {
  getCurrentUser,
  getMyProfile,
  signOut,
  getServerAdmin,
  getServerModerator,
  getServerOwner,
  getMailboxUnseenCount,
} from '../lib/shared';
import type { Profile } from '../lib/shared';
import { getCachedProfile, cacheProfile, getCache, setCache } from '../lib/localCache';
import { unregisterForPush } from '../lib/notifications';
import { usePremium } from '../premium';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { APP_NAME, APP_VERSION, CREDIT } from '../branding';
import { LumixoCat } from '../components/LumixoCat';
import ProfileAvatar from '../components/ProfileAvatar';
import {
  SettingsIconBadge,
  SettingsRow,
  SettingsSearchBar,
  SettingsSection,
} from '../ui/settingsKit';
import type { RootStackParamList } from '../navigation/types';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Dest =
  | { kind: 'nav'; route: keyof RootStackParamList; params?: any }
  | { kind: 'action'; action: 'signOut' | 'appLock' | 'premium' | 'diagnostics' };

interface SettingItem {
  id: string;
  section: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  subtitle?: string;
  keywords: string;
  dest: Dest;
  danger?: boolean;
  premium?: boolean;
  ownerOnly?: boolean;
  modOnly?: boolean;
  badge?: 'mail';
}

const ICON = {
  account: '#5B6EF5',
  privacy: '#00A884',
  notif: '#F7A948',
  chats: '#00A884',
  storage: '#3b82f6',
  calls: '#22c55e',
  help: '#8b5cf6',
  about: '#8696A0',
  danger: '#F15C6D',
  plus: '#E5A400',
} as const;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isPremium: premium } = usePremium();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [owner, setOwner] = useState(false);
  const [moderator, setModerator] = useState(false);
  const [unseenMail, setUnseenMail] = useState(0);
  const [diagTaps, setDiagTaps] = useState(0);
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const user = await getCurrentUser(supabase);
        const id = user?.id ?? null;
        if (!alive) return;
        setUid(id);
        if (id) {
          const cached = await getCachedProfile(id);
          if (alive && cached) setProfile(cached);
        }
        const [ca, co] = await Promise.all([
          getCache<boolean>('me:admin', false),
          getCache<boolean>('me:owner', false),
        ]);
        if (alive) {
          setAdmin(ca);
          setOwner(co);
        }
        const p = await getMyProfile(supabase).catch(() => null);
        if (alive && p) {
          setProfile(p);
          cacheProfile(p);
        }
        const adm = await getServerAdmin(supabase).catch(() => false);
        if (alive) {
          setAdmin(adm);
          setCache('me:admin', adm);
        }
        const own = await getServerOwner(supabase).catch(() => false);
        if (alive) {
          setOwner(own);
          setCache('me:owner', own);
        }
        const mod = await getServerModerator(supabase).catch(() => false);
        if (alive) setModerator(mod);
        const mail = await getMailboxUnseenCount(supabase).catch(() => 0);
        if (alive) setUnseenMail(mail);
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  async function doSignOut() {
    Alert.alert('Sign out', 'Sign out of this device only, or every device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'This device',
        style: 'destructive',
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

  function goAppLock() {
    if (premium || admin) {
      navigation.navigate('AppLockSetup');
      return;
    }
    Alert.alert(
      'App lock',
      'Require a PIN / Face ID when opening Lumixo. This is a Lumixo+ feature.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'See Lumixo+', onPress: () => navigation.navigate('Premium') },
      ],
    );
  }

  function runDest(dest: Dest) {
    if (dest.kind === 'nav') {
      // Dynamic catalog routes — all keys are RootStackParamList destinations.
      (navigation as any).navigate(dest.route, dest.params);
      return;
    }
    if (dest.action === 'signOut') doSignOut();
    else if (dest.action === 'appLock') goAppLock();
    else if (dest.action === 'premium') navigation.navigate('Premium');
    else if (dest.action === 'diagnostics') navigation.navigate('Diagnostics');
  }

  const catalog = useMemo((): SettingItem[] => {
    const items: SettingItem[] = [
      // Account
      {
        id: 'account',
        section: 'Account',
        icon: 'person-outline',
        iconColor: ICON.account,
        label: 'Account',
        subtitle: 'Photo, name, about, username',
        keywords: 'account profile photo name about username email phone password',
        dest: { kind: 'nav', route: 'EditProfile' },
      },
      {
        id: 'security',
        section: 'Account',
        icon: 'key-outline',
        iconColor: ICON.account,
        label: 'Account & security',
        subtitle: 'Password, devices, sessions',
        keywords: 'security password devices sessions 2fa two factor authentication',
        dest: { kind: 'nav', route: 'AccountSecurity' },
      },
      {
        id: 'privacy',
        section: 'Account',
        icon: 'lock-closed-outline',
        iconColor: ICON.privacy,
        label: 'Privacy',
        subtitle: 'Last seen, receipts, blocked',
        keywords: 'privacy last seen online status calls groups communities read receipts blocked',
        dest: { kind: 'nav', route: 'Privacy' },
      },
      {
        id: 'notifications',
        section: 'Account',
        icon: 'notifications-outline',
        iconColor: ICON.notif,
        label: 'Notifications',
        subtitle: 'Messages, groups, calls, sounds',
        keywords: 'notifications messages groups communities calls mentions sound vibrate popup led',
        dest: { kind: 'nav', route: 'Notifications' },
      },
      {
        id: 'applock',
        section: 'Account',
        icon: 'shield-checkmark-outline',
        iconColor: ICON.privacy,
        label: 'App lock',
        subtitle: 'PIN or biometrics on open',
        keywords: 'app lock pin face id biometric fingerprint',
        dest: { kind: 'action', action: 'appLock' },
        premium: true,
      },
      // Chats & data
      {
        id: 'appearance',
        section: 'Chats & data',
        icon: 'color-palette-outline',
        iconColor: ICON.chats,
        label: 'Appearance',
        subtitle: 'Theme, wallpaper, system light/dark',
        keywords: 'appearance theme light dark follow system wallpaper font',
        dest: { kind: 'nav', route: 'Appearance' },
      },
      {
        id: 'chats',
        section: 'Chats & data',
        icon: 'chatbubble-ellipses-outline',
        iconColor: ICON.chats,
        label: 'Chats',
        subtitle: 'Enter to send, media, font size',
        keywords: 'chats enter send font size media quality auto download backup reaction',
        dest: { kind: 'nav', route: 'ChatSettings' },
      },
      {
        id: 'storage',
        section: 'Chats & data',
        icon: 'folder-outline',
        iconColor: ICON.storage,
        label: 'Storage & data',
        subtitle: 'Cache, auto-download, usage',
        keywords: 'storage data cache photos videos documents voice gifs network diagnostics',
        dest: { kind: 'nav', route: 'StorageData' },
      },
      {
        id: 'calls',
        section: 'Chats & data',
        icon: 'call-outline',
        iconColor: ICON.calls,
        label: 'Calls',
        subtitle: 'Ringtone, silence unknown, audio',
        keywords: 'calls quality camera microphone bluetooth noise suppression echo cancellation ringtone',
        dest: { kind: 'nav', route: 'CallSettings' },
      },
      {
        id: 'starred',
        section: 'Chats & data',
        icon: 'star-outline',
        iconColor: ICON.notif,
        label: 'Starred messages',
        keywords: 'starred messages bookmarks',
        dest: { kind: 'nav', route: 'Starred' },
      },
      {
        id: 'archived',
        section: 'Chats & data',
        icon: 'archive-outline',
        iconColor: ICON.about,
        label: 'Archived chats',
        keywords: 'archived chats archive',
        dest: { kind: 'nav', route: 'ArchivedChats' },
      },
      {
        id: 'streaks',
        section: 'Chats & data',
        icon: 'flame-outline',
        iconColor: '#F97316',
        label: 'Streaks',
        keywords: 'streaks fire daily',
        dest: { kind: 'nav', route: 'Streaks' },
      },
      {
        id: 'export',
        section: 'Chats & data',
        icon: 'download-outline',
        iconColor: ICON.storage,
        label: 'Export my data',
        subtitle: 'Backup & download',
        keywords: 'export data backup download gdpr',
        dest: { kind: 'nav', route: 'DataExport' },
      },
      // Support
      {
        id: 'mailbox',
        section: 'Support',
        icon: 'mail-outline',
        iconColor: ICON.help,
        label: 'Mailbox',
        keywords: 'mailbox mail inbox admin messages',
        dest: { kind: 'nav', route: 'Mailbox' },
        badge: 'mail',
      },
      {
        id: 'invite',
        section: 'Support',
        icon: 'share-social-outline',
        iconColor: ICON.help,
        label: 'Invite a friend',
        keywords: 'invite friend share',
        dest: { kind: 'nav', route: 'Invite' },
      },
      {
        id: 'help',
        section: 'Support',
        icon: 'help-circle-outline',
        iconColor: ICON.help,
        label: 'Help & Support',
        subtitle: 'FAQ, tickets, grievance',
        keywords: 'help support faq contact bug report grievance terms licenses',
        dest: { kind: 'nav', route: 'HelpSupport' },
      },
      {
        id: 'legal',
        section: 'Support',
        icon: 'document-text-outline',
        iconColor: ICON.about,
        label: 'Legal & policies',
        subtitle: 'Terms, privacy policy',
        keywords: 'legal terms privacy policy licenses open source',
        dest: { kind: 'nav', route: 'Legal' },
      },
      {
        id: 'signout',
        section: 'Support',
        icon: 'log-out-outline',
        iconColor: ICON.danger,
        label: 'Sign out',
        keywords: 'sign out logout log out',
        dest: { kind: 'action', action: 'signOut' },
        danger: true,
      },
      // About (searchable)
      {
        id: 'about-version',
        section: 'About',
        icon: 'information-circle-outline',
        iconColor: ICON.about,
        label: 'Version',
        subtitle: `${APP_NAME} v${APP_VERSION}`,
        keywords: 'version build about whats new open source licenses',
        dest: { kind: 'action', action: 'diagnostics' },
      },
    ];

    if (moderator) {
      items.splice(
        items.findIndex((i) => i.id === 'mailbox') + 1,
        0,
        {
          id: 'moderator',
          section: 'Support',
          icon: 'shield-checkmark-outline',
          iconColor: '#3b82f6',
          label: 'Moderator dashboard',
          keywords: 'moderator dashboard moderation',
          dest: { kind: 'nav', route: 'Moderator' },
          modOnly: true,
        },
      );
    }
    if (owner) {
      items.splice(
        items.findIndex((i) => i.id === 'mailbox') + 1,
        0,
        {
          id: 'admin',
          section: 'Support',
          icon: 'shield-half-outline',
          iconColor: '#f5b62a',
          label: 'Admin dashboard',
          keywords: 'admin dashboard owner',
          dest: { kind: 'nav', route: 'Admin' },
          ownerOnly: true,
        },
      );
    }
    return items;
  }, [moderator, owner]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return catalog;
    return catalog.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.keywords.includes(q) ||
        (i.subtitle && i.subtitle.toLowerCase().includes(q)) ||
        i.section.toLowerCase().includes(q),
    );
  }, [catalog, q]);

  const sections = useMemo(() => {
    const order = ['Account', 'Chats & data', 'Support', 'About'];
    const map = new Map<string, SettingItem[]>();
    for (const item of filtered) {
      const list = map.get(item.section) ?? [];
      list.push(item);
      map.set(item.section, list);
    }
    return order
      .filter((s) => map.has(s))
      .map((s) => ({ title: s, items: map.get(s)! }));
  }, [filtered]);

  const onQueryChange = useCallback((t: string) => {
    if (Platform.OS === 'ios') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setQuery(t);
  }, []);

  // Tab root: tab bar already owns the system nav inset via tabBarSafeStyle.
  // Only add content breathing room here — SafeScrollView with includeBottomInset
  // would double-count and leave a large empty band above the tab bar.
  const footerPad = spacing(10);

  return (
    <SafeScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: footerPad }}
      includeBottomInset={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      {/* Profile hero */}
      <Pressable
        style={({ pressed }) => [styles.profileRow, pressed && { opacity: 0.92 }]}
        onPress={() => uid && navigation.navigate('Profile', { userId: uid })}
        accessibilityRole="button"
        accessibilityLabel={
          profile?.display_name
            ? `Profile, ${profile.display_name}`
            : 'Your profile'
        }
        accessibilityHint="Opens your profile"
      >
        <ProfileAvatar
          uri={profile?.avatar_url}
          name={profile?.display_name}
          size={64}
          userId={uid}
          mode="choice"
        />
        <View style={styles.profileBody}>
          <View style={styles.nameRow}>
            <Text style={styles.profileName} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {profile?.display_name ?? 'Your name'}
            </Text>
            {(premium || admin) && <Text style={styles.plusBadge}>+</Text>}
            {moderator && !admin && <Text style={styles.modBadge}>MOD</Text>}
            {admin && <Text style={styles.devBadge}>DEV</Text>}
          </View>
          {profile?.username ? (
            <Text style={styles.handle} numberOfLines={1}>
              @{profile.username}
            </Text>
          ) : (
            <Text style={styles.handle} numberOfLines={1}>
              Username · coming soon
            </Text>
          )}
          <Text style={styles.profileAbout} numberOfLines={2} maxFontSizeMultiplier={1.35}>
            {admin
              ? `${APP_NAME}+ · Lifetime membership`
              : premium
                ? `${APP_NAME}+ member`
                : profile?.about || 'Hey there! I am using Lumixo.'}
          </Text>
        </View>
        <Ionicons name="qr-code-outline" size={22} color={colors.textMuted} />
      </Pressable>

      <SettingsSearchBar value={query} onChangeText={onQueryChange} />

      {/* Premium card — hidden during active search noise */}
      {!q && (
        <Pressable
          style={({ pressed }) => [styles.premiumCard, pressed && { opacity: 0.94 }]}
          onPress={() => navigation.navigate('Premium')}
          accessibilityRole="button"
          accessibilityLabel={`${APP_NAME} Plus`}
        >
          <SettingsIconBadge name="diamond" color={colors.accentPlusText} bg={`${colors.accentPlus}33`} />
          <View style={{ flex: 1, marginLeft: spacing(3), minWidth: 0 }}>
            <Text style={styles.premiumTitle} numberOfLines={1}>
              {APP_NAME}+{admin ? ' · Lifetime' : premium ? ' · Active' : ''}
            </Text>
            <Text style={styles.premiumSub} numberOfLines={2}>
              {admin
                ? 'Developer · lifetime Lumixo+ + Admin'
                : premium
                  ? 'Thanks for supporting Lumixo'
                  : 'Themes, wallpapers, app lock · ₹25/mo'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      )}

      {sections.length === 0 ? (
        <View style={styles.emptySearch}>
          <Ionicons name="search-outline" size={36} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>No settings match “{query.trim()}”</Text>
          <Text style={styles.emptySub}>Try account, privacy, theme, storage, or calls</Text>
        </View>
      ) : (
        sections.map((sec) => (
          <SettingsSection key={sec.title} title={q ? undefined : sec.title}>
            {sec.items.map((item, idx) => (
              <SettingsRow
                key={item.id}
                icon={item.icon}
                iconColor={item.iconColor}
                label={item.label}
                subtitle={item.subtitle}
                danger={item.danger}
                locked={item.premium && !(premium || admin)}
                badge={item.badge === 'mail' ? unseenMail : undefined}
                last={idx === sec.items.length - 1}
                onPress={() => {
                  if (item.badge === 'mail') setUnseenMail(0);
                  runDest(item.dest);
                }}
              />
            ))}
          </SettingsSection>
        ))
      )}

      {/* About footer */}
      {!q && (
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
            accessibilityLabel={`${APP_NAME} version ${APP_VERSION}. Tap seven times for diagnostics.`}
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
              {APP_NAME} v{APP_VERSION} · Build {APP_VERSION.replace(/\./g, '')}
            </Text>
          </Pressable>
        </View>
      )}
    </SafeScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(4),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      minHeight: 88,
    },
    profileBody: { flex: 1, marginLeft: spacing(3.5), minWidth: 0, marginRight: spacing(2) },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    profileName: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
      flexShrink: 1,
      letterSpacing: -0.3,
    },
    handle: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    profileAbout: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: 3,
      lineHeight: 17,
    },
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
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.3,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    devBadge: {
      marginLeft: spacing(2),
      color: '#0b141a',
      backgroundColor: '#f5b62a',
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.3,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    premiumCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      marginTop: spacing(2.5),
      marginHorizontal: spacing(3),
      borderRadius: radius.lg,
      paddingHorizontal: spacing(3),
      paddingVertical: spacing(3),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accentPlus + '55',
      minHeight: 64,
    },
    premiumTitle: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '700',
      letterSpacing: -0.15,
    },
    premiumSub: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: 2,
      lineHeight: 17,
    },
    emptySearch: {
      alignItems: 'center',
      paddingVertical: spacing(12),
      paddingHorizontal: spacing(6),
    },
    emptyTitle: {
      color: colors.text,
      fontSize: font.body,
      fontWeight: '600',
      marginTop: spacing(3),
      textAlign: 'center',
    },
    emptySub: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: spacing(1.5),
      textAlign: 'center',
    },
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
      minHeight: 36,
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
