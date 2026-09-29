import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLatestGame, makeMove, startGame, subscribeToGames } from './api';
import { canPlay, outcomeFor, type Outcome, type TttGame } from './ttt';

type Options = {
  /** Fired once per finished game, for the end-of-session summary. */
  onFinished?: (outcome: Outcome) => void;
};

export type TicTacToe = {
  game: TttGame | null;
  busy: boolean;
  error: string | null;
  /** A game the other player started that we have not looked at yet. */
  incomingChallenge: boolean;
  start: () => void;
  play: (cell: number) => void;
  acknowledge: () => void;
  dismissError: () => void;
};

/**
 * Owns the room's game state.
 *
 * Both players subscribe to the same room, so whoever taps PLAY first deals
 * the game and the other side simply receives it. The server decides every
 * outcome; nothing here is optimistic, which costs a round trip per move and
 * buys us a board that cannot disagree with the other player's.
 */
export function useTicTacToe(
  sessionId: string,
  roomId: string | null,
  { onFinished }: Options = {}
): TicTacToe {
  const [game, setGame] = useState<TttGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seenGameId, setSeenGameId] = useState<string | null>(null);

  // Report each finished game exactly once, even though realtime can deliver
  // the final row more than once.
  const reported = useRef(new Set<string>());
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const absorb = useCallback(
    (incoming: TttGame) => {
      setGame((prev) => {
        // Realtime and RPC replies race; keep whichever is newer.
        if (prev && prev.id === incoming.id && prev.updatedAt > incoming.updatedAt) return prev;
        return incoming;
      });

      if (incoming.status !== 'active' && !reported.current.has(incoming.id)) {
        const outcome = outcomeFor(incoming, sessionId);
        if (outcome) {
          reported.current.add(incoming.id);
          onFinishedRef.current?.(outcome);
        }
      }
    },
    [sessionId]
  );

  useEffect(() => {
    if (!roomId) return;

    let alive = true;
    fetchLatestGame(roomId)
      .then((existing) => {
        if (alive && existing) absorb(existing);
      })
      .catch(() => {
        // Nothing running yet, or offline. PLAY will surface a real error.
      });

    const unsubscribe = subscribeToGames(roomId, (incoming) => {
      if (alive) absorb(incoming);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [roomId, absorb]);

  const start = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError(null);
    startGame(sessionId)
      .then((fresh) => {
        absorb(fresh);
        setSeenGameId(fresh.id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }, [busy, sessionId, absorb]);

  const play = useCallback(
    (cell: number) => {
      if (busy || !game) return;
      // Checked again on the server; this just avoids a pointless round trip.
      if (!canPlay(game, sessionId, cell)) return;

      setBusy(true);
      setError(null);
      makeMove(sessionId, game.id, cell)
        .then(absorb)
        .catch((err: Error) => setError(err.message))
        .finally(() => setBusy(false));
    },
    [busy, game, sessionId, absorb]
  );

  const acknowledge = useCallback(() => {
    setSeenGameId(game?.id ?? null);
  }, [game]);

  return {
    game,
    busy,
    error,
    incomingChallenge:
      !!game && game.status === 'active' && game.id !== seenGameId,
    start,
    play,
    acknowledge,
    dismissError: useCallback(() => setError(null), []),
  };
}
