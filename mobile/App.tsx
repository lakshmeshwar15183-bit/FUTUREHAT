// FUTUREHAT mobile — root component. Providers (safe-area, theme, app-lock),
// auth gate, bottom tabs, and the full navigation stack.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from './src/lib/supabase';
import { getCurrentUser, onAuthChange } from './src/lib/shared';
import { ThemeProvider, useTheme } from './src/theme';
import { AppLockProvider, useAppLock } from './src/security/AppLock';
import { CallProvider } from './src/calls/CallContext';
import LockScreen from './src/security/LockScreen';
import { APP_NAME } from './src/branding';
import type { RootStackParamList } from './src/navigation/types';

import AuthScreen from './src/screens/AuthScreen';
import ConversationsScreen from './src/screens/ConversationsScreen';
import StatusScreen from './src/screens/StatusScreen';
import CommunitiesScreen from './src/screens/CommunitiesScreen';
import CallsScreen from './src/screens/CallsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ChatScreen from './src/screens/ChatScreen';
import NewChatScreen from './src/screens/NewChatScreen';
import NewGroupScreen from './src/screens/NewGroupScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import AppearanceScreen from './src/screens/AppearanceScreen';
import PremiumScreen from './src/screens/PremiumScreen';
import AppLockSetupScreen from './src/screens/AppLockSetupScreen';
import CreateCommunityScreen from './src/screens/CreateCommunityScreen';
import CommunityDetailScreen from './src/screens/CommunityDetailScreen';
import HelpSupportScreen from './src/screens/HelpSupportScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.header },
        headerTitleStyle: { color: colors.isLight ? '#fff' : colors.text, fontWeight: '700' },
        headerTintColor: colors.isLight ? '#fff' : colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarIcon: ({ color, size, focused }) => {
          const map: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
            Chats: ['chatbubbles', 'chatbubbles-outline'],
            Status: ['radio', 'radio-outline'],
            Communities: ['people', 'people-outline'],
            Calls: ['call', 'call-outline'],
            Settings: ['settings', 'settings-outline'],
          };
          const [on, off] = map[route.name] ?? ['ellipse', 'ellipse-outline'];
          return <Ionicons name={focused ? on : off} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Chats" component={ConversationsScreen} options={{ title: APP_NAME }} />
      <Tab.Screen name="Status" component={StatusScreen} />
      <Tab.Screen name="Communities" component={CommunitiesScreen} />
      <Tab.Screen name="Calls" component={CallsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { colors, mode } = useTheme();
  const { locked } = useAppLock();
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

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

    const { unsubscribe } = onAuthChange(supabase, (_e, session) => {
      if (active) setSignedIn(!!session);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const navTheme = {
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
  };

  const screenOptions = {
    headerStyle: { backgroundColor: colors.header },
    headerTintColor: colors.isLight ? '#fff' : colors.text,
    headerTitleStyle: { color: colors.isLight ? '#fff' : colors.text, fontWeight: '600' as const },
    contentStyle: { backgroundColor: colors.bg },
  };

  if (loading) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.bg }]}>
        <Text style={[styles.brand, { color: colors.primary }]}>{APP_NAME}</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={colors.isLight ? 'dark' : 'light'} />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator screenOptions={screenOptions}>
          {signedIn ? (
            <>
              <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
              <Stack.Screen name="Chat" component={ChatScreen} options={{ title: '' }} />
              <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'New chat' }} />
              <Stack.Screen name="NewGroup" component={NewGroupScreen} options={{ title: 'New group' }} />
              <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: '' }} />
              <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit profile' }} />
              <Stack.Screen name="Appearance" component={AppearanceScreen} options={{ title: 'Appearance' }} />
              <Stack.Screen name="Premium" component={PremiumScreen} options={{ title: `${APP_NAME}+` }} />
              <Stack.Screen name="AppLockSetup" component={AppLockSetupScreen} options={{ title: 'App lock' }} />
              <Stack.Screen name="CreateCommunity" component={CreateCommunityScreen} options={{ title: 'New community' }} />
              <Stack.Screen name="CommunityDetail" component={CommunityDetailScreen} options={{ title: '' }} />
              <Stack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ title: 'Help & Support' }} />
            </>
          ) : (
            <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {signedIn && locked && (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen />
        </View>
      )}
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppLockProvider>
            <CallProvider>
              <RootNavigator />
            </CallProvider>
          </AppLockProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 36, fontWeight: '800', letterSpacing: 2 },
});
