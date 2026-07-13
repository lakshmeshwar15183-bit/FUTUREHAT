// Lumixo mobile — WhatsApp-style multi-step community creation.
// Steps: icon+name → description → review → create (seeds Announcements + General).
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import SafeScrollView from '../ui/SafeScrollView';
import SafeBottomBar from '../ui/SafeBottomBar';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../lib/supabase';
import { createCommunity, createChannel } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'CreateCommunity'>;
type Step = 0 | 1 | 2;

const STEPS = ['Details', 'About', 'Review'] as const;

export default function CreateCommunityScreen() {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function pickAvatar() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!res.canceled && res.assets?.[0]) {
        setAvatarUri(res.assets[0].uri);
      }
    } catch {
      Alert.alert('Error', 'Could not pick image');
    }
  }

  async function uploadAvatar(): Promise<string | null> {
    if (!avatarUri) return null;
    try {
      setUploading(true);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error('not authenticated');
      const ext = avatarUri.split('.').pop() || 'jpg';
      const fileName = `${uid}/community-${Date.now()}.${ext}`;
      const fileBase64 = await FileSystem.readAsStringAsync(avatarUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { data, error } = await supabase.storage
        .from('avatars')
        .upload(fileName, Buffer.from(fileBase64, 'base64'), {
          contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
        });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(data.path);
      return urlData?.publicUrl || null;
    } catch {
      Alert.alert('Upload failed', 'Could not upload community icon');
      return null;
    } finally {
      setUploading(false);
    }
  }

  function next() {
    if (step === 0) {
      if (!name.trim()) {
        Alert.alert('Name required', 'Give your community a name.');
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    void create();
  }

  function back() {
    if (step === 0) {
      navigation.goBack();
      return;
    }
    setStep((s) => (s - 1) as Step);
  }

  async function create() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your community a name.');
      return;
    }
    setBusy(true);
    const avatarUrl = await uploadAvatar();
    const { community, error } = await createCommunity(
      supabase,
      name.trim(),
      description.trim() || undefined,
      avatarUrl,
    );
    if (error || !community) {
      setBusy(false);
      Alert.alert('Could not create', error?.message ?? 'Try again.');
      return;
    }
    // WhatsApp seeds Announcements + a general group.
    await createChannel(supabase, community.id, 'Announcements', 'announcement');
    await createChannel(supabase, community.id, 'General', 'text');
    setBusy(false);
    navigation.replace('CommunityDetail', {
      communityId: community.id,
      name: community.name,
    });
  }

  return (
    <View style={styles.container}>
      {/* Step dots */}
      <View style={styles.steps}>
        {STEPS.map((label, i) => (
          <View key={label} style={styles.stepItem}>
            <View
              style={[
                styles.dot,
                i <= step && styles.dotOn,
                i < step && styles.dotDone,
              ]}
            >
              {i < step ? (
                <Ionicons name="checkmark" size={12} color="#fff" />
              ) : (
                <Text style={[styles.dotNum, i <= step && styles.dotNumOn]}>{i + 1}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, i === step && styles.stepLabelOn]}>{label}</Text>
          </View>
        ))}
      </View>

      <SafeScrollView
        contentContainerStyle={styles.scroll}
        bottomExtra={96}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
          <>
            <Text style={styles.hero}>Create a new community</Text>
            <Text style={styles.heroSub}>
              Communities bring related groups together and make it easy to get admin announcements.
            </Text>
            <Pressable style={styles.iconWrap} onPress={pickAvatar} disabled={uploading}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.icon} />
              ) : (
                <View style={styles.icon}>
                  <Ionicons name="people" size={40} color="#fff" />
                </View>
              )}
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={14} color="#fff" />
              </View>
              {uploading && <ActivityIndicator style={styles.uploadSpinner} color={colors.primary} />}
            </Pressable>
            <Text style={styles.fieldLabel}>Community name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Neighbors, School, Club"
              placeholderTextColor={colors.textFaint}
              value={name}
              onChangeText={setName}
              maxLength={100}
              autoFocus
            />
            <Text style={styles.hint}>{name.length}/100</Text>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.hero}>What is this community about?</Text>
            <Text style={styles.heroSub}>
              Add a description so people understand the purpose of this community.
            </Text>
            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.desc]}
              placeholder="Describe your community…"
              placeholderTextColor={colors.textFaint}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={512}
              autoFocus
            />
            <Text style={styles.hint}>{description.length}/512</Text>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.hero}>Review your community</Text>
            <Text style={styles.heroSub}>You can change these details later from community info.</Text>
            <View style={styles.reviewCard}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.reviewIcon} />
              ) : (
                <View style={[styles.reviewIcon, { backgroundColor: colors.primary }]}>
                  <Ionicons name="people" size={32} color="#fff" />
                </View>
              )}
              <Text style={styles.reviewName}>{name.trim()}</Text>
              {!!description.trim() && (
                <Text style={styles.reviewDesc}>{description.trim()}</Text>
              )}
              <View style={styles.reviewSeed}>
                <View style={styles.seedRow}>
                  <Ionicons name="megaphone" size={18} color={colors.primary} />
                  <Text style={styles.seedText}>Announcements</Text>
                </View>
                <View style={styles.seedRow}>
                  <Ionicons name="chatbubbles" size={18} color={colors.primary} />
                  <Text style={styles.seedText}>General</Text>
                </View>
              </View>
            </View>
          </>
        )}
      </SafeScrollView>

      <SafeBottomBar style={styles.footer} extra={12}>
        <Pressable style={styles.backBtn} onPress={back} disabled={busy}>
          <Text style={styles.backText}>{step === 0 ? 'Cancel' : 'Back'}</Text>
        </Pressable>
        <Pressable
          style={[styles.nextBtn, (busy || uploading) && styles.btnDisabled]}
          onPress={next}
          disabled={busy || uploading}
        >
          {busy || uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.nextText}>{step === 2 ? 'Create community' : 'Next'}</Text>
          )}
        </Pressable>
      </SafeBottomBar>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    steps: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: spacing(4),
      paddingTop: spacing(3),
      paddingBottom: spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    stepItem: { alignItems: 'center', gap: 6, flex: 1 },
    dot: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotOn: { backgroundColor: colors.primary },
    dotDone: { backgroundColor: colors.primary },
    dotNum: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
    dotNumOn: { color: '#fff' },
    stepLabel: { color: colors.textFaint, fontSize: font.tiny, fontWeight: '600' },
    stepLabelOn: { color: colors.primary },
    scroll: { padding: spacing(5), paddingBottom: spacing(8) },
    hero: {
      color: colors.text,
      fontSize: font.title,
      fontWeight: '700',
      marginBottom: spacing(1.5),
    },
    heroSub: {
      color: colors.textMuted,
      fontSize: font.small,
      lineHeight: 20,
      marginBottom: spacing(5),
    },
    iconWrap: {
      alignSelf: 'center',
      marginBottom: spacing(5),
      position: 'relative',
    },
    icon: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cameraBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primaryDark,
      borderWidth: 2,
      borderColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    uploadSpinner: { position: 'absolute', alignSelf: 'center', top: 36 },
    fieldLabel: {
      color: colors.primary,
      fontSize: font.small,
      fontWeight: '600',
      marginBottom: spacing(1.5),
    },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.md,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3.5),
      fontSize: font.body,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    desc: { minHeight: 120, textAlignVertical: 'top' },
    hint: {
      color: colors.textFaint,
      fontSize: font.tiny,
      textAlign: 'right',
      marginTop: spacing(1),
    },
    reviewCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing(5),
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    reviewIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(3),
    },
    reviewName: {
      color: colors.text,
      fontSize: font.heading,
      fontWeight: '700',
      textAlign: 'center',
    },
    reviewDesc: {
      color: colors.textMuted,
      fontSize: font.small,
      textAlign: 'center',
      marginTop: spacing(2),
      lineHeight: 20,
    },
    reviewSeed: {
      alignSelf: 'stretch',
      marginTop: spacing(4),
      gap: spacing(2),
    },
    seedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surfaceAlt,
      padding: spacing(3),
      borderRadius: radius.md,
    },
    seedText: { color: colors.text, fontSize: font.body, fontWeight: '600' },
    footer: {
      flexDirection: 'row',
      gap: spacing(3),
      paddingHorizontal: spacing(4),
      paddingTop: spacing(2),
    },
    backBtn: {
      flex: 1,
      paddingVertical: spacing(3.5),
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
    },
    backText: { color: colors.text, fontWeight: '600', fontSize: font.body },
    nextBtn: {
      flex: 1.4,
      paddingVertical: spacing(3.5),
      borderRadius: radius.pill,
      backgroundColor: colors.primary,
      alignItems: 'center',
    },
    nextText: { color: '#fff', fontWeight: '700', fontSize: font.body },
    btnDisabled: { opacity: 0.55 },
  });
