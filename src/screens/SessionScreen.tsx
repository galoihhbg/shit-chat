import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { formatClock, useCountdown } from '../components/Countdown';
import { findMatch, getActiveCount, watchForMatch, type ToiletSession } from '../lib/session';
import { C } from '../theme';

type Props = {
  session: ToiletSession;
  onMatched: (roomId: string, partnerNickname: string) => void;
  onFlush: () => void;
};

export function SessionScreen({ session, onMatched, onFlush }: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const settled = useRef(false);

  const secondsLeft = useCountdown(session.expiresAt);

  const land = useCallback(
    (roomId: string, partner: string) => {
      if (settled.current) return;
      settled.current = true;
      onMatched(roomId, partner);
    },
    [onMatched]
  );

  // Poll the live headcount.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const n = await getActiveCount();
        if (alive) setCount(n);
      } catch {
        /* ignore, we will try again in a moment */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Somebody else may match with us first.
  useEffect(() => {
    return watchForMatch(session.id, (updated) => {
      if (updated.roomId) land(updated.roomId, updated.partnerNickname ?? 'Someone');
    });
  }, [session.id, land]);

  // While searching, keep asking. Someone will sit down eventually.
  useEffect(() => {
    if (!searching) return;

    let alive = true;
    const attempt = async () => {
      try {
        const match = await findMatch(session.id);
        if (!alive) return;
        if (match) {
          land(match.roomId, match.partnerNickname);
        } else {
          setNote('Nobody else is available. Holding the door open...');
        }
      } catch {
        if (alive) setNote('Matchmaking hiccup. Still trying.');
      }
    };

    attempt();
    const id = setInterval(attempt, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [searching, session.id, land]);

  const urgent = secondsLeft <= 60;
  const others = count === null ? null : Math.max(0, count - 1);

  return (
    <View style={styles.root}>
      <View style={styles.block}>
        <Text style={styles.status}>SESSION ACTIVE</Text>
        <Text style={[styles.clock, urgent && styles.clockUrgent]}>{formatClock(secondsLeft)}</Text>
        <Text style={styles.nickname}>you are {session.nickname}</Text>
      </View>

      <View style={styles.block}>
        <Text style={styles.headcount}>
          {others === null
            ? 'counting...'
            : others === 0
              ? 'You are the only one. Bleak.'
              : `${others} other ${others === 1 ? 'person' : 'people'} nearby-ish`}
        </Text>
      </View>

      <View style={styles.actions}>
        <BigButton
          label={searching ? 'SEARCHING...' : 'MATCH ME WITH A STRANGER'}
          onPress={() => setSearching(true)}
          busy={searching}
        />
        {searching && !!note && <Text style={styles.note}>{note}</Text>}
        <BigButton label="flush and leave" tone="ghost" onPress={onFlush} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 36 },
  block: { alignItems: 'center', gap: 6 },
  status: { color: C.ok, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  clock: { color: C.gold, fontSize: 72, fontWeight: '900', fontVariant: ['tabular-nums'] },
  clockUrgent: { color: C.danger },
  nickname: { color: C.dim, fontSize: 15, fontStyle: 'italic' },
  headcount: { color: C.white, fontSize: 17, textAlign: 'center' },
  actions: { gap: 12 },
  note: { color: C.dim, fontSize: 13, textAlign: 'center', fontStyle: 'italic' },
});
