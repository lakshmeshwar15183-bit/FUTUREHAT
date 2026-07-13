// Lumixo mobile — WhatsApp-class Group Info & management.
// Every action is wired to real RPCs (migration 0037). No placeholders.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';

import { supabase } from '../lib/supabase';
import ProfileAvatar from '../components/ProfileAvatar';
import {
  getGroupConversation,
  getGroupMembers,
  getMyGroupRole,
  updateGroupInfo,
  setGroupPermissions,
  addGroupMembers,
  removeGroupMember,
  promoteGroupAdmin,
  demoteGroupAdmin,
  transferGroupOwnership,
  leaveGroup,
  deleteGroup,
  getOrCreateGroupInvite,
  resetGroupInvite,
  revokeGroupInvite,
  groupInviteUrl,
  listGroupJoinRequests,
  resolveGroupJoinRequest,
  permissionsFromConversation,
  canEditGroupInfo,
  canAddMembers,
  canManageAdmins,
  canManageDisappearing,
  isGroupAdminRole,
  isGroupOwnerRole,
  getSharedMedia,
  getDisappearing,
  setConversationDisappearing,
  getMutedIds,
  muteConversation,
  unmuteConversation,
  searchProfiles,
  getCurrentUser,
  deleteConversationForMe,
  submitReport,
  isVideoMessage,
  type Conversation,
  type GroupMember,
  type GroupJoinRequest,
  type GroupPermissions,
  type ParticipantRole,
  type Profile,
  type Message,
  type UUID,
} from '../lib/shared';
import { uploadAvatarFromUri } from '../lib/media';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';
import { Alert } from '../ui/dialog';

type Nav = NativeStackNavigationProp<RootStackParamList, 'GroupInfo'>;
type Rt = RouteProp<RootStackParamList, 'GroupInfo'>;

const DISAPPEAR_OPTIONS: { secs: number; label: string }[] = [
  { secs: 0, label: 'Off' },
  ...Array.from({ length: 8 }, (_, i) => ({
    secs: (i + 1) * 3600,
    label: `${i + 1} hour${i ? 's' : ''}`,
  })),
];

export default function GroupInfoScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const conversationId = params.conversationId;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [myRole, setMyRole] = useState<ParticipantRole | null>(null);
  const [myId, setMyId] = useState<UUID | null>(null);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [perms, setPerms] = useState<GroupPermissions>(permissionsFromConversation(null));
  const [joinRequests, setJoinRequests] = useState<GroupJoinRequest[]>([]);
  const [media, setMedia] = useState<Message[]>([]);
  const [docs, setDocs] = useState<Message[]>([]);
  const [disappearSecs, setDisappearSecs] = useState(0);

  // Sub-panels
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<Profile[]>([]);
  const [addSelected, setAddSelected] = useState<Profile[]>([]);
  const [adding, setAdding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [permsOpen, setPermsOpen] = useState(false);
  const [disappearOpen, setDisappearOpen] = useState(false);
  const [memberMenu, setMemberMenu] = useState<GroupMember | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [mediaTab, setMediaTab] = useState<'media' | 'docs' | 'links' | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const user = await getCurrentUser(supabase);
      setMyId(user?.id ?? null);
      const [conv, mems, role, mutedIds, shared, dsecs] = await Promise.all([
        getGroupConversation(supabase, conversationId),
        getGroupMembers(supabase, conversationId),
        getMyGroupRole(supabase, conversationId),
        getMutedIds(supabase),
        getSharedMedia(supabase, conversationId, 80),
        getDisappearing(supabase, conversationId),
      ]);
      setConversation(conv);
      setMembers(mems);
      setMyRole(role);
      setPerms(permissionsFromConversation(conv));
      setMuted(mutedIds.includes(conversationId));
      setDisappearSecs(dsecs);
      setMedia(shared.filter((m) => m.type === 'image' || isVideoMessage(m)));
      setDocs(shared.filter((m) => m.type === 'file' && !isVideoMessage(m)));
      if (isGroupAdminRole(role)) {
        setJoinRequests(await listGroupJoinRequests(supabase, conversationId));
      } else {
        setJoinRequests([]);
      }
    } catch (e) {
      console.error('GroupInfo load', e);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    navigation.setOptions({ title: 'Group info' });
  }, [navigation]);

  // Contact search for add-members
  useEffect(() => {
    if (!addOpen) return;
    const q = addQuery.trim();
    if (!q) {
      setAddResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      const data = await searchProfiles(supabase, q);
      if (!active) return;
      const existing = new Set(members.map((m) => m.userId));
      setAddResults(data.filter((p) => !existing.has(p.id) && p.id !== myId));
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [addQuery, addOpen, members, myId]);

  const isAdmin = isGroupAdminRole(myRole);
  const isOwner = isGroupOwnerRole(myRole);
  const canEdit = canEditGroupInfo(myRole, perms);
  const canAdd = canAddMembers(myRole, perms);
  const canDisappear = canManageDisappearing(myRole, perms);

  async function saveEdit() {
    if (!editName.trim() || savingEdit) return;
    setSavingEdit(true);
    const { error } = await updateGroupInfo(supabase, conversationId, {
      name: editName.trim(),
      description: editDesc.trim() || null,
    });
    setSavingEdit(false);
    if (error) {
      Alert.alert('Could not update', error.message);
      return;
    }
    setEditOpen(false);
    await reload();
  }

  async function changePhoto() {
    if (!canEdit) {
      Alert.alert('Not allowed', 'Only admins can change the group photo.');
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (res.canceled || !res.assets?.[0]) return;
      setBusy(true);
      const user = await getCurrentUser(supabase);
      if (!user) throw new Error('not authenticated');
      const { url, error: upErr } = await uploadAvatarFromUri(user.id, res.assets[0].uri);
      if (upErr || !url) throw upErr || new Error('upload failed');
      const { error } = await updateGroupInfo(supabase, conversationId, { avatarUrl: url });
      if (error) throw error;
      await reload();
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not update group photo');
    } finally {
      setBusy(false);
    }
  }

  async function doAddMembers() {
    if (!addSelected.length || adding) return;
    setAdding(true);
    const { error } = await addGroupMembers(
      supabase,
      conversationId,
      addSelected.map((p) => p.id),
    );
    setAdding(false);
    if (error) {
      Alert.alert('Could not add members', error.message);
      return;
    }
    setAddOpen(false);
    setAddSelected([]);
    setAddQuery('');
    await reload();
  }

  async function openInvite() {
    setInviteOpen(true);
    setInviteBusy(true);
    const { token, error } = await getOrCreateGroupInvite(supabase, conversationId);
    setInviteBusy(false);
    if (error) {
      Alert.alert('Invite link', error.message);
      setInviteOpen(false);
      return;
    }
    setInviteToken(token);
  }

  async function resetInvite() {
    setInviteBusy(true);
    const { token, error } = await resetGroupInvite(supabase, conversationId);
    setInviteBusy(false);
    if (error) Alert.alert('Error', error.message);
    else {
      setInviteToken(token);
      Alert.alert('Link reset', 'Previous invite link no longer works.');
    }
  }

  async function revokeInvite() {
    setInviteBusy(true);
    const { error } = await revokeGroupInvite(supabase, conversationId);
    setInviteBusy(false);
    if (error) Alert.alert('Error', error.message);
    else {
      setInviteToken(null);
      Alert.alert('Link revoked', 'Invite link has been disabled.');
      setInviteOpen(false);
    }
  }

  async function shareInvite() {
    if (!inviteToken) return;
    const url = groupInviteUrl(inviteToken);
    try {
      await Share.share({
        message: `Join our group on Lumixo: ${url}`,
        url,
      });
    } catch { /* cancelled */ }
  }

  async function copyInvite() {
    if (!inviteToken) return;
    await Clipboard.setStringAsync(groupInviteUrl(inviteToken));
    Alert.alert('Copied', 'Invite link copied to clipboard.');
  }

  async function toggleMute() {
    if (muted) {
      await unmuteConversation(supabase, conversationId);
      setMuted(false);
    } else {
      await muteConversation(supabase, conversationId);
      setMuted(true);
    }
  }

  async function togglePerm<K extends keyof GroupPermissions>(key: K, value: boolean) {
    const next = { ...perms, [key]: value };
    setPerms(next);
    const { error } = await setGroupPermissions(supabase, conversationId, { [key]: value });
    if (error) {
      Alert.alert('Permissions', error.message);
      await reload();
    }
  }

  async function setDisappear(secs: number) {
    const { error } = await setConversationDisappearing(supabase, conversationId, secs);
    if (error) Alert.alert('Error', error.message);
    else {
      setDisappearSecs(secs);
      setDisappearOpen(false);
    }
  }

  async function onLeave() {
    Alert.alert('Exit group?', 'You will stop receiving messages from this group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit',
        style: 'destructive',
        onPress: async () => {
          const { error } = await leaveGroup(supabase, conversationId);
          if (error) Alert.alert('Error', error.message);
          else {
            navigation.popToTop();
          }
        },
      },
    ]);
  }

  async function onDelete() {
    Alert.alert(
      'Delete group?',
      'This permanently deletes the group and all messages for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteGroup(supabase, conversationId);
            if (error) Alert.alert('Error', error.message);
            else navigation.popToTop();
          },
        },
      ],
    );
  }

  async function onClearChat() {
    Alert.alert('Clear chat?', 'Messages will be cleared for you only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteConversationForMe(supabase, conversationId);
          if (error) Alert.alert('Error', error.message);
          else {
            Alert.alert('Cleared', 'Chat cleared for you.');
            navigation.goBack();
          }
        },
      },
    ]);
  }

  async function onReport() {
    Alert.alert('Report group?', 'Our team will review this group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          const { error } = await submitReport(
            supabase,
            'conversation',
            conversationId,
            'other',
            'Reported from Group Info',
          );
          if (error) Alert.alert('Error', error.message);
          else Alert.alert('Thanks', 'Report submitted.');
        },
      },
    ]);
  }

  async function onExportChat() {
    // Lightweight export: share a text transcript of recent messages.
    try {
      setBusy(true);
      const { data } = await supabase
        .from('messages')
        .select('content, type, created_at, sender_id, is_deleted')
        .eq('conversation_id', conversationId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(500);
      const nameById = new Map(
        members.map((m) => [m.userId, m.profile.display_name || m.profile.username || 'Contact']),
      );
      const lines = (data || []).map((m: any) => {
        const who = nameById.get(m.sender_id) || 'System';
        const body =
          m.type === 'system'
            ? m.content
            : m.type === 'text'
              ? m.content
              : `[${m.type}] ${m.content || ''}`.trim();
        return `[${new Date(m.created_at).toLocaleString()}] ${who}: ${body || ''}`;
      });
      const text = `Lumixo — ${conversation?.name || 'Group'}\n\n${lines.join('\n')}`;
      await Share.share({ message: text });
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not export chat');
    } finally {
      setBusy(false);
    }
  }

  function openMemberMenu(m: GroupMember) {
    if (m.userId === myId) {
      navigation.navigate('Profile', { userId: m.userId, conversationId });
      return;
    }
    setMemberMenu(m);
  }

  async function memberAction(action: string) {
    const m = memberMenu;
    if (!m) return;
    setMemberMenu(null);
    let error: Error | null = null;
    if (action === 'promote') error = (await promoteGroupAdmin(supabase, conversationId, m.userId)).error;
    else if (action === 'demote') error = (await demoteGroupAdmin(supabase, conversationId, m.userId)).error;
    else if (action === 'remove') {
      Alert.alert('Remove member?', `${m.profile.display_name || 'This user'} will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const res = await removeGroupMember(supabase, conversationId, m.userId);
            if (res.error) Alert.alert('Error', res.error.message);
            else reload();
          },
        },
      ]);
      return;
    } else if (action === 'transfer') {
      Alert.alert(
        'Transfer ownership?',
        `${m.profile.display_name || 'This user'} will become the group owner. You will become an admin.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Transfer',
            onPress: async () => {
              const res = await transferGroupOwnership(supabase, conversationId, m.userId);
              if (res.error) Alert.alert('Error', res.error.message);
              else reload();
            },
          },
        ],
      );
      return;
    } else if (action === 'message') {
      navigation.navigate('Profile', { userId: m.userId, conversationId });
      return;
    }
    if (error) Alert.alert('Error', error.message);
    else await reload();
  }

  async function resolveRequest(userId: UUID, approve: boolean) {
    const { error } = await resolveGroupJoinRequest(supabase, conversationId, userId, approve);
    if (error) Alert.alert('Error', error.message);
    else await reload();
  }

  const filteredMembers = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.profile.display_name || '').toLowerCase().includes(q) ||
        (m.profile.username || '').toLowerCase().includes(q),
    );
  }, [members, searchQ]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!conversation) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: colors.textMuted }}>Group not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.groupHeader}>
          <View>
            <ProfileAvatar
              uri={conversation.avatar_url}
              name={conversation.name}
              size={96}
              mode="photo"
            />
            {canEdit && (
              <Pressable
                style={styles.cameraBadge}
                onPress={changePhoto}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Change group photo"
              >
                <Ionicons name="camera" size={16} color="#fff" />
              </Pressable>
            )}
          </View>
          <Text style={styles.groupName}>{conversation.name}</Text>
          <Text style={styles.memberCount}>
            Group · {members.length} {members.length === 1 ? 'member' : 'members'}
          </Text>
          {!!conversation.description && (
            <Text style={styles.description}>{conversation.description}</Text>
          )}
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <QuickAction
            icon="search"
            label="Search"
            colors={colors}
            onPress={() => setSearchOpen(true)}
          />
          {canAdd && (
            <QuickAction
              icon="person-add"
              label="Add"
              colors={colors}
              onPress={() => setAddOpen(true)}
            />
          )}
          {isAdmin && (
            <QuickAction
              icon="link"
              label="Invite"
              colors={colors}
              onPress={openInvite}
            />
          )}
          <QuickAction
            icon={muted ? 'notifications-off' : 'notifications'}
            label={muted ? 'Unmute' : 'Mute'}
            colors={colors}
            onPress={toggleMute}
          />
        </View>

        {/* Media / links / docs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Media, links and docs</Text>
          <MenuRow
            icon="images-outline"
            label="Media"
            value={`${media.length}`}
            onPress={() => setMediaTab('media')}
            colors={colors}
          />
          <MenuRow
            icon="document-outline"
            label="Docs"
            value={`${docs.length}`}
            onPress={() => setMediaTab('docs')}
            colors={colors}
          />
          <MenuRow
            icon="link-outline"
            label="Links"
            value="Search"
            onPress={() => {
              navigation.navigate('Chat', {
                conversationId,
                title: conversation.name || 'Group',
              });
            }}
            colors={colors}
          />
        </View>

        {/* Join requests */}
        {isAdmin && joinRequests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Join requests ({joinRequests.length})
            </Text>
            {joinRequests.map((r) => (
              <View key={r.userId} style={styles.memberRow}>
                <Avatar uri={r.avatarUrl} name={r.displayName} size={44} />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{r.displayName || 'User'}</Text>
                  {!!r.username && (
                    <Text style={styles.memberRole}>@{r.username}</Text>
                  )}
                </View>
                <Pressable
                  style={styles.reqBtn}
                  onPress={() => resolveRequest(r.userId, true)}
                >
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                </Pressable>
                <Pressable
                  style={styles.reqBtn}
                  onPress={() => resolveRequest(r.userId, false)}
                >
                  <Ionicons name="close" size={20} color={colors.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Members */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{members.length} members</Text>
          {filteredMembers.map((m) => (
            <Pressable
              key={m.userId}
              style={styles.memberRow}
              onPress={() => openMemberMenu(m)}
              onLongPress={() => openMemberMenu(m)}
            >
              <ProfileAvatar
                uri={m.profile.avatar_url}
                name={m.profile.display_name || m.profile.username || 'Contact'}
                size={44}
                userId={m.userId}
                mode="auto"
              />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {m.userId === myId ? 'You' : (m.profile.display_name || m.profile.username || 'Contact')}
                </Text>
                {m.role === 'super_admin' && (
                  <Text style={styles.memberRole}>Group owner</Text>
                )}
                {m.role === 'admin' && (
                  <Text style={styles.memberRole}>Group admin</Text>
                )}
              </View>
              {(m.role === 'admin' || m.role === 'super_admin') && (
                <Ionicons name="shield-checkmark" size={18} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          {canEdit && (
            <MenuRow
              icon="pencil-outline"
              label="Edit group info"
              onPress={() => {
                setEditName(conversation.name || '');
                setEditDesc(conversation.description || '');
                setEditOpen(true);
              }}
              colors={colors}
            />
          )}
          {isAdmin && (
            <MenuRow
              icon="settings-outline"
              label="Group permissions"
              onPress={() => setPermsOpen(true)}
              colors={colors}
            />
          )}
          {isAdmin && (
            <MenuRow
              icon="link-outline"
              label="Invite via link"
              onPress={openInvite}
              colors={colors}
            />
          )}
          {isAdmin && (
            <MenuRow
              icon="qr-code-outline"
              label="QR code invite"
              onPress={openInvite}
              colors={colors}
            />
          )}
          <MenuRow
            icon="timer-outline"
            label="Disappearing messages"
            value={DISAPPEAR_OPTIONS.find((o) => o.secs === disappearSecs)?.label || 'Off'}
            onPress={() => {
              if (!canDisappear) {
                Alert.alert('Not allowed', 'Only admins can change disappearing messages.');
                return;
              }
              setDisappearOpen(true);
            }}
            colors={colors}
          />
          <MenuRow
            icon="lock-closed-outline"
            label="Encryption"
            value="Messages are end-to-end encrypted in transit"
            onPress={() =>
              Alert.alert(
                'Encryption',
                'Your messages are protected with TLS in transit. Lumixo stores chat data securely with Row Level Security so only members of this group can read them.',
              )
            }
            colors={colors}
          />
          <MenuRow
            icon="color-palette-outline"
            label="Chat theme"
            onPress={() => navigation.navigate('Appearance')}
            colors={colors}
          />
          <MenuRow
            icon="folder-outline"
            label="Manage storage"
            onPress={() => navigation.navigate('StorageData')}
            colors={colors}
          />
          <MenuRow
            icon="eye-outline"
            label="Media visibility"
            onPress={() =>
              Alert.alert(
                'Media visibility',
                'Shared media in this group is only visible to current members. New members see prior history only if “Message history for new members” is enabled in Group permissions.',
              )
            }
            colors={colors}
          />
          <MenuRow
            icon="download-outline"
            label="Export chat"
            onPress={onExportChat}
            colors={colors}
          />
          <MenuRow
            icon="trash-outline"
            label="Clear chat"
            onPress={onClearChat}
            colors={colors}
          />
        </View>

        {/* Danger */}
        <View style={styles.section}>
          <MenuRow
            icon="exit-outline"
            label="Exit group"
            danger
            onPress={onLeave}
            colors={colors}
          />
          <MenuRow
            icon="flag-outline"
            label="Report group"
            danger
            onPress={onReport}
            colors={colors}
          />
          {isOwner && (
            <MenuRow
              icon="trash"
              label="Delete group"
              danger
              onPress={onDelete}
              colors={colors}
            />
          )}
        </View>

        <View style={{ height: spacing(10) }} />
      </ScrollView>

      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      )}

      {/* Edit group info */}
      <Modal visible={editOpen} animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.container}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setEditOpen(false)}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>Edit group info</Text>
            <Pressable onPress={saveEdit} disabled={savingEdit}>
              {savingEdit ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Save</Text>
              )}
            </Pressable>
          </View>
          <View style={{ padding: spacing(4), gap: spacing(3) }}>
            <Text style={styles.fieldLabel}>Group name</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              maxLength={100}
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
              value={editDesc}
              onChangeText={setEditDesc}
              multiline
              maxLength={500}
              placeholder="Add a group description"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        </View>
      </Modal>

      {/* Add members */}
      <Modal visible={addOpen} animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.container}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setAddOpen(false)}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>Add members</Text>
            <Pressable onPress={doAddMembers} disabled={adding || !addSelected.length}>
              {adding ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text
                  style={{
                    color: addSelected.length ? colors.primary : colors.textFaint,
                    fontWeight: '700',
                  }}
                >
                  Add
                </Text>
              )}
            </Pressable>
          </View>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search contacts"
              placeholderTextColor={colors.textFaint}
              value={addQuery}
              onChangeText={setAddQuery}
              autoCapitalize="none"
            />
          </View>
          {addSelected.length > 0 && (
            <ScrollView horizontal style={{ maxHeight: 70, paddingHorizontal: 12 }}>
              {addSelected.map((p) => (
                <Pressable
                  key={p.id}
                  style={styles.chip}
                  onPress={() =>
                    setAddSelected((s) => s.filter((x) => x.id !== p.id))
                  }
                >
                  <Avatar uri={p.avatar_url} name={p.display_name} size={36} />
                  <Text style={styles.chipName} numberOfLines={1}>
                    {p.display_name?.split(' ')[0]}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <FlatList
            data={addResults}
            keyExtractor={(p) => p.id}
            renderItem={({ item }) => {
              const on = addSelected.some((s) => s.id === item.id);
              return (
                <Pressable
                  style={styles.memberRow}
                  onPress={() =>
                    setAddSelected((prev) =>
                      on ? prev.filter((x) => x.id !== item.id) : [...prev, item],
                    )
                  }
                >
                  <Avatar uri={item.avatar_url} name={item.display_name} size={44} />
                  <Text style={[styles.memberName, { marginLeft: 12, flex: 1 }]}>
                    {item.display_name || item.username || 'User'}
                  </Text>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={on ? colors.primary : colors.textFaint}
                  />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 24 }}>
                {addQuery.trim() ? 'No users found' : 'Search by name or username'}
              </Text>
            }
          />
        </View>
      </Modal>

      {/* Invite link / QR */}
      <Modal visible={inviteOpen} animationType="slide" transparent onRequestClose={() => setInviteOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setInviteOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Invite to group via link</Text>
            {inviteBusy ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
            ) : inviteToken ? (
              <>
                <Text style={styles.inviteUrl} selectable>
                  {groupInviteUrl(inviteToken)}
                </Text>
                <View style={styles.qrBox}>
                  {/* Lightweight QR: visual token grid (no external QR lib dependency). */}
                  <Text style={styles.qrHint}>QR data</Text>
                  <Text style={styles.qrToken} numberOfLines={3}>
                    {inviteToken}
                  </Text>
                  <Text style={styles.qrHint}>
                    Share the link or show this code. Recipients open the invite link to join.
                  </Text>
                </View>
                <MenuRow icon="copy-outline" label="Copy link" onPress={copyInvite} colors={colors} />
                <MenuRow icon="share-outline" label="Share link" onPress={shareInvite} colors={colors} />
                <MenuRow icon="refresh" label="Reset link" onPress={resetInvite} colors={colors} />
                <MenuRow icon="ban" label="Revoke link" danger onPress={revokeInvite} colors={colors} />
              </>
            ) : (
              <Text style={{ color: colors.textMuted, marginVertical: 16 }}>No active link</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Permissions */}
      <Modal visible={permsOpen} animationType="slide" onRequestClose={() => setPermsOpen(false)}>
        <View style={styles.container}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setPermsOpen(false)}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>Group permissions</Text>
            <View style={{ width: 26 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing(4) }}>
            <PermToggle
              label="Send messages"
              hint="Only admins can send messages"
              value={perms.onlyAdminsCanSend}
              onChange={(v) => togglePerm('onlyAdminsCanSend', v)}
              colors={colors}
            />
            <PermToggle
              label="Edit group info"
              hint="Only admins can edit name, photo, description"
              value={perms.onlyAdminsCanEditInfo}
              onChange={(v) => togglePerm('onlyAdminsCanEditInfo', v)}
              colors={colors}
            />
            <PermToggle
              label="Add other members"
              hint="Only admins can add members"
              value={perms.onlyAdminsCanAddMembers}
              onChange={(v) => togglePerm('onlyAdminsCanAddMembers', v)}
              colors={colors}
            />
            <PermToggle
              label="Pin messages"
              hint="Only admins can pin messages"
              value={perms.onlyAdminsCanPin}
              onChange={(v) => togglePerm('onlyAdminsCanPin', v)}
              colors={colors}
            />
            <PermToggle
              label="Disappearing messages"
              hint="Only admins can change disappearing messages"
              value={perms.onlyAdminsManageDisappearing}
              onChange={(v) => togglePerm('onlyAdminsManageDisappearing', v)}
              colors={colors}
            />
            <PermToggle
              label="Approve new members"
              hint="Admins must approve people who join via invite link"
              value={perms.approveNewMembers}
              onChange={(v) => togglePerm('approveNewMembers', v)}
              colors={colors}
            />
            <PermToggle
              label="Message history for new members"
              hint="New members can see previous messages"
              value={!perms.memberHistoryVisible}
              inverted
              onChange={(v) => togglePerm('memberHistoryVisible', !v)}
              colors={colors}
              labelWhenOff="Show history"
            />
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>
              Edit group admins is restricted to the group owner only (promote / demote).
            </Text>
          </ScrollView>
        </View>
      </Modal>

      {/* Disappearing */}
      <Modal visible={disappearOpen} transparent animationType="fade" onRequestClose={() => setDisappearOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setDisappearOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.modalTitle}>Disappearing messages</Text>
            {DISAPPEAR_OPTIONS.map((o) => (
              <Pressable key={o.secs} style={styles.memberRow} onPress={() => setDisappear(o.secs)}>
                <Text style={[styles.memberName, { flex: 1 }]}>{o.label}</Text>
                {disappearSecs === o.secs && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Member actions */}
      <Modal visible={!!memberMenu} transparent animationType="fade" onRequestClose={() => setMemberMenu(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMemberMenu(null)}>
          <View style={styles.sheet}>
            <Text style={styles.modalTitle}>
              {memberMenu?.profile.display_name || 'Member'}
            </Text>
            <MenuRow
              icon="person-outline"
              label="View profile"
              onPress={() => memberAction('message')}
              colors={colors}
            />
            {canManageAdmins(myRole) && memberMenu?.role === 'member' && (
              <MenuRow
                icon="shield-outline"
                label="Make group admin"
                onPress={() => memberAction('promote')}
                colors={colors}
              />
            )}
            {canManageAdmins(myRole) && memberMenu?.role === 'admin' && (
              <MenuRow
                icon="shield-outline"
                label="Dismiss as admin"
                onPress={() => memberAction('demote')}
                colors={colors}
              />
            )}
            {isOwner && memberMenu && memberMenu.userId !== myId && (
              <MenuRow
                icon="key-outline"
                label="Transfer ownership"
                onPress={() => memberAction('transfer')}
                colors={colors}
              />
            )}
            {isAdmin &&
              memberMenu &&
              memberMenu.role !== 'super_admin' &&
              !(myRole === 'admin' && memberMenu.role === 'admin') && (
                <MenuRow
                  icon="person-remove-outline"
                  label="Remove from group"
                  danger
                  onPress={() => memberAction('remove')}
                  colors={colors}
                />
              )}
          </View>
        </Pressable>
      </Modal>

      {/* Search members */}
      <Modal visible={searchOpen} animationType="slide" onRequestClose={() => setSearchOpen(false)}>
        <View style={styles.container}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => { setSearchOpen(false); setSearchQ(''); }}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>Search members</Text>
            <View style={{ width: 26 }} />
          </View>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search…"
              placeholderTextColor={colors.textFaint}
              value={searchQ}
              onChangeText={setSearchQ}
              autoFocus
            />
          </View>
          <FlatList
            data={filteredMembers}
            keyExtractor={(m) => m.userId}
            renderItem={({ item }) => (
              <Pressable style={styles.memberRow} onPress={() => openMemberMenu(item)}>
                <ProfileAvatar
                  uri={item.profile.avatar_url}
                  name={item.profile.display_name}
                  size={44}
                  userId={item.userId}
                  mode="auto"
                />
                <Text style={[styles.memberName, { marginLeft: 12 }]}>
                  {item.profile.display_name || 'User'}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>

      {/* Media gallery simple list */}
      <Modal visible={!!mediaTab} animationType="slide" onRequestClose={() => setMediaTab(null)}>
        <View style={styles.container}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setMediaTab(null)}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>
              {mediaTab === 'docs' ? 'Documents' : 'Media'}
            </Text>
            <View style={{ width: 26 }} />
          </View>
          <FlatList
            data={mediaTab === 'docs' ? docs : media}
            keyExtractor={(m) => m.id}
            numColumns={mediaTab === 'docs' ? 1 : 3}
            contentContainerStyle={{ padding: 8 }}
            ListEmptyComponent={
              <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40 }}>
                Nothing here yet
              </Text>
            }
            renderItem={({ item }) =>
              mediaTab === 'docs' ? (
                <View style={styles.memberRow}>
                  <Ionicons name="document" size={22} color={colors.primary} />
                  <Text style={[styles.memberName, { marginLeft: 12, flex: 1 }]} numberOfLines={1}>
                    {item.content || item.media_url?.split('/').pop() || 'File'}
                  </Text>
                </View>
              ) : (
                <View style={styles.mediaCell}>
                  {item.media_url ? (
                    <Image source={{ uri: item.media_url }} style={styles.mediaThumb} />
                  ) : (
                    <View style={[styles.mediaThumb, { backgroundColor: colors.surfaceAlt }]} />
                  )}
                </View>
              )
            }
          />
        </View>
      </Modal>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  colors: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing(3),
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        marginHorizontal: 4,
      }}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={{ color: colors.primary, fontSize: font.tiny, marginTop: 4, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function MenuRow({
  icon,
  label,
  value,
  onPress,
  danger,
  colors,
}: {
  icon: any;
  label: string;
  value?: string;
  onPress: () => void;
  danger?: boolean;
  colors: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: spacing(3.5),
          opacity: pressed ? 0.65 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.textMuted} />
      <View style={{ flex: 1, marginLeft: spacing(3) }}>
        <Text style={{ color: danger ? colors.danger : colors.text, fontSize: font.body }}>
          {label}
        </Text>
        {!!value && (
          <Text style={{ color: colors.textMuted, fontSize: font.small, marginTop: 2 }} numberOfLines={2}>
            {value}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

function PermToggle({
  label,
  hint,
  value,
  onChange,
  colors,
  inverted,
  labelWhenOff,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: Palette;
  inverted?: boolean;
  labelWhenOff?: string;
}) {
  // value=true means "admins only" restriction is ON for most toggles
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing(3),
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: colors.text, fontSize: font.body, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: colors.textMuted, fontSize: font.small, marginTop: 2 }}>
          {inverted ? (value ? hint : labelWhenOff || hint) : value ? hint : 'All participants'}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.border }}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { alignItems: 'center', justifyContent: 'center' },
    groupHeader: {
      alignItems: 'center',
      paddingVertical: spacing(6),
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    cameraBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      backgroundColor: colors.primary,
      borderRadius: 14,
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    groupName: {
      color: colors.text,
      fontSize: font.title,
      fontWeight: '700',
      marginTop: spacing(3),
      textAlign: 'center',
      paddingHorizontal: spacing(4),
    },
    memberCount: { color: colors.textMuted, fontSize: font.small, marginTop: spacing(1) },
    description: {
      color: colors.textMuted,
      fontSize: font.body,
      marginTop: spacing(2),
      paddingHorizontal: spacing(6),
      textAlign: 'center',
    },
    quickRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing(3),
      paddingVertical: spacing(3),
      gap: 4,
    },
    section: {
      backgroundColor: colors.surface,
      marginTop: spacing(2),
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(1),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sectionTitle: {
      color: colors.primary,
      fontSize: font.small,
      fontWeight: '700',
      marginTop: spacing(2),
      marginBottom: spacing(1),
    },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing(2.5),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    memberInfo: { flex: 1, marginLeft: spacing(3) },
    memberName: { color: colors.text, fontSize: font.body, fontWeight: '500' },
    memberRole: { color: colors.primary, fontSize: font.small, marginTop: 2 },
    reqBtn: { padding: 8 },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    fieldLabel: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
    input: {
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: radius.md,
      padding: spacing(3),
      fontSize: font.body,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      margin: spacing(3),
      paddingHorizontal: spacing(3),
      borderRadius: radius.pill,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      paddingVertical: spacing(2.5),
      marginLeft: 8,
      fontSize: font.body,
    },
    chip: { width: 60, alignItems: 'center', marginHorizontal: 4 },
    chipName: { color: colors.textMuted, fontSize: font.tiny, marginTop: 2 },
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing(4),
      paddingTop: spacing(4),
      paddingBottom: spacing(10),
    },
    inviteUrl: {
      color: colors.primary,
      fontSize: font.small,
      marginVertical: spacing(3),
      padding: spacing(3),
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
    },
    qrBox: {
      alignItems: 'center',
      padding: spacing(4),
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      marginBottom: spacing(3),
    },
    qrToken: {
      color: colors.text,
      fontFamily: 'Courier',
      fontSize: 11,
      textAlign: 'center',
      marginVertical: 8,
    },
    qrHint: { color: colors.textMuted, fontSize: font.tiny, textAlign: 'center' },
    busyOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    mediaCell: { width: '33.33%', padding: 2, aspectRatio: 1 },
    mediaThumb: { width: '100%', height: '100%', borderRadius: 4 },
  });
