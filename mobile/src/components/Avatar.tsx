// Lumixo mobile — circular avatar with graceful initials fallback.
// Offline-first: permanent media cache is checked so avatars open without network.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
// expo-image gives memory+disk caching so avatars in long lists aren't re-fetched
// on every scroll (a major scroll-jank source with react-native's <Image>).
import { Image } from 'expo-image';
import { peekCachedMediaUri, getCachedMediaUri } from '../lib/mediaCache';
import { shouldAutoDownload } from '../lib/mediaPolicy';
import { getNetworkClass, isRoamingLike } from '../lib/mediaNetwork';
import { ensureMediaCached } from '../lib/mediaCache';
import { signedMediaUrl } from '../lib/shared';
import { supabase } from '../lib/supabase';

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

function Avatar({ uri, name, size = 48 }: Props) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  const [src, setSrc] = useState<string | null>(() => (uri ? peekCachedMediaUri(uri) : null));

  useEffect(() => {
    if (!uri) {
      setSrc(null);
      return;
    }
    let alive = true;
    const peek = peekCachedMediaUri(uri);
    if (peek) {
      setSrc(peek);
      return;
    }
    (async () => {
      const local = await getCachedMediaUri(uri);
      if (!alive) return;
      if (local) {
        setSrc(local);
        return;
      }
      // Signed display URL — permanent cache only if policy allows (tiny avatars).
      const signed = (await signedMediaUrl(supabase, uri)) ?? uri;
      if (!alive) return;
      setSrc(signed);
      if (shouldAutoDownload('avatar', getNetworkClass(), isRoamingLike())) {
        void ensureMediaCached(uri).then((l) => {
          if (alive && l) setSrc(l);
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [uri]);

  if (src) {
    return (
      <Image
        source={src}
        style={[styles.img, dim]}
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={120}
        recyclingKey={uri ?? src}
      />
    );
  }
  return (
    <View style={[styles.fallback, dim, { backgroundColor: colorFor(name) }]}>
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials(name)}</Text>
    </View>
  );
}

// Memoized: avatars are rendered in every list row; without this they re-render
// whenever the parent row does.
export default React.memo(Avatar);

const styles = StyleSheet.create({
  img: { backgroundColor: '#1F2C33' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '700' },
});
