import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { BigButton } from './src/components/BigButton';
import { randomChallenge, type Challenge } from './src/lib/challenges';
import { SKIP_CAMERA } from './src/lib/devFlags';
import { describeBackendError } from './src/lib/errors';
import type { Outcome } from './src/lib/game/ttt';
import {
  endSession,
  leaveRoom,
  SESSION_MINUTES,
  startSession,
  watchSession,
  type ToiletSession,
} from './src/lib/session';
import { emptyStats, type SessionStats } from './src/lib/share/sessionStats';
import { ensureAllModels, isToiletVisionAvailable } from './src/lib/vision';
import { CameraScreen } from './src/screens/CameraScreen';
import { ChallengeScreen } from './src/screens/ChallengeScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SessionScreen } from './src/screens/SessionScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { C } from './src/theme';

/**
 * Two lifecycles, deliberately separate.
 *
 * The TOILET SESSION starts at verification and runs until the clock expires
 * or the user says they are done. The ROOM is one conversation inside it, and
 * a session can contain several. Leaving someone is not the same thing as
 * finishing your shit, so `session` and `room` are different state.
 */
type Screen =
  | { name: 'home' }
  | { name: 'challenge'; challenge: Challenge }
  | { name: 'camera'; challenge: Challenge }
  | { name: 'starting' }
  | { name: 'lobby' }
  | { name: 'room'; roomId: string; partner: string }
  | { name: 'summary'; stats: SessionStats; expired: boolean }
  | { name: 'error'; message: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [session, setSession] = useState<ToiletSession | null>(null);
  const [lastChallengeId, setLastChallengeId] = useState<string>();
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDone, setConfirmingDone] = useState(false);

  /**
   * Running tally for the summary. It spans the whole toilet session, across
   * every room, and is only reset when a new session starts.
   */
  const tally = useRef({ rooms: new Set<string>(), won: 0, lost: 0, drawn: 0 });

  // The realtime handler needs to know where we are without resubscribing
  // every time the screen changes.
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const goHome = useCallback(() => {
    setSession(null);
    setNotice(null);
    setScreen({ name: 'home' });
  }, []);

  // Pull the ~12 MB of detector models down once, in the background, so the
  // first verification is not stuck behind a download. No-op on web and in
  // Expo Go, where there is no native module to feed them to.
  useEffect(() => {
    if (!isToiletVisionAvailable) return;
    ensureAllModels().catch(() => {
      // Retried on demand inside verifyProof.
    });
  }, []);

  const beginChallenge = useCallback(() => {
    const challenge = randomChallenge(lastChallengeId);
    setLastChallengeId(challenge.id);
    setScreen({ name: 'challenge', challenge });
  }, [lastChallengeId]);

  const onVerified = useCallback(async () => {
    setScreen({ name: 'starting' });
    try {
      const fresh = await startSession();
      tally.current = { rooms: new Set<string>(), won: 0, lost: 0, drawn: 0 };
      setSession(fresh);
      setNotice(null);
      setScreen({ name: 'lobby' });
    } catch (err) {
      setScreen({ name: 'error', message: describeBackendError(err).message });
    }
  }, []);

  const enterRoom = useCallback((roomId: string, partner: string) => {
    // Each room is one person met, counted for the whole session.
    tally.current.rooms.add(roomId);
    setNotice(null);
    setScreen({ name: 'room', roomId, partner });
  }, []);

  /** Snapshot the tally the moment the session stops, then show the summary. */
  const finish = useCallback((ended: ToiletSession, expired: boolean) => {
    const { rooms, won, lost, drawn } = tally.current;
    const startedAt = ended.expiresAt - SESSION_MINUTES * 60_000;

    setSession(null);
    setNotice(null);
    setConfirmingDone(false);
    setScreen({
      name: 'summary',
      expired,
      stats: {
        ...emptyStats(startedAt),
        // An expired session ran the full clock by definition.
        endedAt: expired ? ended.expiresAt : Math.min(Date.now(), ended.expiresAt),
        peopleMet: rooms.size,
        gamesPlayed: won + lost + drawn,
        gamesWon: won,
        gamesLost: lost,
        gamesDrawn: drawn,
      },
    });
  }, []);

  /** "I am still shitting, I just do not want to talk to this person." */
  const onLeaveRoom = useCallback(() => {
    if (!session) return;
    setScreen({ name: 'lobby' });
    setNotice('You left the room. Still on the toilet.');
    leaveRoom(session.id).catch(() => {
      // The room is cleared locally either way; the server catches up or the
      // session expires. Not worth blocking the user on.
    });
  }, [session]);

  /** "I have finished shitting." */
  const onDone = useCallback(() => {
    if (!session) return;
    const ending = session;
    endSession(ending.id).catch(() => {});
    finish(ending, false);
  }, [session, finish]);

  const recordGame = useCallback((outcome: Outcome) => {
    if (outcome === 'win') tally.current.won += 1;
    else if (outcome === 'loss') tally.current.lost += 1;
    else tally.current.drawn += 1;
  }, []);

  /**
   * One subscription to my own session row, for the whole session. It reports
   * both directions: somebody matched with me, or my partner walked out.
   */
  useEffect(() => {
    if (!session) return;

    return watchSession(session.id, ({ session: row, previousRoomId }) => {
      const current = screenRef.current;

      if (row.roomId && current.name === 'lobby') {
        enterRoom(row.roomId, row.partnerNickname ?? 'Someone');
        return;
      }

      // Only an actual transition out of a room counts as the partner
      // leaving. Without the `previousRoomId` check, any unrelated update
      // that happens to carry a null room -- raising a hand to search, for
      // instance -- reads as "they left" and bounces us out of a room we
      // just joined.
      if (!row.roomId && previousRoomId && current.name === 'room') {
        setScreen({ name: 'lobby' });
        setNotice('They left the room. Find someone else.');
      }
    });
  }, [session, enterRoom]);

  // One clock for the whole toilet session. Leaving a room does not touch it.
  useEffect(() => {
    if (!session) return;

    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) {
      finish(session, true);
      return;
    }

    const id = setTimeout(() => {
      endSession(session.id).catch(() => {});
      finish(session, true);
    }, remaining);

    return () => clearTimeout(id);
  }, [session, finish]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.body}>
        {screen.name === 'home' && <HomeScreen onStart={beginChallenge} />}

        {screen.name === 'challenge' && (
          <ChallengeScreen
            challenge={screen.challenge}
            skipCamera={SKIP_CAMERA}
            onAccept={() =>
              SKIP_CAMERA
                ? onVerified()
                : setScreen({ name: 'camera', challenge: screen.challenge })
            }
            onCancel={goHome}
          />
        )}

        {screen.name === 'camera' && (
          <CameraScreen challenge={screen.challenge} onVerified={onVerified} onCancel={goHome} />
        )}

        {screen.name === 'starting' && (
          <View style={styles.center}>
            <Text style={styles.bigEmoji}>{'🚽'}</Text>
            <ActivityIndicator color={C.gold} />
            <Text style={styles.centerText}>Verified. Starting your 15 minutes...</Text>
          </View>
        )}

        {screen.name === 'lobby' && session && (
          <SessionScreen
            session={session}
            notice={notice}
            onMatched={enterRoom}
            onDone={() => setConfirmingDone(true)}
          />
        )}

        {screen.name === 'room' && session && (
          <ChatScreen
            session={session}
            roomId={screen.roomId}
            partnerNickname={screen.partner}
            onLeaveRoom={onLeaveRoom}
            onDone={() => setConfirmingDone(true)}
            onGameFinished={recordGame}
          />
        )}

        {screen.name === 'summary' && (
          <SummaryScreen stats={screen.stats} expired={screen.expired} onDone={goHome} />
        )}

        {screen.name === 'error' && (
          <View style={styles.center}>
            <Text style={styles.bigEmoji}>{'🔥'}</Text>
            <Text style={styles.centerText}>{screen.message}</Text>
            <BigButton label="TRY AGAIN" onPress={goHome} />
          </View>
        )}
      </View>

      {confirmingDone && (
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{'🚽'} Are you sure you're done?</Text>
            <Text style={styles.dialogBody}>
              Ending your toilet session will take you out of ShitChat.
            </Text>
            <BigButton label="KEEP SHITTING" onPress={() => setConfirmingDone(false)} />
            <BigButton label="I'M DONE" tone="danger" onPress={onDone} />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, gap: 16 },
  bigEmoji: { fontSize: 76 },
  centerText: { color: C.white, fontSize: 16, textAlign: 'center', lineHeight: 23 },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  dialog: { backgroundColor: C.panel, borderRadius: 22, padding: 24, gap: 12 },
  dialogTitle: { color: C.gold, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  dialogBody: {
    color: C.white,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 8,
  },
});
