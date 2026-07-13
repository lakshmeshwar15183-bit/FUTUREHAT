// Lumixo — shared Settings UI kit (Material 3–inspired, messenger identity).
// Used by Settings hub + sub-screens for consistent rows, sections, icons.
import React, { useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, spacing, radius, font, touch, type Palette } from '../theme';

/** Soft tinted circle behind settings icons (Material list pattern). */
export function SettingsIconBadge({
  name,
  color,
  bg,
  size = 22,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color?: string;
  bg?: string;
  size?: number;
}) {
  const colors = useColors();
  const tint = color ?? colors.primary;
  const fill =
    bg ??
    (colors.isLight ? `${tint}18` : `${tint}28`);
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name={name} size={size} color={tint} />
    </View>
  );
}

export function SettingsSection({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const styles = useMemo(() => sectionStyles(colors), [colors]);
  return (
    <View style={[styles.wrap, style]}>
      {!!title && (
        <Text
          style={styles.title}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
        >
          {title}
        </Text>
      )}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function SettingsRow({
  icon,
  iconColor,
  iconBg,
  label,
  subtitle,
  value,
  onPress,
  danger,
  locked,
  badge,
  switchValue,
  onSwitch,
  last,
  accessibilityHint,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  label: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  locked?: boolean;
  badge?: number;
  switchValue?: boolean;
  onSwitch?: (v: boolean) => void;
  last?: boolean;
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => rowStyles(colors), [colors]);
  const tint = danger ? colors.danger : colors.text;
  const interactive = !!(onPress || onSwitch);

  const body = (
    <>
      {icon ? (
        <SettingsIconBadge
          name={icon}
          color={danger ? colors.danger : iconColor}
          bg={danger ? (colors.isLight ? 'rgba(234,0,56,0.10)' : 'rgba(241,92,109,0.18)') : iconBg}
        />
      ) : null}
      <View style={[styles.body, !icon && { marginLeft: 0 }]}>
        <Text
          style={[styles.label, { color: tint }]}
          numberOfLines={2}
          maxFontSizeMultiplier={1.5}
        >
          {label}
        </Text>
        {!!subtitle && (
          <Text
            style={styles.sub}
            numberOfLines={3}
            maxFontSizeMultiplier={1.4}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {badge != null && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
      {value != null && value !== '' ? (
        <Text style={styles.value} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {value}
        </Text>
      ) : null}
      {locked ? (
        <Ionicons
          name="lock-closed"
          size={14}
          color={colors.textFaint}
          style={{ marginRight: 6 }}
        />
      ) : null}
      {onSwitch != null ? (
        <Switch
          value={!!switchValue}
          onValueChange={onSwitch}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
          accessibilityLabel={label}
        />
      ) : onPress && !danger ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      ) : null}
    </>
  );

  // Toggle rows: non-pressable container so Switch doesn't double-fire.
  if (onSwitch != null) {
    return (
      <View
        style={[styles.row, last && styles.rowLast]}
        accessibilityRole="none"
      >
        {body}
      </View>
    );
  }

  if (!onPress) {
    return (
      <View
        style={[styles.row, last && styles.rowLast]}
        accessibilityRole="text"
        accessibilityLabel={subtitle ? `${label}. ${subtitle}` : label}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        locked
          ? `${label}, Lumixo Plus required`
          : badge
            ? `${label}, ${badge} unread`
            : label
      }
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        last && styles.rowLast,
        pressed && styles.pressed,
      ]}
      android_ripple={{ color: colors.isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }}
    >
      {body}
    </Pressable>
  );
}

export function SettingsSearchBar({
  value,
  onChangeText,
  placeholder = 'Search settings',
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => searchStyles(colors), [colors]);
  return (
    <View style={styles.wrap} accessibilityRole="search">
      <Ionicons name="search" size={18} color={colors.textMuted} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel="Search settings"
        maxFontSizeMultiplier={1.4}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={18} color={colors.textFaint} />
        </Pressable>
      )}
    </View>
  );
}

const sectionStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { marginTop: spacing(3) },
    title: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginHorizontal: spacing(5),
      marginBottom: spacing(1.5),
    },
    card: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing(3),
      borderRadius: radius.lg,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.06)' : colors.border,
    },
  });

const rowStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing(3),
      paddingVertical: spacing(2.5),
      minHeight: Math.max(touch.min, 52),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.isLight ? 'rgba(0,0,0,0.05)' : colors.border,
      gap: spacing(3),
    },
    rowLast: { borderBottomWidth: 0 },
    pressed: { backgroundColor: colors.surfaceAlt },
    body: { flex: 1, minWidth: 0 },
    label: {
      fontSize: font.body,
      fontWeight: '500',
      letterSpacing: -0.15,
    },
    sub: {
      color: colors.textMuted,
      fontSize: font.small,
      marginTop: 2,
      lineHeight: 17,
    },
    value: {
      color: colors.textMuted,
      fontSize: font.small,
      marginRight: 4,
      maxWidth: 120,
    },
    badge: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: 10,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 4,
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  });

const searchStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: spacing(3),
      marginTop: spacing(2.5),
      marginBottom: spacing(0.5),
      paddingHorizontal: spacing(3),
      minHeight: 44,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.isLight ? 'rgba(0,0,0,0.05)' : colors.border,
      gap: spacing(2),
    },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: font.body,
      paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    },
  });
