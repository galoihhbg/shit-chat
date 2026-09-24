import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { describeBackendError } from '../lib/errors';
import { getActiveCount } from '../lib/session';
import { isConfigured } from '../lib/supabase';
import { C } from '../theme';

const TAGLINES = [
  'the social network you can only use sitting down',
  'strangers. porcelain. fifteen minutes.',
  'nobody is here for the right reasons',
  'proof of stool',
];

export function HomeScreen({ onStart }: { onStart: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);

  const poll = useCallback(async () => {
    try {
      setCount(await getActiveCount());
      setProblem(null);
    } catch (err) {
      // Do not spin forever pretending we are still loading.
      setCount(null);
      setProblem(describeBackendError(err).message);
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [poll]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.logo}>{'💩'}</Text>
        <Text style={styles.title}>ShitChat</Text>
        <Text style={styles.tagline}>{tagline}</Text>
      </View>

      <BigButton label={"I'M SHITTING"} onPress={onStart} />

      <View style={styles.footer}>
        {!isConfigured ? (
          <Text style={styles.warn}>
            Supabase is not configured. Copy .env.example to .env, fill in both values,
            then rebuild: <Text style={styles.mono}>npm run web:preview</Text> (or
            restart the dev server with <Text style={styles.mono}>-c</Text>).
          </Text>
        ) : problem ? (
          <Text style={styles.warn}>{problem}</Text>
        ) : count === null ? (
          <ActivityIndicator color={C.poopLight} />
        ) : (
          <Text style={styles.count}>
            <Text style={styles.countNumber}>{count}</Text>
            {count === 1 ? ' person is' : ' people are'} on the toilet right now
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 48 },
  header: { alignItems: 'center', gap: 8 },
  logo: { fontSize: 88 },
  title: { color: C.gold, fontSize: 46, fontWeight: '900', letterSpacing: -1 },
  tagline: { color: C.dim, fontSize: 15, textAlign: 'center', fontStyle: 'italic' },
  footer: { minHeight: 60, justifyContent: 'center' },
  count: { color: C.white, fontSize: 16, textAlign: 'center' },
  countNumber: { color: C.ok, fontSize: 24, fontWeight: '900' },
  warn: { color: C.danger, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  mono: { fontWeight: '700' },
});
