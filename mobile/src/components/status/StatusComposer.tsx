// Lumixo mobile — Status composer (WhatsApp-style).
// One modal that handles all three post types via an initial `mode`:
//   text  — typed status with background + text colour (emoji via keyboard)
//   media — pick photo/video (library or camera), preview, add a caption
//   audio — record a voice status or pick an audio file, preview
// Shows an upload state with retry, supports discard-before-post, and carries a
// per-post audience (Everyone / Contacts / Except / Only) that persists as the
// user's new default. Media privacy is enforced server-side (migration 0021).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video, Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import { supabase } from '../../lib/supabase';
import { createStatus, setStatusAudiencePref } from '../../lib/shared';
import type { StatusType, StatusAudience } from '../../lib/shared';
import { uploadStatusMediaFromUri } from '../../lib/media';
import { useColors, spacing, radius, font, type Palette } from '../../theme';
import AudiencePicker from './AudiencePicker';
import { Alert } from '../../ui/dialog';

export type ComposerMode = 'text' | 'media' | 'audio';

const BG_COLORS = ['#00A884', '#5B6EF5', '#E8638A', '#F7A948', '#9B6EF5', '#0B141A', '#D9544F'];
const TEXT_COLORS = ['#FFFFFF', '#0B141A', '#F7E017', '#FF6B6B', '#4FC3F7'];
const MAX_STATUS_BYTES = 16 * 1024 * 1024;

interface PickedMedia {
  uri: string;
  kind: 'image' | 'video' | 'audio';
  ext: string;
  mime?: string;
  durationMs?: number;
}

const AUDIENCE_LABEL: Record<StatusAudience, string> = {
  everyone: 'Everyone',
  contacts: 'My contacts',
  except: 'Contacts except…',
  only: 'Only selected',
};

export default function StatusComposer({
  visible,
  mode,
  uid,
  initialAudience,
  initialMembers,
  onClose,
  onPosted,
}: {
  visible: boolean;
  mode: ComposerMode;
  uid: string;
  initialAudience: StatusAudience;
  initialMembers: string[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [text, setText] = useState('');
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [textColor, setTextColor] = useState(TEXT_COLORS[0]);
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<StatusAudience>(initialAudience);
  const [members, setMembers] = useState<string[]>(initialMembers);
  const [pickerOpen, setPickerOpen] = useState(false);
  const startedRef = useRef(false);

  // Reset everything each open, then kick off the picker/camera for media/audio.
  useEffect(() => {
    if (!visible) { startedRef.current = false; return; }
    setText(''); setBg(BG_COLORS[0]); setTextColor(TEXT_COLORS[0]);
    setMedia(null); setCaption(''); setBusy(false); setError(null);
    setAudience(initialAudience); setMembers(initialMembers);
    if (!startedRef.current && mode === 'media') { startedRef.current = true; pickMedia(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Live recording timer.
  useEffect(() => {
    if (!recording) { setRecSecs(0); return; }
    const t = setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  async function pickMedia() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { if (!media) onClose(); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.7,
      videoMaxDuration: 30,
    });
    if (res.canceled || !res.assets?.length) { if (!media) onClose(); return; }
    acceptAsset(res.assets[0]);
  }

  async function openCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7, videoMaxDuration: 30 });
    if (res.canceled || !res.assets?.length) return;
    acceptAsset(res.assets[0]);
  }

  function acceptAsset(asset: ImagePicker.ImagePickerAsset) {
    if (asset.fileSize != null && asset.fileSize > MAX_STATUS_BYTES) {
      Alert.alert('File is too large', 'Please choose a status under 16 MB.');
      return;
    }
    const isVid = asset.type === 'video';
    setMedia({
      uri: asset.uri,
      kind: isVid ? 'video' : 'image',
      ext: isVid ? 'mp4' : 'jpg',
      mime: asset.mimeType,
      durationMs: asset.duration ? Math.round(asset.duration) : undefined,
    });
    setError(null);
  }

  async function pickAudioFile() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (a.size != null && a.size > MAX_STATUS_BYTES) {
      Alert.alert('File is too large', 'Please choose audio under 16 MB.');
      return;
    }
    const ext = (a.name?.split('.').pop() || 'm4a').toLowerCase();
    setMedia({ uri: a.uri, kind: 'audio', ext, mime: a.mimeType ?? 'audio/mp4' });
    setError(null);
  }

  async function startRecording() {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
    } catch {
      Alert.alert('Could not start recording', 'Please try again.');
    }
  }

  async function stopRecording(keep: boolean) {
    const rec = recording;
    if (!rec) return;
    setRecording(null);
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (keep && uri) {
        setMedia({ uri, kind: 'audio', ext: 'm4a', mime: 'audio/m4a', durationMs: recSecs * 1000 });
        setError(null);
      }
    } catch {
      // discard on failure
    }
  }

  function discardMedia() {
    setMedia(null);
    setCaption('');
    setError(null);
    if (mode !== 'text') onClose();
  }

  const commonOpts = () => ({
    audience,
    memberIds: audience === 'except' || audience === 'only' ? members : undefined,
  });

  async function persistAudienceDefault() {
    // Remember the choice as the new default (WhatsApp behaviour). Best-effort.
    setStatusAudiencePref(supabase, { audience, memberIds: members }).catch(() => {});
  }

  async function postText() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await createStatus(supabase, 'text', text.trim(), undefined, bg, {
      textColor,
      ...commonOpts(),
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    persistAudienceDefault();
    onPosted();
    onClose();
  }

  async function postMedia() {
    if (!media || busy) return;
    setBusy(true);
    setError(null);
    const { url, error: upErr } = await uploadStatusMediaFromUri(uid, media.uri, media.ext, media.mime);
    if (upErr || !url) {
      setBusy(false);
      setError(upErr?.message ?? 'Upload failed. Tap retry.');
      return;
    }
    const type: StatusType = media.kind; // 'image' | 'video' | 'audio'
    const { error: err } = await createStatus(supabase, type, undefined, url, bg, {
      caption: caption.trim() || undefined,
      durationMs: media.durationMs,
      ...commonOpts(),
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    persistAudienceDefault();
    onPosted();
    onClose();
  }

  // ── Audience chip (shared across all modes) ────────────────────────────────
  const AudienceChip = (
    <Pressable style={styles.audienceChip} onPress={() => setPickerOpen(true)}>
      <Ionicons name="eye-outline" size={16} color="#fff" />
      <Text style={styles.audienceChipText}>{AUDIENCE_LABEL[audience]}</Text>
      <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.8)" />
    </Pressable>
  );

  // ── Render per mode ────────────────────────────────────────────────────────
  function renderBody() {
    // Media/audio preview (once something is picked/recorded).
    if (media) {
      return (
        <View style={styles.previewRoot}>
          <View style={styles.previewStage}>
            {media.kind === 'image' && <Image source={{ uri: media.uri }} style={styles.previewMedia} resizeMode="contain" />}
            {media.kind === 'video' && (
              <Video source={{ uri: media.uri }} style={styles.previewMedia} resizeMode={ResizeMode.CONTAIN} useNativeControls shouldPlay={false} isMuted />
            )}
            {media.kind === 'audio' && (
              <View style={styles.audioPreview}>
                <Ionicons name="musical-notes" size={72} color="#fff" />
                <Text style={styles.audioPreviewText}>Audio ready to share</Text>
              </View>
            )}
            <Pressable style={styles.discardBtn} onPress={discardMedia} hitSlop={8}>
              <Ionicons name="trash-outline" size={22} color="#fff" />
            </Pressable>
          </View>

          <View style={styles.captionRow}>
            <TextInput
              style={styles.captionInput}
              placeholder="Add a caption…"
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={caption}
              onChangeText={setCaption}
              maxLength={300}
            />
          </View>

          <View style={styles.actionRow}>
            {AudienceChip}
            <Pressable style={[styles.postBtn, busy && styles.postBtnBusy]} onPress={postMedia} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name={error ? 'refresh' : 'send'} size={22} color="#fff" />}
            </Pressable>
          </View>
          {!!error && <Text style={styles.errorText}>{error} — tap the button to retry.</Text>}
        </View>
      );
    }

    // Audio mode, before a clip exists: record / pick file.
    if (mode === 'audio') {
      return (
        <View style={styles.audioRoot}>
          <Text style={styles.audioTitle}>Voice status</Text>
          {recording ? (
            <>
              <Text style={styles.recTimer}>{fmt(recSecs)}</Text>
              <View style={styles.recRow}>
                <Pressable style={styles.recCancel} onPress={() => stopRecording(false)}>
                  <Ionicons name="close" size={26} color="#fff" />
                </Pressable>
                <Pressable style={styles.recStop} onPress={() => stopRecording(true)}>
                  <Ionicons name="checkmark" size={30} color="#fff" />
                </Pressable>
              </View>
              <Text style={styles.audioHint}>Recording… tap ✓ to preview</Text>
            </>
          ) : (
            <>
              <Pressable style={styles.recBtn} onPress={startRecording}>
                <Ionicons name="mic" size={48} color="#fff" />
              </Pressable>
              <Text style={styles.audioHint}>Tap to record</Text>
              <Pressable style={styles.linkBtn} onPress={pickAudioFile}>
                <Ionicons name="document-outline" size={18} color={colors.primary} />
                <Text style={styles.linkText}>Upload an audio file</Text>
              </Pressable>
            </>
          )}
        </View>
      );
    }

    // Media mode without a pick yet (permission denied / cancelled): offer choices.
    if (mode === 'media') {
      return (
        <View style={styles.audioRoot}>
          <Pressable style={styles.recBtn} onPress={openCamera}>
            <Ionicons name="camera" size={44} color="#fff" />
          </Pressable>
          <Text style={styles.audioHint}>Take a photo or video</Text>
          <Pressable style={styles.linkBtn} onPress={pickMedia}>
            <Ionicons name="images-outline" size={18} color={colors.primary} />
            <Text style={styles.linkText}>Choose from gallery</Text>
          </Pressable>
        </View>
      );
    }

    // Text mode.
    return (
      <View style={[styles.textRoot, { backgroundColor: bg }]}>
        <TextInput
          style={[styles.textInput, { color: textColor }]}
          placeholder="Type a status"
          placeholderTextColor={textColor === '#FFFFFF' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.4)'}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={700}
          autoFocus
        />
        <View style={styles.swatchBlock}>
          <View style={styles.swatchRow}>
            {BG_COLORS.map((c) => (
              <Pressable key={c} onPress={() => setBg(c)} style={[styles.swatch, { backgroundColor: c }, bg === c && styles.swatchOn]} />
            ))}
          </View>
          <View style={styles.swatchRow}>
            <Text style={styles.swatchLabel}>Aa</Text>
            {TEXT_COLORS.map((c) => (
              <Pressable key={c} onPress={() => setTextColor(c)} style={[styles.swatch, styles.swatchSm, { backgroundColor: c }, textColor === c && styles.swatchOn]} />
            ))}
          </View>
        </View>
        <View style={styles.actionRow}>
          {AudienceChip}
          <Pressable style={[styles.postBtn, (!text.trim() || busy) && styles.postBtnBusy]} onPress={postText} disabled={!text.trim() || busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={22} color="#fff" />}
          </Pressable>
        </View>
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        {renderBody()}
      </View>
      <AudiencePicker
        visible={pickerOpen}
        audience={audience}
        memberIds={members}
        onClose={() => setPickerOpen(false)}
        onSave={(a, m) => { setAudience(a); setMembers(m); }}
      />
    </Modal>
  );
}

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    closeBtn: { position: 'absolute', top: spacing(12), left: spacing(5), zIndex: 10 },

    // text
    textRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
    textInput: { fontSize: 26, fontWeight: '600', textAlign: 'center', width: '100%', flex: 1, textAlignVertical: 'center' },
    swatchBlock: { position: 'absolute', bottom: spacing(24), gap: spacing(3), alignItems: 'center' },
    swatchRow: { flexDirection: 'row', gap: spacing(2.5), alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
    swatchLabel: { color: '#fff', fontSize: font.body, fontWeight: '700', marginRight: spacing(1) },
    swatch: { width: 30, height: 30, borderRadius: 15 },
    swatchSm: { width: 24, height: 24, borderRadius: 12 },
    swatchOn: { borderWidth: 3, borderColor: '#fff' },

    // shared action row
    actionRow: { position: 'absolute', bottom: spacing(8), left: spacing(5), right: spacing(5), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    audienceChip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing(1.5),
      backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: spacing(3), paddingVertical: spacing(2), borderRadius: 20,
    },
    audienceChipText: { color: '#fff', fontSize: font.small, fontWeight: '600' },
    postBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    postBtnBusy: { opacity: 0.6 },
    errorText: { position: 'absolute', bottom: spacing(20), alignSelf: 'center', color: '#FFB4B4', fontSize: font.small, textAlign: 'center', paddingHorizontal: spacing(6) },

    // preview
    previewRoot: { flex: 1 },
    previewStage: { flex: 1, backgroundColor: '#000', position: 'relative' },
    previewMedia: { flex: 1, width: '100%' },
    audioPreview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing(4), backgroundColor: '#5B6EF5' },
    audioPreviewText: { color: '#fff', fontSize: font.heading, fontWeight: '600' },
    discardBtn: { position: 'absolute', top: spacing(12), right: spacing(5), backgroundColor: 'rgba(0,0,0,0.5)', padding: spacing(2), borderRadius: 20 },
    captionRow: { position: 'absolute', bottom: spacing(20), left: spacing(4), right: spacing(4) },
    captionInput: {
      backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: font.body,
      borderRadius: radius.md, paddingHorizontal: spacing(4), paddingVertical: spacing(3),
    },

    // audio / media chooser
    audioRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing(4) },
    audioTitle: { color: '#fff', fontSize: font.title, fontWeight: '700', marginBottom: spacing(4) },
    recBtn: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    recTimer: { color: '#fff', fontSize: 44, fontWeight: '300', letterSpacing: 2 },
    recRow: { flexDirection: 'row', gap: spacing(8), marginTop: spacing(4) },
    recCancel: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    recStop: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
    audioHint: { color: 'rgba(255,255,255,0.8)', fontSize: font.body },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(6), padding: spacing(3) },
    linkText: { color: colors.primary, fontSize: font.body, fontWeight: '600' },
  });
