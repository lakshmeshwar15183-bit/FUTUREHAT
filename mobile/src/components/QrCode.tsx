// Lumixo — pure RN QR code from shared matrix (no native QR module).
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { qrMatrixForUrl } from '../../../shared/qrcode';

interface Props {
  value: string;
  size?: number;
  /** Dark module color */
  color?: string;
  backgroundColor?: string;
}

export default function QrCode({
  value,
  size = 200,
  color = '#111',
  backgroundColor = '#fff',
}: Props) {
  const matrix = useMemo(() => qrMatrixForUrl(value), [value]);
  if (!matrix?.length) {
    return (
      <View
        style={[
          styles.fallback,
          { width: size, height: size, backgroundColor },
        ]}
      />
    );
  }
  const n = matrix.length;
  const cell = size / n;
  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor,
        padding: cell * 0.5,
      }}
      accessibilityRole="image"
      accessibilityLabel="QR code"
    >
      <View style={{ width: size - cell, height: size - cell }}>
        {matrix.map((row, y) => (
          <View key={y} style={{ flexDirection: 'row', height: cell }}>
            {row.map((on, x) => (
              <View
                key={x}
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: on ? color : backgroundColor,
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
});
