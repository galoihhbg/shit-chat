import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { C } from '../theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'primary' | 'ghost' | 'danger';
  style?: ViewStyle;
};

export function BigButton({ label, onPress, disabled, busy, tone = 'primary', style }: Props) {
  const inert = disabled || busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [
        styles.base,
        tone === 'primary' && styles.primary,
        tone === 'ghost' && styles.ghost,
        tone === 'danger' && styles.danger,
        pressed && !inert && styles.pressed,
        inert && styles.inert,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={C.bg} />
      ) : (
        <Text style={[styles.label, tone === 'ghost' && styles.ghostLabel]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 64,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: C.gold },
  danger: { backgroundColor: C.danger },
  ghost: { backgroundColor: 'transparent', borderWidth: 2, borderColor: C.poopLight, minHeight: 52 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  inert: { opacity: 0.45 },
  label: {
    color: C.bg,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  ghostLabel: { color: C.poopLight, fontSize: 16 },
});
