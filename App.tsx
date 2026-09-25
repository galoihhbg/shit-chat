import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { BigButton } from './src/components/BigButton';
import { randomChallenge, type Challenge } from './src/lib/challenges';
import { SKIP_CAMERA } from './src/lib/devFlags';
import { describeBackendError } from './src/lib/errors';
import { endSession, startSession, type ToiletSession } from './src/lib/session';
import { ensureAllModels, isToiletVisionAvailable } from './src/lib/vision';
import { CameraScreen } from './src/screens/CameraScreen';
import { ChallengeScreen } from './src/screens/ChallengeScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SessionScreen } from './src/screens/SessionScreen';
import { C } from './src/theme';

type Route =
  | { name: 'home' }
  | { name: 'challenge'; challenge: Challenge }
  | { name: 'camera'; challenge: Challenge }
  | { name: 'starting' }
  | { name: 'session'; session: ToiletSession }
  | { name: 'chat'; session: ToiletSession; roomId: string; partner: string }
  | { name: 'expired' }
  | { name: 'error'; message: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [lastChallengeId, setLastChallengeId] = useState<string>();

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
      setRoute({ name: 'session', session });
    } catch (err) {
      setRoute({ name: 'error', message: describeBackendError(err).message });
    }
  }, []);

  const leave = useCallback((session: ToiletSession) => {
    endSession(session.id).catch(() => {});
    setRoute({ name: 'home' });
  }, []);

  // One clock to rule them all: when the session lapses, everything stops.
  const activeSession =
    route.name === 'session' ? route.session : route.name === 'chat' ? route.session : null;

  useEffect(() => {
    if (!activeSession) return;

    const remaining = activeSession.expiresAt - Date.now();
    if (remaining <= 0) {
      setRoute({ name: 'expired' });
      return;
    }

    const id = setTimeout(() => {
      endSession(activeSession.id).catch(() => {});
      setRoute({ name: 'expired' });
    }, remaining);

    return () => clearTimeout(id);
  }, [activeSession]);

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
            onMatched={(roomId, partner) =>
              setRoute({ name: 'chat', session: route.session, roomId, partner })
            }
            onFlush={() => leave(route.session)}
          />
        )}

        {route.name === 'chat' && (
          <ChatScreen
            session={route.session}
            roomId={route.roomId}
            partnerNickname={route.partner}
            onLeave={() => leave(route.session)}
          />
        )}

        {route.name === 'expired' && (
          <View style={styles.center}>
            <Text style={styles.bigEmoji}>{'🌀'}</Text>
            <Text style={styles.expiredTitle}>TIME'S UP</Text>
            <Text style={styles.centerText}>
              Your session has been flushed. Anything you said is gone with it.
            </Text>
            <BigButton label="BACK TO SAFETY" onPress={goHome} />
          </View>
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
