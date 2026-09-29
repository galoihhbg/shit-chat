import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { BigButton } from '../components/BigButton';
import { Board } from '../components/Board';
import type { TicTacToe } from '../lib/game/useTicTacToe';
import { canPlay, headline, markFor, outcomeFor, winningLine } from '../lib/game/ttt';
import { C } from '../theme';

type Props = {
  sessionId: string;
  partnerNickname: string;
  ttt: TicTacToe;
  onBackToChat: () => void;
};

export function GamePanel({ sessionId, partnerNickname, ttt, onBackToChat }: Props) {
  const { game, busy, error, start, play, dismissError } = ttt;

  if (!game) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigEmoji}>{'❌⭕'}</Text>
        <Text style={styles.title}>WANNA PLAY?</Text>
        <Text style={styles.sub}>
          Tic-tac-toe against {partnerNickname}. Loser flushes twice.
        </Text>
        <BigButton label="PLAY A GAME" onPress={start} busy={busy} />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable onPress={onBackToChat}>
          <Text style={styles.link}>back to chat</Text>
        </Pressable>
      </View>
    );
  }

  const mine = markFor(game, sessionId);
  const outcome = outcomeFor(game, sessionId);
  const finished = game.status !== 'active';
  const myTurn = !finished && game.turn === mine;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text
          style={[
            styles.title,
            outcome === 'win' && styles.win,
            outcome === 'loss' && styles.loss,
            !finished && myTurn && styles.yourTurn,
          ]}
        >
          {headline(game, sessionId)}
        </Text>
        <Text style={styles.sub}>
          {finished ? `vs ${partnerNickname}` : `you are ${mine ?? '?'}`}
        </Text>
      </View>

      <Board
        board={game.board}
        highlight={finished ? winningLine(game.board) : null}
        playable={(cell) => canPlay(game, sessionId, cell)}
        onPlay={play}
        disabled={busy}
      />

      <View style={styles.footer}>
        {busy && <ActivityIndicator color={C.gold} />}
        {!!error && (
          <Pressable onPress={dismissError}>
            <Text style={styles.error}>{error}</Text>
          </Pressable>
        )}
        {finished && <BigButton label="REMATCH?" onPress={start} busy={busy} />}
        <BigButton label="BACK TO CHAT" tone="ghost" onPress={onBackToChat} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', gap: 22, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, paddingHorizontal: 28 },
  header: { alignItems: 'center', gap: 4 },
  bigEmoji: { fontSize: 56 },
  title: { color: C.white, fontSize: 28, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  yourTurn: { color: C.gold },
  win: { color: C.ok },
  loss: { color: C.danger },
  sub: { color: C.dim, fontSize: 14, textAlign: 'center' },
  footer: { gap: 10, minHeight: 60 },
  error: { color: C.danger, fontSize: 14, textAlign: 'center' },
  link: { color: C.dim, fontSize: 14, textDecorationLine: 'underline' },
});
