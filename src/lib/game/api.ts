import { supabase } from '../supabase';
import type { GameStatus, Mark, TttGame } from './ttt';

/**
 * Thin wrapper over the game RPCs. Every rule lives in Postgres; this file
 * only moves rows around and renames columns.
 */

type GameRow = {
  id: string;
  room_id: string;
  player_x: string;
  player_o: string;
  board: string;
  turn: string;
  status: string;
  winner: string | null;
  created_at: string;
  updated_at: string;
};

const GAME_COLUMNS = 'id, room_id, player_x, player_o, board, turn, status, winner, created_at, updated_at';

export function toGame(row: GameRow): TttGame {
  return {
    id: row.id,
    roomId: row.room_id,
    playerX: row.player_x,
    playerO: row.player_o,
    board: row.board,
    turn: (row.turn === 'O' ? 'O' : 'X') as Mark,
    status: (['active', 'won', 'draw'].includes(row.status) ? row.status : 'active') as GameStatus,
    winner: row.winner === 'X' || row.winner === 'O' ? row.winner : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The RPCs raise friendly messages on purpose ("Not your turn."), so the
 * message is shown to the player rather than swallowed.
 */
class GameError extends Error {}

function rethrow(error: { message?: string } | null, fallback: string): never {
  throw new GameError(error?.message || fallback);
}

/** Starts a game, joins the running one, or deals a rematch. Same call. */
export async function startGame(sessionId: string): Promise<TttGame> {
  const { data, error } = await supabase.rpc('start_game', { p_session: sessionId });
  if (error) rethrow(error, 'Could not start the game.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) rethrow(null, 'Could not start the game.');
  return toGame(row as GameRow);
}

export async function makeMove(
  sessionId: string,
  gameId: string,
  cell: number
): Promise<TttGame> {
  const { data, error } = await supabase.rpc('make_move', {
    p_session: sessionId,
    p_game: gameId,
    p_cell: cell,
  });
  if (error) rethrow(error, 'That move did not land.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) rethrow(null, 'That move did not land.');
  return toGame(row as GameRow);
}

/** The game currently running in this room, if any. */
export async function fetchLatestGame(roomId: string): Promise<TttGame | null> {
  const { data, error } = await supabase
    .from('games')
    .select(GAME_COLUMNS)
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return toGame(data as GameRow);
}

/** Both players watch the same room, so either side can start a game. */
export function subscribeToGames(roomId: string, onGame: (game: TttGame) => void) {
  const channel = supabase
    .channel(`games:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `room_id=eq.${roomId}` },
      (payload) => {
        const row = payload.new as GameRow | undefined;
        if (row?.id) onGame(toGame(row));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
