import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import { BigButton } from '../components/BigButton';
import type { Challenge } from '../lib/challenges';
import { shred } from '../lib/shred';
import { verifyProof } from '../lib/verify';
import { C } from '../theme';

type Props = {
  challenge: Challenge;
  onVerified: () => void;
  onCancel: () => void;
};

type Phase = 'ready' | 'working' | 'rejected';

export function CameraScreen({ challenge, onVerified, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [phase, setPhase] = useState<Phase>('ready');
  const [reason, setReason] = useState('');
  const cameraRef = useRef<CameraView>(null);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.gold} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permEmoji}>{'📸'}</Text>
        <Text style={styles.permText}>
          We need the camera. That is the entire security model.
        </Text>
        <BigButton label="ALLOW CAMERA" onPress={requestPermission} />
        <BigButton label="go back" tone="ghost" onPress={onCancel} />
      </View>
    );
  }

  const capture = async () => {
    if (phase === 'working') return;

    setPhase('working');
    setReason('');

    let photo: CameraCapturedPicture | undefined;
    try {
      photo = await cameraRef.current?.takePictureAsync({ quality: 0.5, skipProcessing: true });
      if (!photo?.uri) throw new Error('no photo');

      const result = await verifyProof(photo.uri, challenge);

      if (result.ok) {
        onVerified();
        return;
      }

      setReason(result.reason);
      setPhase('rejected');
    } catch {
      setReason('The camera panicked. Try once more.');
      setPhase('rejected');
    } finally {
      // Whatever happened, the proof does not survive this function.
      shred(photo?.uri);
    }
  };

  return (
    <View style={styles.root}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

      <View style={styles.topBar}>
        <Text style={styles.prompt}>
          {challenge.emoji}  SHOW {challenge.name}
        </Text>
        <Text style={styles.subPrompt}>...with the toilet in shot</Text>
      </View>

      {phase === 'rejected' && (
        <View style={styles.rejectBanner}>
          <Text style={styles.rejectTitle}>REJECTED</Text>
          <Text style={styles.rejectReason}>{reason}</Text>
        </View>
      )}

      <View style={styles.bottomBar}>
        {phase === 'working' ? (
          <View style={styles.working}>
            <ActivityIndicator color={C.gold} />
            <Text style={styles.workingText}>inspecting your evidence...</Text>
          </View>
        ) : (
          <>
            <Pressable onPress={capture} style={styles.shutter}>
              <View style={styles.shutterInner} />
            </Pressable>
            <View style={styles.bottomActions}>
              <Pressable onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>
                <Text style={styles.smallAction}>flip</Text>
              </Pressable>
              <Pressable onPress={onCancel}>
                <Text style={styles.smallAction}>cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 16 },
  permEmoji: { fontSize: 72, textAlign: 'center' },
  permText: { color: C.white, fontSize: 18, textAlign: 'center', lineHeight: 25, marginBottom: 12 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    gap: 4,
  },
  prompt: { color: C.gold, fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  subPrompt: { color: C.white, fontSize: 13, opacity: 0.75 },
  rejectBanner: {
    position: 'absolute',
    top: '42%',
    left: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: C.danger,
    padding: 18,
    alignItems: 'center',
    gap: 6,
  },
  rejectTitle: { color: C.danger, fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  rejectReason: { color: C.white, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 36,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    gap: 16,
  },
  shutter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 5,
    borderColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.gold },
  bottomActions: { flexDirection: 'row', gap: 40 },
  smallAction: { color: C.white, fontSize: 15, opacity: 0.8, textDecorationLine: 'underline' },
  working: { alignItems: 'center', gap: 10, height: 124, justifyContent: 'center' },
  workingText: { color: C.white, fontSize: 15, fontStyle: 'italic' },
});
