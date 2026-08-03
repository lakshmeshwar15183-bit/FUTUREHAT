// Lumixo mobile — Chat settings: enter-to-send, font size, media visibility,
// upload quality, auto-download, voice transcripts. Standalone; persists via
// privacyApi chat-settings (user_preferences.extra.chat).
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import SafeScrollView from '../ui/SafeScrollView';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../lib/supabase';
import { getChatSettings, setChatSettings, type ChatSettings, type FontSize, type MediaQuality } from '../lib/shared';
import { getCache, setCache } from '../lib/localCache';
import { queueAction } from '../lib/sync';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import { Alert } from '../ui/dialog';

export default function ChatSettingsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [c, setC] = useState<ChatSettings | null>(null);

  useEffect(() => {
    // Instant: cached chat settings first (offline included), then refresh.
    getCache<ChatSettings | null>('chatSettings', null).then((cached) => { if (cached) setC(cached); });
    getChatSettings(supabase).then((s) => { setC(s); setCache('chatSettings', s); }).catch(() => {});
  }, []);

  function update(patch: Partial<ChatSettings>) {
    // Instant: update local state + cache, then queue the sync (auto-retries).
    setC((cur) => {
      const next = cur ? { ...cur, ...patch } : cur;
      if (next) setCache('chatSettings', next);
      return next;
    });
    queueAction('updateChatSettings', { patch });
  }

  function pickFont() {
    Alert.alert('Font size', undefined, [
      { text: 'Small', onPress: () => update({ fontSize: 'small' }) },
      { text: 'Medium', onPress: () => update({ fontSize: 'medium' }) },
      { text: 'Large', onPress: () => update({ fontSize: 'large' }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  function pickQuality() {
    Alert.alert('Upload quality', undefined, [
      { text: 'Auto', onPress: () => update({ mediaUploadQuality: 'auto' }) },
      { text: 'High', onPress: () => update({ mediaUploadQuality: 'high' }) },
      { text: 'Data saver', onPress: () => update({ mediaUploadQuality: 'data_saver' }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const fontLabel: Record<FontSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
  const qualityLabel: Record<MediaQuality, string> = { auto: 'Auto', high: 'High', data_saver: 'Data saver' };

  return (
    <SafeScrollView style={styles.container}>
      {c && (
        <View style={styles.group}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Enter to send</Text>
            <Switch value={c.enterToSend} onValueChange={(v) => update({ enterToSend: v })} trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
          <Pressable style={styles.row} onPress={pickFont}>
            <Text style={styles.rowLabel}>Font size</Text>
            <Text style={styles.rowValue}>{fontLabel[c.fontSize]}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Media visibility</Text>
            <Switch value={c.mediaVisibility} onValueChange={(v) => update({ mediaVisibility: v })} trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
          <Pressable style={styles.row} onPress={pickQuality}>
            <Text style={styles.rowLabel}>Upload quality</Text>
            <Text style={styles.rowValue}>{qualityLabel[c.mediaUploadQuality]}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Auto-download media</Text>
              <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 2 }}>
                Prefer Storage &amp; Data for Wi‑Fi / cellular rules. Off by default.
              </Text>
            </View>
            <Switch value={c.autoDownload} onValueChange={(v) => update({ autoDownload: v })} trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Voice message transcripts</Text>
            <Switch value={c.voiceTranscripts} onValueChange={(v) => update({ voiceTranscripts: v })} trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
          <Pressable
            style={[styles.row, styles.rowLast]}
            onPress={() => {
              Alert.alert('Default double-tap reaction', 'Used when you double-tap a message.', [
                { text: '❤️ Heart', onPress: () => update({ defaultReaction: '❤️' }) },
                { text: '👍 Like', onPress: () => update({ defaultReaction: '👍' }) },
                { text: '😂 Laugh', onPress: () => update({ defaultReaction: '😂' }) },
                { text: '😮 Wow', onPress: () => update({ defaultReaction: '😮' }) },
                { text: '😢 Sad', onPress: () => update({ defaultReaction: '😢' }) },
                { text: '🙏 Pray', onPress: () => update({ defaultReaction: '🙏' }) },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
          >
            <Text style={styles.rowLabel}>Double-tap reaction</Text>
            <Text style={styles.rowValue}>{c.defaultReaction || '❤️'}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
        </View>
      )}
      <View style={{ height: spacing(8) }} />
    </SafeScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    group: { backgroundColor: colors.surface, marginHorizontal: spacing(3), marginTop: spacing(4), borderRadius: radius.md, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { flex: 1, color: colors.text, fontSize: font.body },
    rowValue: { color: colors.textMuted, fontSize: font.small, marginRight: spacing(2) },
  });
