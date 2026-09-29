import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { shareSession } from '../lib/share/shareCard';
import { rank, statLines, type SessionStats } from '../lib/share/sessionStats';
import { C } from '../theme';

type Props = {
  stats: SessionStats;
  /** True when the clock ran out, rather than the user leaving early. */
  expired: boolean;
  onDone: () => void;
};

export function SummaryScreen({ stats, expired, onDone }: Props) {
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    setSharing(true);
    try {
      await shareSession(stats);
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.emoji}>{'🚽'}</Text>
        <Text style={styles.title}>SESSION COMPLETE</Text>
      </View>

      <View style={styles.card}>
        {statLines(stats).map((line, i) => (
          <Text key={line} style={i === 0 ? styles.headline : styles.line}>
            {line}
          </Text>
        ))}
        <Text style={styles.rank}>"{rank(stats)}"</Text>
      </View>

      <View style={styles.actions}>
        <BigButton label="SHARE" onPress={share} busy={sharing} />
        <BigButton label="DONE" tone="ghost" onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 30 },
  header: { alignItems: 'center', gap: 6 },
  emoji: { fontSize: 68 },
  title: { color: C.gold, fontSize: 30, fontWeight: '900', letterSpacing: 2 },
  sub: { color: C.dim, fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 10 },
  card: {
    backgroundColor: C.panel,
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  headline: { color: C.white, fontSize: 34, fontWeight: '900', fontVariant: ['tabular-nums'] },
  line: { color: C.white, fontSize: 16 },
  rank: { color: C.gold, fontSize: 18, fontStyle: 'italic', marginTop: 10 },
  actions: { gap: 12 },
});
