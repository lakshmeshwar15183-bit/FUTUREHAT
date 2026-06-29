// FUTUREHAT mobile — Settings tab. Profile header, grouped settings rows,
// owner credit footer, and sign out.
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { getCurrentUser, getMyProfile, signOut, getSubscription, isSubscriptionActive } from '../lib/shared';
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

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        const user = await getCurrentUser(supabase);
        setUid(user?.id ?? null);
        setProfile(await getMyProfile(supabase));
        setPremium(isSubscriptionActive(await getSubscription(supabase)));
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
          <Text style={styles.profileName}>{profile?.display_name ?? 'Your name'}</Text>
          <Text style={styles.profileAbout} numberOfLines={1}>
            {profile?.about || 'Hey there! I am using FUTUREHAT.'}
          </Text>
        </View>
        <Ionicons name="qr-code-outline" size={24} color={colors.primary} />
      </Pressable>

      <Pressable style={styles.premiumCard} onPress={() => navigation.navigate('Premium')}>
        <Ionicons name="diamond" size={26} color={colors.accentPlus} />
        <View style={{ flex: 1, marginLeft: spacing(3) }}>
          <Text style={styles.premiumTitle}>{APP_NAME}+ {premium ? '· Active' : ''}</Text>
          <Text style={styles.premiumSub}>
            {premium ? 'Thanks for supporting FUTUREHAT' : 'Themes, AI, scheduling & more'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
      </Pressable>

      <Group>
        <Row icon="person-outline" label="Account" onPress={() => navigation.navigate('EditProfile')} />
        <Row icon="lock-closed-outline" label="Privacy" onPress={() => notYet('Privacy controls')} />
        <Row icon="shield-checkmark-outline" label="Security & App lock" onPress={() => navigation.navigate('AppLockSetup')} />
        <Row icon="notifications-outline" label="Notifications" onPress={() => notYet('Notification settings')} />
      </Group>

      <Group>
        <Row icon="color-palette-outline" label="Appearance & Themes" onPress={() => navigation.navigate('Appearance')} />
        <Row icon="folder-outline" label="Storage & Data" onPress={() => notYet('Storage management')} />
        <Row icon="cloud-upload-outline" label="Chat backup" onPress={() => notYet('Chat backup')} />
      </Group>

      <Group>
        <Row
          icon="share-social-outline"
          label="Invite a friend"
          onPress={() =>
            Share.share({ message: `Join me on ${APP_NAME}! https://futurehat-app.netlify.app` })
          }
        />
        <Row icon="help-circle-outline" label="Help & About" onPress={() => Alert.alert(`${APP_NAME} v${APP_VERSION}`, CREDIT)} />
        <Row icon="log-out-outline" label="Sign out" danger onPress={doSignOut} />
      </Group>

      <Text style={styles.credit}>{CREDIT}</Text>
      <Text style={styles.version}>{APP_NAME} v{APP_VERSION}</Text>
    </ScrollView>
  );
}

function notYet(feature: string) {
  Alert.alert(feature, `${feature} is coming in a later update.`);
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
    profileName: { color: colors.text, fontSize: font.title, fontWeight: '600' },
    profileAbout: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
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
