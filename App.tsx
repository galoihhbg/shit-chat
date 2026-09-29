import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { BigButton } from './src/components/BigButton';
import { randomChallenge, type Challenge } from './src/lib/challenges';
import { SKIP_CAMERA } from './src/lib/devFlags';
import { describeBackendError } from './src/lib/errors';
import type { Outcome } from './src/lib/game/ttt';
import { endSession, SESSION_MINUTES, startSession, type ToiletSession } from './src/lib/session';
import { emptyStats, type SessionStats } from './src/lib/share/sessionStats';
import { ensureAllModels, isToiletVisionAvailable } from './src/lib/vision';
import { CameraScreen } from './src/screens/CameraScreen';
import { ChallengeScreen } from './src/screens/ChallengeScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SessionScreen } from './src/screens/SessionScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { C } from './src/theme';

type Route =
  | { name: 'home' }
  | { name: 'challenge'; challenge: Challenge }
  | { name: 'camera'; challenge: Challenge }
  | { name: 'starting' }
  | { name: 'session'; session: ToiletSession }
  | { name: 'chat'; session: ToiletSession; roomId: string; partner: string }
  | { name: 'summary'; stats: SessionStats; expired: boolean }
  | { name: 'error'; message: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [lastChallengeId, setLastChallengeId] = useState<string>();

  /**
   * Running tally for the end-of-session summary. A ref, not state, because
   * nothing renders from it until the session is over -- at which point it is
   * snapshotted into the summary route.
   */
  const tally = useRef({ partners: new Set<string>(), won: 0, lost: 0, drawn: 0 });

  const goHome = useCallback(() => setRoute({ name: 'home' }), []);

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
    setRoute({ name: 'challenge', challenge });
  }, [lastChallengeId]);

  const onVerified = useCallback(async () => {
    setRoute({ name: 'starting' });
    try {
      const session = await startSession();
      tally.current = { partners: new Set<string>(), won: 0, lost: 0, drawn: 0 };
      setRoute({ name: 'session', session });
    } catch (err) {
      setRoute({ name: 'error', message: describeBackendError(err).message });
    }
  }, []);

  /** Snapshot the tally the moment the session stops, then show the summary. */
  const finish = useCallback((session: ToiletSession, expired: boolean) => {
    const { partners, won, lost, drawn } = tally.current;
    const startedAt = session.expiresAt - SESSION_MINUTES * 60_000;

    setRoute({
      name: 'summary',
      expired,
      stats: {
        ...emptyStats(startedAt),
        // An expired session ran the full clock by definition.
        endedAt: expired ? session.expiresAt : Math.min(Date.now(), session.expiresAt),
        peopleMet: partners.size,
        gamesPlayed: won + lost + drawn,
        gamesWon: won,
        gamesLost: lost,
        gamesDrawn: drawn,
      },
    });
  }, []);

  const leave = useCallback(
    (session: ToiletSession) => {
      endSession(session.id).catch(() => {});
      finish(session, false);
    },
    [finish]
  );

  const recordGame = useCallback((outcome: Outcome) => {
    if (outcome === 'win') tally.current.won += 1;
    else if (outcome === 'loss') tally.current.lost += 1;
    else tally.current.drawn += 1;
  }, []);

  // One clock to rule them all: when the session lapses, everything stops.
  const activeSession =
    route.name === 'session' ? route.session : route.name === 'chat' ? route.session : null;

  useEffect(() => {
    if (!activeSession) return;

    const remaining = activeSession.expiresAt - Date.now();
    if (remaining <= 0) {
      finish(activeSession, true);
      return;
    }

    const id = setTimeout(() => {
      endSession(activeSession.id).catch(() => {});
      finish(activeSession, true);
    }, remaining);

    return () => clearTimeout(id);
  }, [activeSession, finish]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.body}>
        {route.name === 'home' && <HomeScreen onStart={beginChallenge} />}

        {route.name === 'challenge' && (
          <ChallengeScreen
            challenge={route.challenge}
            skipCamera={SKIP_CAMERA}
            onAccept={() =>
              SKIP_CAMERA
                ? onVerified()
                : setRoute({ name: 'camera', challenge: route.challenge })
            }
            onCancel={goHome}
          />
        )}

        {route.name === 'camera' && (
          <CameraScreen challenge={route.challenge} onVerified={onVerified} onCancel={goHome} />
        )}

        {route.name === 'starting' && (
          <View style={styles.center}>
            <Text style={styles.bigEmoji}>{'🚽'}</Text>
            <ActivityIndicator color={C.gold} />
            <Text style={styles.centerText}>Verified. Starting your 15 minutes...</Text>
          </View>
        )}

        {route.name === 'session' && (
          <SessionScreen
            session={route.session}
            onMatched={(roomId, partner) => {
              tally.current.partners.add(partner);
              setRoute({ name: 'chat', session: route.session, roomId, partner });
            }}
            onFlush={() => leave(route.session)}
          />
        )}

        {route.name === 'chat' && (
          <ChatScreen
            session={route.session}
            roomId={route.roomId}
            partnerNickname={route.partner}
            onLeave={() => leave(route.session)}
            onGameFinished={recordGame}
          />
        )}

        {route.name === 'summary' && (
          <SummaryScreen stats={route.stats} expired={route.expired} onDone={goHome} />
        )}

        {route.name === 'error' && (
          <View style={styles.center}>
            <Text style={styles.bigEmoji}>{'🔥'}</Text>
            <Text style={styles.centerText}>{route.message}</Text>
            <BigButton label="TRY AGAIN" onPress={goHome} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, gap: 16 },
  bigEmoji: { fontSize: 76 },
  expiredTitle: { color: C.gold, fontSize: 34, fontWeight: '900', letterSpacing: 2 },
  centerText: { color: C.white, fontSize: 16, textAlign: 'center', lineHeight: 23 },
});
