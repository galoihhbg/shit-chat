import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import type { Challenge } from '../lib/challenges';
import { C } from '../theme';

type Props = {
  challenge: Challenge;
  onAccept: () => void;
  onCancel: () => void;
  /** Dev bypass: no camera, no proof check. */
  skipCamera?: boolean;
};

export function ChallengeScreen({ challenge, onAccept, onCancel, skipCamera }: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>PROVE IT</Text>

      <View style={styles.card}>
        <Text style={styles.emoji}>{challenge.emoji}</Text>
        <Text style={styles.name}>{challenge.name}</Text>
        <Text style={styles.instruction}>{challenge.instruction}</Text>
      </View>

      <Text style={styles.rules}>
        Take one photo showing <Text style={styles.bold}>your toilet</Text> and{' '}
        <Text style={styles.bold}>this hand sign</Text> together.
      </Text>

      <View style={styles.actions}>
        <BigButton label={skipCamera ? 'SKIP CAMERA (DEV)' : 'OPEN CAMERA'} onPress={onAccept} />
        <BigButton label="actually never mind" tone="ghost" onPress={onCancel} />
      </View>

      <Text style={styles.privacy}>
        {'🔒'} The photo is checked on your phone and deleted immediately. It is
        never uploaded.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 28 },
  kicker: { color: C.poopLight, fontSize: 14, fontWeight: '900', letterSpacing: 4, textAlign: 'center' },
  card: {
    backgroundColor: C.panel,
    borderRadius: 24,
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  emoji: { fontSize: 96 },
  name: { color: C.gold, fontSize: 32, fontWeight: '900', letterSpacing: 1 },
  instruction: { color: C.dim, fontSize: 15, textAlign: 'center', fontStyle: 'italic' },
  rules: { color: C.white, fontSize: 17, textAlign: 'center', lineHeight: 24 },
  bold: { fontWeight: '900', color: C.gold },
  actions: { gap: 12 },
  privacy: { color: C.dim, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  devWarn: { color: C.danger, fontSize: 12, textAlign: 'center', lineHeight: 17, fontWeight: '700' },
});
