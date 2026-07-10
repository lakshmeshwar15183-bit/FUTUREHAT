// Lumixo mobile — Group info & settings (WhatsApp-style management screen).
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import type { Conversation, Profile } from '../lib/shared';
import { useColors, spacing, radius, font, type Palette } from '../theme';
import Avatar from '../components/Avatar';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'GroupInfo'>;

interface GroupMember {
  userId: string;
  name: string;
  avatar: string | null;
  role: 'admin' | 'member';
  joinedAt: string;
}

export default function GroupInfoScreen({
  conversation,
  isAdmin,
  onClose,
}: {
  conversation: Conversation;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [archived, setArchived] = useState(false);
  const [memberMenuOpen, setMemberMenuOpen] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<GroupMember | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      loadMembers();
    }, [conversation.id]),
  );

  async function loadMembers() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('user_id, role, joined_at')
        .eq('conversation_id', conversation.id);

      if (error) throw error;

      // Fetch profiles for each member
      const memberIds = data?.map((p) => p.user_id) || [];
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', memberIds);

      if (profileError) throw profileError;

      const membersWithProfile: GroupMember[] = (data || []).map((p) => {
        const profile = profiles?.find((prof) => prof.id === p.user_id);
        return {
          userId: p.user_id,
          name: profile?.display_name || 'Unknown User',
          avatar: profile?.avatar_url || null,
          role: p.role as 'admin' | 'member',
          joinedAt: p.joined_at,
        };
      });

      setMembers(membersWithProfile);
    } catch (err) {
      console.error('Error loading members:', err);
    } finally {
      setLoading(false);
    }
  }

  async function promoteToAdmin(memberId: string) {
    if (!isAdmin) return;
    try {
      const { error } = await supabase
        .from('conversation_participants')
        .update({ role: 'admin' })
        .eq('conversation_id', conversation.id)
        .eq('user_id', memberId);

      if (error) throw error;
      setMembers((prev) =>
        prev.map((m) => (m.userId === memberId ? { ...m, role: 'admin' } : m)),
      );
      setMemberMenuOpen(null);
    } catch (err) {
      Alert.alert('Error', 'Could not promote member');
    }
  }

  async function removeMember(memberId: string) {
    if (!isAdmin) return;
    Alert.alert('Remove member?', 'This user will be removed from the group.', [
      { text: 'Cancel' },
      {
        text: 'Remove',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('conversation_participants')
              .delete()
              .eq('conversation_id', conversation.id)
              .eq('user_id', memberId);

            if (error) throw error;
            setMembers((prev) => prev.filter((m) => m.userId !== memberId));
            setMemberMenuOpen(null);
          } catch (err) {
            Alert.alert('Error', 'Could not remove member');
          }
        },
      },
    ]);
  }

  const adminCount = members.filter((m) => m.role === 'admin').length;
  const memberCount = members.length;

  return (
    <Modal visible onRequestClose={onClose} animationType="slide">
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Group Info</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Group header */}
          <View style={styles.groupHeader}>
            <Avatar uri={conversation.avatar_url} name={conversation.name} size={80} />
            <Text style={styles.groupName}>{conversation.name}</Text>
            <Text style={styles.memberCount}>
              {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </Text>
          </View>

          {/* Quick actions */}
          <View style={styles.section}>
            <MenuItem
              icon="search"
              label="Search in group"
              onPress={() => {}}
              colors={colors}
            />
            {isAdmin && (
              <MenuItem
                icon="person-add"
                label="Add members"
                onPress={() => {}}
                colors={colors}
              />
            )}
            <MenuItem
              icon={muted ? 'notifications-off' : 'notifications-outline'}
              label={muted ? 'Unmute notifications' : 'Mute notifications'}
              onPress={() => setMuted(!muted)}
              colors={colors}
            />
            <MenuItem
              icon={archived ? 'archive' : 'archive-outline'}
              label={archived ? 'Unarchive' : 'Archive'}
              onPress={() => setArchived(!archived)}
              colors={colors}
            />
          </View>

          {/* Members section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Members ({memberCount})</Text>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing(4) }} />
            ) : (
              <FlatList
                data={members}
                keyExtractor={(m) => m.userId}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.memberRow}
                    onPress={() => {
                      setSelectedMember(item);
                      setMemberMenuOpen(item.userId);
                    }}
                  >
                    <Avatar uri={item.avatar} name={item.name} size={44} />
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>{item.name}</Text>
                      {item.role === 'admin' && (
                        <Text style={styles.memberRole}>Group admin</Text>
                      )}
                    </View>
                    {item.role === 'admin' && (
                      <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
                    )}
                  </Pressable>
                )}
              />
            )}
          </View>

          {/* Group actions */}
          {isAdmin && (
            <View style={styles.section}>
              <MenuItem
                icon="pencil"
                label="Edit group info"
                onPress={() => {}}
                colors={colors}
              />
              <MenuItem
                icon="link"
                label="Invite link"
                onPress={() => {}}
                colors={colors}
              />
              <MenuItem
                icon="qr-code"
                label="QR code"
                onPress={() => {}}
                colors={colors}
              />
            </View>
          )}

          {/* Danger zone */}
          <View style={styles.section}>
            {isAdmin && (
              <MenuItem
                icon="trash"
                label="Delete group"
                danger
                onPress={() => {
                  Alert.alert(
                    'Delete group?',
                    'This will permanently delete the group for everyone.',
                    [{ text: 'Cancel' }, { text: 'Delete', onPress: () => {} }],
                  );
                }}
                colors={colors}
              />
            )}
            <MenuItem
              icon="exit"
              label="Leave group"
              danger
              onPress={() => {
                Alert.alert('Leave group?', 'You will no longer receive messages.', [
                  { text: 'Cancel' },
                  { text: 'Leave', onPress: () => {} },
                ]);
              }}
              colors={colors}
            />
          </View>
        </ScrollView>

        {/* Member action menu */}
        <Modal
          visible={!!memberMenuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMemberMenuOpen(null)}
        >
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => setMemberMenuOpen(null)}
          >
            <View style={styles.menu}>
              {selectedMember && selectedMember.role !== 'admin' && isAdmin && (
                <MenuItem
                  icon="shield-outline"
                  label="Make admin"
                  onPress={() => promoteToAdmin(selectedMember.userId)}
                  colors={colors}
                />
              )}
              {selectedMember && isAdmin && (
                <MenuItem
                  icon="trash-outline"
                  label="Remove from group"
                  danger
                  onPress={() => removeMember(selectedMember.userId)}
                  colors={colors}
                />
              )}
            </View>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  danger,
  colors,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  danger?: boolean;
  colors: Palette;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(3.5) },
        pressed && { opacity: 0.6 },
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={20}
        color={danger ? colors.danger : colors.textMuted}
      />
      <Text
        style={{
          color: danger ? colors.danger : colors.text,
          fontSize: font.body,
          marginLeft: spacing(3),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: { color: colors.text, fontSize: font.heading, fontWeight: '600' },
    content: { flex: 1 },
    groupHeader: {
      alignItems: 'center',
      paddingVertical: spacing(6),
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    groupName: { color: colors.text, fontSize: font.title, fontWeight: '700', marginTop: spacing(3) },
    memberCount: { color: colors.textMuted, fontSize: font.small, marginTop: spacing(1) },
    section: {
      backgroundColor: colors.surface,
      marginTop: spacing(3),
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(2),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      borderBottomColor: colors.border,
    },
    sectionTitle: { color: colors.text, fontSize: font.small, fontWeight: '600', marginBottom: spacing(2) },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing(2.5),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    memberInfo: { flex: 1, marginLeft: spacing(3) },
    memberName: { color: colors.text, fontSize: font.body, fontWeight: '500' },
    memberRole: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
    menuBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    menu: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(4),
      paddingBottom: spacing(8),
    },
  });
