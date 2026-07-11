// FUTUREHAT mobile — join group via invite token (deep link / manual).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { supabase } from '../lib/supabase';
import { joinByInvite, getGroupConversation } from '../lib/shared';
import { useColors, spacing, font, type Palette } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'JoinGroup'>;
type Rt = RouteProp<RootStackParamList, 'JoinGroup'>;

export default function JoinGroupScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [message, setMessage] = useState('Joining group…');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await joinByInvite(supabase, params.token);
      if (!active) return;
      if (res.error) {
        setError(true);
        setMessage(res.error.message);
        setDone(true);
        return;
      }
      if (res.status === 'pending') {
        setMessage('Join request sent. An admin must approve you.');
        setDone(true);
        return;
      }
      if (res.targetType === 'conversation' && res.targetId) {
        const conv = await getGroupConversation(supabase, res.targetId);
        setMessage('Joined!');
        setDone(true);
        navigation.replace('Chat', {
          conversationId: res.targetId,
          title: conv?.name || 'Group',
        });
        return;
      }
      setError(true);
      setMessage('Could not join this invite.');
      setDone(true);
    })();
    return () => {
      active = false;
    };
  }, [params.token, navigation]);

  return (
    <View style={styles.container}>
      {!done && <ActivityIndicator color={colors.primary} size="large" />}
      <Text style={[styles.msg, error && { color: colors.danger }]}>{message}</Text>
      {done && (
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Close</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing(6),
    },
    msg: {
      color: colors.text,
      fontSize: font.heading,
      textAlign: 'center',
      marginTop: spacing(4),
    },
    btn: {
      marginTop: spacing(6),
      backgroundColor: colors.primary,
      paddingHorizontal: spacing(6),
      paddingVertical: spacing(3),
      borderRadius: 24,
    },
    btnText: { color: '#fff', fontWeight: '700', fontSize: font.body },
  });
