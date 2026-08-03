// Lumixo mobile — navigation header title that re-renders only from chatHeaderLive.
// Parent ChatScreen must NOT call setOptions when typing/online changes.
import React, { useSyncExternalStore } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import ProfileAvatar from './ProfileAvatar';
import {
  getChatHeaderLive,
  subscribeChatHeaderLive,
  resolveHeaderSubtitle,
} from '../lib/chatHeaderLive';

type HeaderStyles = {
  headerPerson: StyleProp<ViewStyle>;
  headerTextCol: StyleProp<ViewStyle>;
  headerTitleRow: StyleProp<ViewStyle>;
  headerTitle: StyleProp<TextStyle>;
  headerStreak: StyleProp<ViewStyle>;
  headerStreakEmoji: StyleProp<TextStyle>;
  headerStreakScore: StyleProp<TextStyle>;
  headerSub: StyleProp<TextStyle>;
  headerSubTyping: StyleProp<TextStyle>;
};

type Props = {
  styles: HeaderStyles;
  titleMax: number;
  onPressProfile: () => void;
  onPressStreak: () => void;
};

function ChatHeaderTitleInner({ styles, titleMax, onPressProfile, onPressStreak }: Props) {
  const live = useSyncExternalStore(subscribeChatHeaderLive, getChatHeaderLive, getChatHeaderLive);
  const subtitle = resolveHeaderSubtitle(live);
  const typing = !!live.typingName;

  return (
    <View style={[styles.headerPerson, { maxWidth: titleMax }]}>
      <ProfileAvatar
        uri={live.avatarUri}
        name={live.avatarName}
        size={36}
        userId={live.isGroup ? null : live.peerUserId}
        mode="auto"
      />
      <Pressable
        onPress={onPressProfile}
        style={styles.headerTextCol}
        accessibilityRole="button"
        accessibilityLabel="Open contact info"
      >
        <View style={styles.headerTitleRow}>
          <Text
            style={styles.headerTitle}
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.35}
          >
            {live.title}
          </Text>
          {!live.isGroup && live.streakScore > 0 && !!live.streakEmoji && (
            <Pressable
              onPress={onPressStreak}
              hitSlop={8}
              style={styles.headerStreak}
              accessibilityRole="button"
              accessibilityLabel={`Streak ${live.streakScore}. Open streak details.`}
            >
              <Text style={styles.headerStreakEmoji} allowFontScaling={false}>
                {live.streakEmoji}
              </Text>
              <Text style={styles.headerStreakScore} allowFontScaling={false}>
                {live.streakScore > 999 ? '999+' : live.streakScore}
              </Text>
            </Pressable>
          )}
          {live.disappearSecs > 0 && (
            <Ionicons
              name="timer-outline"
              size={13}
              color="rgba(255,255,255,0.9)"
              style={{ marginLeft: 4, flexShrink: 0 }}
            />
          )}
          {live.ghost && (
            <Ionicons
              name="eye-off-outline"
              size={12}
              color="rgba(255,255,255,0.9)"
              style={{ marginLeft: 4, flexShrink: 0 }}
            />
          )}
        </View>
        {!!subtitle && (
          <Text
            style={[
              styles.headerSub,
              typing ? styles.headerSubTyping : null,
              { color: typing ? '#B8F5E0' : 'rgba(255,255,255,0.88)' },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.3}
          >
            {subtitle}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

export const ChatHeaderTitle = React.memo(ChatHeaderTitleInner);

export function ChatHeaderRight({
  styles,
  isGroup,
  headerOnGreen,
  onAudio,
  onVideo,
  onMore,
}: {
  styles: { headerActions: StyleProp<ViewStyle>; headerIconBtn: StyleProp<ViewStyle> };
  isGroup: boolean;
  headerOnGreen: string;
  onAudio: () => void;
  onVideo: () => void;
  onMore: () => void;
}) {
  return (
    <View style={styles.headerActions}>
      {!isGroup && (
        <>
          <Pressable
            hitSlop={8}
            onPress={onAudio}
            accessibilityLabel="Voice call"
            style={styles.headerIconBtn}
          >
            <Ionicons name="call-outline" size={22} color={headerOnGreen} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={onVideo}
            accessibilityLabel="Video call"
            style={styles.headerIconBtn}
          >
            <Ionicons name="videocam-outline" size={23} color={headerOnGreen} />
          </Pressable>
        </>
      )}
      <Pressable
        hitSlop={8}
        onPress={onMore}
        accessibilityLabel="More options"
        style={styles.headerIconBtn}
      >
        <Ionicons name="ellipsis-vertical" size={20} color={headerOnGreen} />
      </Pressable>
    </View>
  );
}
