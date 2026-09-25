import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import { BigButton } from '../components/BigButton';
import type { Challenge } from '../lib/challenges';
import { shred } from '../lib/shred';
import { verifyProof, type ProofStep } from '../lib/verify';
import { C } from '../theme';

type Props = {
  challenge: Challenge;
  onVerified: () => void;
  onCancel: () => void;
};

type Phase = 'ready' | 'working' | 'rejected' | 'verified';

/** How long the VERIFIED stamp stays up before the session starts. */
const VERIFIED_DWELL_MS = 900;

function StepRow({ step }: { step: ProofStep }) {
  const mark =
    step.state === 'pass' ? '\u2713' : step.state === 'fail' ? '\u2717' : step.state === 'running' ? '\u00B7' : '\u00B7';
  return (
    <Text
      style={[
        styles.stepRow,
        step.state === 'pass' && styles.stepPass,
        step.state === 'fail' && styles.stepFail,
        step.state === 'running' && styles.stepRunning,
      ]}
    >
      {mark}  {step.label}
    </Text>
  );
}

export function CameraScreen({ challenge, onVerified, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [phase, setPhase] = useState<Phase>('ready');
  const [reason, setReason] = useState('');
  const [steps, setSteps] = useState<ProofStep[]>([]);
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
    if (phase === 'working' || phase === 'verified') return;

    setPhase('working');
    setReason('');
    setSteps([]);

    let photo: CameraCapturedPicture | undefined;
    try {
      // skipProcessing is deliberately off: it can leave the orientation in
      // EXIF, and THUMBS_UP is decided by which way the thumb points.
      photo = await cameraRef.current?.takePictureAsync({ quality: 0.6 });
      if (!photo?.uri) throw new Error('no photo');

      const result = await verifyProof(photo.uri, challenge, { onProgress: setSteps });
      setSteps(result.steps);

      if (result.ok) {
        setPhase('verified');
        setTimeout(onVerified, VERIFIED_DWELL_MS);
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
        <Text style={styles.proofTitle}>{'\uD83D\uDEBD'} TOILET PROOF</Text>
        <Text style={styles.prompt}>
          {challenge.emoji}  SHOW {challenge.name}
        </Text>
        <Text style={styles.subPrompt}>...and include the toilet in the frame</Text>
      </View>

      {(phase === 'working' || phase === 'rejected') && steps.length > 0 && (
        <View style={styles.checklist}>
          {steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </View>
      )}

      {phase === 'rejected' && (
        <View style={styles.rejectBanner}>
          <Text style={styles.rejectTitle}>REJECTED</Text>
          <Text style={styles.rejectReason}>{reason}</Text>
        </View>
      )}

      {phase === 'verified' && (
        <View style={styles.verifiedBanner}>
          <Text style={styles.verifiedTitle}>{'\uD83D\uDEBD'} VERIFIED</Text>
        </View>
      )}

      <View style={styles.bottomBar}>
        {phase === 'verified' ? (
          <View style={styles.working}>
            <Text style={styles.workingText}>starting your session...</Text>
          </View>
        ) : phase === 'working' ? (
          <View style={styles.working}>
            <ActivityIndicator color={C.gold} />
            <Text style={styles.workingText}>Checking...</Text>
          </View>
        ) : (
          <>
            <Pressable onPress={capture} style={styles.shutter}>
              <View style={styles.shutterInner} />
            </Pressable>
            {phase === 'rejected' && <Text style={styles.retakeHint}>tap the shutter to retake</Text>}
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
  proofTitle: { color: C.white, fontSize: 13, fontWeight: '900', letterSpacing: 3, opacity: 0.85 },
  prompt: { color: C.gold, fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  subPrompt: { color: C.white, fontSize: 13, opacity: 0.75 },
  checklist: {
    position: 'absolute',
    top: '26%',
    left: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 6,
  },
  stepRow: { color: C.dim, fontSize: 15, fontVariant: ['tabular-nums'] },
  stepRunning: { color: C.white },
  stepPass: { color: C.ok, fontWeight: '700' },
  stepFail: { color: C.danger, fontWeight: '700' },
  verifiedBanner: {
    position: 'absolute',
    top: '42%',
    left: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: C.ok,
    padding: 22,
    alignItems: 'center',
  },
  verifiedTitle: { color: C.ok, fontSize: 30, fontWeight: '900', letterSpacing: 2 },
  retakeHint: { color: C.white, fontSize: 13, opacity: 0.8, fontStyle: 'italic' },
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
