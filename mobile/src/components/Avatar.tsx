// FUTUREHAT mobile — circular avatar with graceful initials fallback.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

interface Props {
  uri?: string | null;
  name?: string | null;
  size?: number;
}

const PALETTE = ['#00A884', '#5B6EF5', '#E8638A', '#F7A948', '#9B6EF5', '#3FB0E0'];

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function colorFor(name?: string | null): string {
  if (!name) return PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % PALETTE.length;
  return PALETTE[h];
}

export default function Avatar({ uri, name, size = 48 }: Props) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[styles.img, dim]} />;
  }
  return (
    <View style={[styles.fallback, dim, { backgroundColor: colorFor(name) }]}>
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: '#1F2C33' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '700' },
});
