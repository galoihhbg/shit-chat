import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatClock, useCountdown } from '../components/Countdown';
import { useTicTacToe } from '../lib/game/useTicTacToe';
import type { Outcome } from '../lib/game/ttt';
import { GamePanel } from './GamePanel';
import {
  fetchMessages,
  sendMessage,
  subscribeToRoom,
  type ChatMessage,
  type ToiletSession,
} from '../lib/session';
import { C } from '../theme';

type Props = {
  session: ToiletSession;
  roomId: string;
  partnerNickname: string;
  /** Leave this conversation, stay on the toilet. */
  onLeaveRoom: () => void;
  /** End the whole toilet session. */
  onDone: () => void;
  /** Reported to the session summary. */
  onGameFinished?: (outcome: Outcome) => void;
};

type Mode = 'chat' | 'game';

export function ChatScreen({
  session,
  roomId,
  partnerNickname,
  onLeaveRoom,
  onDone,
  onGameFinished,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>('chat');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Mounted for the whole match, not just while the board is on screen, so
  // messages keep arriving while you play and the game keeps up while you chat.
  const ttt = useTicTacToe(session.id, roomId, { onFinished: onGameFinished });

  const openGame = useCallback(() => {
    ttt.acknowledge();
    setMode('game');
  }, [ttt]);

  const secondsLeft = useCountdown(session.expiresAt);
  const urgent = secondsLeft <= 60;

  const absorb = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
  }, []);

  useEffect(() => {
    let alive = true;
    fetchMessages(roomId)
      .then((initial) => {
        if (alive) setMessages(initial);
      })
      .catch(() => {});

    const unsubscribe = subscribeToRoom(roomId, absorb);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [roomId, absorb]);

  useEffect(() => {
    if (messages.length) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      await sendMessage(roomId, session, body);
    } catch {
      setDraft(body);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.partner}>{partnerNickname}</Text>
          <Text style={styles.partnerSub}>is also on the toilet</Text>
        </View>
        <Pressable
          onPress={mode === 'chat' ? openGame : () => setMode('chat')}
          style={styles.modeButton}
        >
          <Text style={styles.modeLabel}>{mode === 'chat' ? 'PLAY' : 'CHAT'}</Text>
          {mode === 'chat' && ttt.incomingChallenge && <View style={styles.dot} />}
        </Pressable>
        <Text style={[styles.clock, urgent && styles.clockUrgent]}>{formatClock(secondsLeft)}</Text>
      </View>

      {mode === 'chat' && ttt.incomingChallenge && (
        <Pressable onPress={openGame} style={styles.challenge}>
          <Text style={styles.challengeTitle}>{'\uD83D\uDEBD'} YOU'VE BEEN CHALLENGED</Text>
          <Text style={styles.challengeSub}>{partnerNickname} wants to play. Tap to accept.</Text>
        </Pressable>
      )}

      {mode === 'game' ? (
        <GamePanel
          sessionId={session.id}
          partnerNickname={partnerNickname}
          ttt={ttt}
          onBackToChat={() => setMode('chat')}
        />
      ) : (
        <>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Say something. You have {formatClock(secondsLeft)} and nothing to lose.
          </Text>
        }
        renderItem={({ item }) => {
          const mine = item.senderSession === session.id;
          return (
            <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={[styles.body, mine && styles.bodyMine]}>{item.body}</Text>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="type something regrettable"
          placeholderTextColor={C.dim}
          maxLength={500}
          multiline
          onSubmitEditing={submit}
          returnKeyType="send"
        />
        <Pressable onPress={submit} style={styles.send} disabled={!draft.trim()}>
          <Text style={[styles.sendLabel, !draft.trim() && styles.sendDisabled]}>SEND</Text>
        </Pressable>
      </View>

        </>
      )}

      <View style={styles.exits}>
        <Pressable onPress={onLeaveRoom} style={styles.exit} hitSlop={8}>
          <Text style={styles.leaveRoom}>{'\uD83D\uDEAA'}  Leave Room</Text>
        </Pressable>
        <Pressable onPress={onDone} style={styles.exit} hitSlop={8}>
          <Text style={styles.done}>{'\uD83D\uDEBD'}  I'm Done</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.panel,
  },
  headerText: { flex: 1 },
  modeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.gold,
    marginRight: 12,
  },
  modeLabel: { color: C.gold, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  dot: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.danger,
  },
  challenge: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: C.panel,
    borderWidth: 2,
    borderColor: C.gold,
    gap: 4,
  },
  challengeTitle: { color: C.gold, fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  challengeSub: { color: C.dim, fontSize: 13 },
  partner: { color: C.gold, fontSize: 20, fontWeight: '900' },
  partnerSub: { color: C.dim, fontSize: 12, fontStyle: 'italic' },
  clock: { color: C.ok, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  clockUrgent: { color: C.danger },
  list: { padding: 16, gap: 8, flexGrow: 1 },
  empty: { color: C.dim, fontSize: 14, textAlign: 'center', marginTop: 48, fontStyle: 'italic' },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { alignSelf: 'flex-end', backgroundColor: C.gold, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.panel, borderBottomLeftRadius: 4 },
  body: { color: C.white, fontSize: 16, lineHeight: 22 },
  bodyMine: { color: C.bg, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: C.panel,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: C.white,
    fontSize: 16,
  },
  send: { paddingHorizontal: 14, paddingVertical: 14 },
  sendLabel: { color: C.gold, fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  sendDisabled: { opacity: 0.35 },
  exits: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  exit: { paddingVertical: 6, paddingHorizontal: 10 },
  // Leaving a room is the ordinary action; ending the session is the heavier
  // one, so only the latter is tinted as a way out of the app.
  leaveRoom: { color: C.white, fontSize: 14, fontWeight: '700' },
  done: { color: C.dim, fontSize: 14, fontWeight: '700' },
});
