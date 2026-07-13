// Lumixo mobile — root component. Providers (safe-area, theme, app-lock),
// auth gate, bottom tabs, and the full navigation stack.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { tabBarSafeStyle } from './src/lib/safeLayout';

import { supabase } from './src/lib/supabase';
import { getCurrentUser, onAuthChange } from './src/lib/shared';
import { isRecoveryLink, parseRecoveryLink, RESET_PASSWORD_PATH } from './src/lib/authLinks';
import { startSync } from './src/lib/sync';
import { hydrateAppIcon } from './src/lib/appIcon';
import { installCrashReporter } from './src/lib/crashReporter';
import { runProdHealthChecks } from './src/lib/prodHealth';
import { preloadEmojiCache } from './src/lib/emojiCache';
import { preloadStickerCache } from './src/lib/stickers';
import { ThemeProvider, useTheme, enableLayoutAnimations } from './src/theme';
// Soft LayoutAnimation for selection/chip transitions (Android opt-in).
enableLayoutAnimations();
import { PremiumProvider, ActivatingPremiumBanner } from './src/premium';
import { AppLockProvider, useAppLock } from './src/security/AppLock';
import { ChatLockProvider } from './src/security/ChatLock';
import { CallProvider } from './src/calls/CallContext';
import { StatusPresenceProvider } from './src/components/status/StatusPresenceContext';
import LockScreen from './src/security/LockScreen';
import { APP_NAME } from './src/branding';
import type { RootStackParamList } from './src/navigation/types';

import AuthScreen from './src/screens/AuthScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import ConversationsScreen from './src/screens/ConversationsScreen';
import CommunitiesScreen from './src/screens/CommunitiesScreen';
import CallsScreen from './src/screens/CallsScreen';
import CallDetailScreen from './src/screens/CallDetailScreen';
import ScheduledCallsScreen from './src/screens/ScheduledCallsScreen';
import CallSettingsScreen from './src/screens/CallSettingsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ChatScreen from './src/screens/ChatScreen';
import NewChatScreen from './src/screens/NewChatScreen';
import NewGroupScreen from './src/screens/NewGroupScreen';
import GroupInfoScreen from './src/screens/GroupInfoScreen';
import JoinGroupScreen from './src/screens/JoinGroupScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import AppearanceScreen from './src/screens/AppearanceScreen';
import PremiumScreen from './src/screens/PremiumScreen';
import AppLockSetupScreen from './src/screens/AppLockSetupScreen';
import CreateCommunityScreen from './src/screens/CreateCommunityScreen';
import CommunityDetailScreen from './src/screens/CommunityDetailScreen';
import HelpSupportScreen from './src/screens/HelpSupportScreen';
import PrivacyScreen from './src/screens/PrivacyScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ChatSettingsScreen from './src/screens/ChatSettingsScreen';
import StorageDataScreen from './src/screens/StorageDataScreen';
import AccountSecurityScreen from './src/screens/AccountSecurityScreen';
import DataExportScreen from './src/screens/DataExportScreen';
import ArchivedChatsScreen from './src/screens/ArchivedChatsScreen';
import LegalScreen from './src/screens/LegalScreen';
import DiagnosticsScreen from './src/screens/DiagnosticsScreen';
import InviteScreen from './src/screens/InviteScreen';
import StarredScreen from './src/screens/StarredScreen';
import AdminDashboardScreen from './src/screens/admin/AdminDashboardScreen';
import AdminUserDetailScreen from './src/screens/admin/AdminUserDetailScreen';
import ModeratorDashboardScreen from './src/screens/ModeratorDashboardScreen';
import MailboxScreen from './src/screens/MailboxScreen';
import MediaPickerScreen from './src/screens/MediaPickerScreen';
import MediaPreviewScreen from './src/screens/MediaPreviewScreen';
import StreaksScreen from './src/screens/StreaksScreen';
import StreakDetailScreen from './src/screens/StreakDetailScreen';
import StreakInfoScreen, { STREAK_INFO_TITLES } from './src/screens/StreakInfoScreen';
import HallOfLegendsScreen from './src/screens/HallOfLegendsScreen';
import AdminGate from './src/components/AdminGate';
import NotificationsBridge from './src/components/NotificationsBridge';
import NotificationSetupGate from './src/components/NotificationSetupGate';
import { DialogHost } from './src/ui/dialog';
import ErrorBoundary from './src/components/ErrorBoundary';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Dynamically lift the tab bar above the system navigation bar / home
  // indicator / gesture handle. Hardcoded heights (e.g. Android 58 / pad 6)
  // clip labels under 3-button nav on Samsung, Pixel, Realme, Xiaomi, etc.
  const tabBarStyle = useMemo(
    () =>
      tabBarSafeStyle(insets, {
        backgroundColor: colors.surface,
        borderTopColor: colors.isLight ? 'rgba(0,0,0,0.06)' : colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        elevation: 0,
      }),
    [insets.bottom, colors.surface, colors.isLight, colors.border],
  );

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: {
          backgroundColor: colors.header,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.isLight ? 'rgba(0,0,0,0.06)' : colors.border,
        },
        headerTitleStyle: {
          color: colors.isLight ? '#fff' : colors.text,
          fontWeight: '700',
          fontSize: 17,
          letterSpacing: -0.2,
        },
        headerTintColor: colors.isLight ? '#fff' : colors.text,
        headerTitleAlign: 'left' as const,
        // We apply bottom inset ourselves via tabBarSafeStyle — disable the
        // navigator's automatic double-padding so OEM nav bars aren't padded twice.
        safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
        tabBarStyle,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: -0.05,
          marginTop: -2,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarIcon: ({ color, focused }) => {
          const map: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
            Chats: ['chatbubbles', 'chatbubbles-outline'],
            Communities: ['people', 'people-outline'],
            Calls: ['call', 'call-outline'],
            Settings: ['settings', 'settings-outline'],
          };
          const [on, off] = map[route.name] ?? ['ellipse', 'ellipse-outline'];
          return <Ionicons name={focused ? on : off} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="Chats"
        component={ConversationsScreen}
        options={{ title: APP_NAME, tabBarAccessibilityLabel: 'Chats' }}
      />
      <Tab.Screen
        name="Communities"
        component={CommunitiesScreen}
        options={{ tabBarAccessibilityLabel: 'Communities' }}
      />
      <Tab.Screen
        name="Calls"
        component={CallsScreen}
        options={{ tabBarAccessibilityLabel: 'Calls' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarAccessibilityLabel: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

// Deep-link config for React Navigation. `expo-linking`'s createURL() derives
// the correct scheme for every runtime (Expo Go: `exp://…`, dev-client:
// `dev.lakshmeshwar.futurehat://…`, standalone: `futurehat://…`), and we
// include the app scheme as an explicit prefix so production builds route
// `futurehat://reset-password` without any config drift.
// The https origin is the primary reset-link prefix (Android App Link / iOS
// Universal Link): a verified link opens the app here, and React Navigation
// routes `/reset-password` to the ResetPassword screen. The app-scheme prefixes
// remain for dev builds and the non-verified fallback path.
const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || 'https://futurehat-app.netlify.app').replace(/\/+$/, '');
const LINKING_PREFIXES: string[] = [
  SITE_URL,
  Linking.createURL('/'),
  'futurehat://',
];
const linkingConfig: React.ComponentProps<typeof NavigationContainer>['linking'] = {
  prefixes: LINKING_PREFIXES,
  config: {
    screens: {
      Auth: 'auth',
      ResetPassword: RESET_PASSWORD_PATH,
      Main: 'main',
      JoinGroup: 'invite/g/:token',
      Chat: 'chat/:conversationId',
      GroupInfo: 'group/:conversationId',
    },
  },
};

function RootNavigator() {
  const { colors, mode } = useTheme();
  const { locked } = useAppLock();
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  // When the deep-link handler installs a recovery session we set this so the
  // stack re-mounts with ResetPassword as the initial route, even if the user
  // was already signed in. Cleared once the reset flow completes.
  const [recoveryPending, setRecoveryPending] = useState(false);
  // Buffered incoming URL from the cold-start path — navRef isn't ready during
  // the very first render, so we drain this once the container has mounted.
  const pendingRecoveryError = useRef<string | null>(null);

  // Native full-screen call intents land on MainActivity with extras; also
  // futurehat://call/<id> deep links. Accept/Decline are handled when CallProvider mounts.
  useEffect(() => {
    function handleCallDeepLink(url: string | null | undefined) {
      if (!url || !url.includes('call')) return;
      // Navigation into Main is enough — CallProvider realtime shows IncomingCallView
      // when status is still ringing. Accept action extras are read by CallContext.
      try {
        if (navRef.isReady() && signedIn) {
          navRef.navigate('Main' as any);
        }
      } catch { /* ignore */ }
    }
    Linking.getInitialURL().then(handleCallDeepLink).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handleCallDeepLink(url));
    return () => sub.remove();
  }, [signedIn, navRef]);

  // ── Deep-link → recovery session installer ────────────────────────────────
  // Runs for cold start (getInitialURL) AND warm (addEventListener). The
  // sequence is: parse the URL fragment → setSession(access, refresh) so the
  // client is authenticated as the recovering user → mark recoveryPending so
  // ResetPassword becomes the initial route. If the URL clearly LOOKS like a
  // recovery link but the tokens are missing / malformed we still route to
  // ResetPassword — it renders a "link expired" message instead of the form.
  useEffect(() => {
    let alive = true;

    async function handleUrl(url: string | null | undefined) {
      if (!alive || !url) return;
      if (!isRecoveryLink(url)) return;
      const parsed = parseRecoveryLink(url);
      if (!parsed) {
        pendingRecoveryError.current = 'This reset link is missing its recovery token.';
        setRecoveryPending(true);
        return;
      }
      const { error } = await supabase.auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
      });
      if (!alive) return;
      if (error) {
        pendingRecoveryError.current =
          error.message.toLowerCase().includes('expired')
            ? 'This reset link has expired. Request a new one from the sign-in screen.'
            : 'This reset link is invalid or has already been used.';
      } else {
        pendingRecoveryError.current = null;
      }
      setRecoveryPending(true);
    }

    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => { void handleUrl(url); });

    // Supabase also fires PASSWORD_RECOVERY on its own once a recovery session
    // is installed (belt + braces — covers the case where setSession was
    // called elsewhere or a magic-link recovery landed us in-app).
    const { unsubscribe: offAuth } = onAuthChange(supabase, (event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryPending(true);
    });

    return () => {
      alive = false;
      sub.remove();
      offAuth();
    };
  }, []);

  // Once the nav container mounts + recoveryPending flips on, ensure we're on
  // ResetPassword regardless of the current stack. We do this via navRef so we
  // don't have to teach every ancestor about the state.
  useEffect(() => {
    if (!recoveryPending) return;
    const go = () => {
      if (!navRef.isReady()) { setTimeout(go, 50); return; }
      navRef.reset({
        index: 0,
        routes: [{ name: 'ResetPassword', params: { recoveryError: pendingRecoveryError.current ?? undefined } }],
      });
      setRecoveryPending(false);
    };
    go();
  }, [recoveryPending, navRef]);

  useEffect(() => {
    let active = true;
    getCurrentUser(supabase)
      .then((user) => {
        if (active) {
          setSignedIn(!!user);
          setLoading(false);
        }
      })
      .catch(() => active && setLoading(false));

    const { unsubscribe } = onAuthChange(supabase, (event, session) => {
      if (!active) return;
      // TOKEN_REFRESHED / SIGNED_IN keep the user signed in; SIGNED_OUT clears.
      if (event === 'SIGNED_OUT') setSignedIn(false);
      else setSignedIn(!!session?.user);
    });

    // Resume: refresh session when app returns to foreground so expired JWTs
    // recover before the next API call fails with 401.
    const appSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        if (data.session) {
          setSignedIn(true);
          // Proactively refresh near-expiry tokens (best-effort).
          const exp = data.session.expires_at ?? 0;
          const soon = exp > 0 && exp * 1000 - Date.now() < 120_000;
          if (soon) void supabase.auth.refreshSession().catch(() => {});
        }
      });
    });

    return () => {
      active = false;
      unsubscribe();
      appSub.remove();
    };
  }, []);

  // Rebuild when palette flips (Follow System live update) so native headers,
  // cards, and content backgrounds retheme without remounting the stack.
  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      dark: !colors.isLight,
      colors: {
        ...DefaultTheme.colors,
        background: colors.bg,
        card: colors.header,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
        notification: colors.primary,
      },
    }),
    [colors],
  );

  const screenOptions = useMemo(
    () => ({
      headerStyle: {
        backgroundColor: colors.header,
      },
      headerTintColor: colors.isLight ? '#fff' : colors.text,
      headerTitleStyle: {
        color: colors.isLight ? '#fff' : colors.text,
        fontWeight: '600' as const,
        fontSize: 17,
        letterSpacing: -0.2,
      },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.bg },
      // Native stack: snappy messenger push (not default slow iOS-ish slide).
      animation: 'slide_from_right' as const,
      animationDuration: 220,
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
    }),
    [colors],
  );

  if (loading) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.bg }]}>
        <Text style={[styles.brand, { color: colors.primary }]}>{APP_NAME}</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <NavigationContainer theme={navTheme} ref={navRef} linking={linkingConfig}>
        <Stack.Navigator screenOptions={screenOptions}>
          {/* ResetPassword is registered on BOTH sides of the auth split.
              A recovery link installs a temp session → the user is briefly
              "signed in" → without this the stack would jump to Main. We keep
              the screen in both branches so the deep-link reset works
              regardless of the surrounding auth state. */}
          {signedIn ? (
            <>
              <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
              <Stack.Screen
                name="Chat"
                component={ChatScreen}
                options={{
                  title: '',
                  // Opaque canvas — previous Main tabs must never show through.
                  contentStyle: { backgroundColor: colors.bg },
                  animation: 'slide_from_right',
                }}
              />
              <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'New chat' }} />
              <Stack.Screen name="NewGroup" component={NewGroupScreen} options={{ title: 'New group' }} />
              <Stack.Screen name="GroupInfo" component={GroupInfoScreen} options={{ title: 'Group info' }} />
              <Stack.Screen name="JoinGroup" component={JoinGroupScreen} options={{ title: 'Join group' }} />
              <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: '' }} />
              <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit profile' }} />
              <Stack.Screen name="Appearance" component={AppearanceScreen} options={{ title: 'Appearance' }} />
              <Stack.Screen name="Premium" component={PremiumScreen} options={{ title: `${APP_NAME}+` }} />
              <Stack.Screen name="AppLockSetup" component={AppLockSetupScreen} options={{ title: 'App lock' }} />
              <Stack.Screen name="CreateCommunity" component={CreateCommunityScreen} options={{ title: 'New community' }} />
              <Stack.Screen name="CommunityDetail" component={CommunityDetailScreen} options={{ title: '' }} />
              <Stack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ title: 'Help & Support' }} />
              <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: 'Privacy' }} />
              <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
              <Stack.Screen name="ChatSettings" component={ChatSettingsScreen} options={{ title: 'Chats' }} />
              <Stack.Screen name="StorageData" component={StorageDataScreen} options={{ title: 'Storage & data' }} />
              <Stack.Screen name="AccountSecurity" component={AccountSecurityScreen} options={{ title: 'Account & security' }} />
              <Stack.Screen name="DataExport" component={DataExportScreen} options={{ title: 'Export data' }} />
              <Stack.Screen name="ArchivedChats" component={ArchivedChatsScreen} options={{ title: 'Archived chats' }} />
              <Stack.Screen name="Legal" component={LegalScreen} options={{ title: 'Legal & policies' }} />
              <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ title: 'Diagnostics' }} />
              <Stack.Screen name="Invite" component={InviteScreen} options={{ title: 'Invite friends' }} />
              <Stack.Screen name="Starred" component={StarredScreen} options={{ title: 'Starred messages' }} />
              <Stack.Screen name="Admin" component={AdminDashboardScreen} options={{ title: 'Admin dashboard' }} />
              <Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} options={{ title: 'Manage user' }} />
              <Stack.Screen name="Moderator" component={ModeratorDashboardScreen} options={{ title: 'Moderator dashboard' }} />
              <Stack.Screen name="Mailbox" component={MailboxScreen} options={{ title: 'Mailbox' }} />
              <Stack.Screen name="CallDetail" component={CallDetailScreen} options={{ title: '' }} />
              <Stack.Screen name="ScheduledCalls" component={ScheduledCallsScreen} options={{ title: 'Scheduled calls' }} />
              <Stack.Screen name="CallSettings" component={CallSettingsScreen} options={{ title: 'Call settings' }} />
              <Stack.Screen name="MediaPicker" component={MediaPickerScreen} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="MediaPreview" component={MediaPreviewScreen} options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen name="Streaks" component={StreaksScreen} options={{ title: 'Streaks' }} />
              <Stack.Screen name="StreakDetail" component={StreakDetailScreen} options={({ route }) => ({ title: route.params?.title || 'Streak' })} />
              <Stack.Screen name="StreakInfo" component={StreakInfoScreen} options={({ route }) => ({ title: STREAK_INFO_TITLES[route.params?.page ?? 'how'] })} />
              <Stack.Screen name="HallOfLegends" component={HallOfLegendsScreen} options={{ title: 'Hall of Legends' }} />
              <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ headerShown: false }} />
            </>
          ) : (
            <>
              <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
              <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ headerShown: false }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {signedIn && <AdminGate />}
      {signedIn && <NotificationsBridge navRef={navRef} />}
      {/* First-launch permission + OEM battery guidance (never blocks auth). */}
      {signedIn && !locked && <NotificationSetupGate />}
      {signedIn && locked && (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen />
        </View>
      )}
      {/* Non-blocking premium activation toast — never remounts nav / splash. */}
      {signedIn && <ActivatingPremiumBanner />}
      {/* Global premium dialogs / sheets — always mounted (overlay, not Modal)
          so action sheets open in the same frame as long-press without native
          window cold-start latency. Parent flex:1 gives absoluteFill a real box. */}
      <DialogHost />
    </View>
  );
}

export default function App() {
  // P0: global crash capture first so boot failures are recorded.
  useEffect(() => {
    installCrashReporter();
  }, []);
  // Start background sync + offline outbox flushing for the whole app lifetime.
  useEffect(() => startSync(), []);
  useEffect(() => { void hydrateAppIcon(); }, []);
  // Preload emoji/sticker catalogs so chat pickers open instantly (offline cache).
  useEffect(() => {
    void preloadEmojiCache();
    void preloadStickerCache();
  }, []);
  // Production health (TURN / auth redirect / Supabase) — non-blocking.
  useEffect(() => {
    void runProdHealthChecks();
  }, []);
  return (
    <ErrorBoundary label="App">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {/* Premium outside Theme so theme gates update instantly on purchase. */}
          <PremiumProvider>
            <ThemeProvider>
              <AppLockProvider>
                <ChatLockProvider>
                  <CallProvider>
                    <StatusPresenceProvider>
                      <RootNavigator />
                    </StatusPresenceProvider>
                  </CallProvider>
                </ChatLockProvider>
              </AppLockProvider>
            </ThemeProvider>
          </PremiumProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 36, fontWeight: '800', letterSpacing: 2 },
});
