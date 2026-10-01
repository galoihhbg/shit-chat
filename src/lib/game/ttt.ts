/**
 * Pure tic-tac-toe helpers. No I/O, no React -- unit tested in
 * scripts/ttt-test.js.
 *
 * The server is the referee: public.make_move decides every outcome. The line
 * detection here exists because the board still has to be drawn, and drawing
 * the winning streak needs the same eight lines. Both copies are tested, so a
 * drift between them shows up rather than silently disagreeing.
 *
 * Boards are nine characters, '-' for empty, read left to right, top to
 * bottom. Cells are 0..8; the SQL side shifts to 1-indexed internally.
 */

export type Mark = 'X' | 'O';
export type Cell = Mark | '-';
export type GameStatus = 'active' | 'won' | 'draw' | 'abandoned';

export const EMPTY_BOARD = '---------';
export const BOARD_SIZE = 9;

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export type TttGame = {
  id: string;
  roomId: string;
  playerX: string;
  playerO: string;
  board: string;
  turn: Mark;
  status: GameStatus;
  winner: Mark | null;
  createdAt: string;
  updatedAt: string;
};

export function isValidBoard(board: unknown): board is string {
  return typeof board === 'string' && board.length === BOARD_SIZE && /^[XO-]{9}$/.test(board);
}

export function cellAt(board: string, index: number): Cell {
  const c = board[index];
  return c === 'X' || c === 'O' ? c : '-';
}

/** The three cells that won it, for highlighting. Null if nobody has. */
export function winningLine(board: string): readonly number[] | null {
  if (!isValidBoard(board)) return null;
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark !== '-' && mark === board[b] && mark === board[c]) return line;
  }
  return null;
}

export function winnerOf(board: string): Mark | null {
  const line = winningLine(board);
  return line ? (board[line[0]] as Mark) : null;
}

export function isFull(board: string): boolean {
  return isValidBoard(board) && !board.includes('-');
}

/** Which side am I, if any? */
export function markFor(game: TttGame, sessionId: string): Mark | null {
  if (game.playerX === sessionId) return 'X';
  if (game.playerO === sessionId) return 'O';
  return null;
}

export function isMyTurn(game: TttGame, sessionId: string): boolean {
  return game.status === 'active' && markFor(game, sessionId) === game.turn;
}

/** Can I legally tap this cell right now? Mirrors the server's checks. */
export function canPlay(game: TttGame, sessionId: string, cell: number): boolean {
  return (
    Number.isInteger(cell) &&
    cell >= 0 &&
    cell < BOARD_SIZE &&
    isMyTurn(game, sessionId) &&
    cellAt(game.board, cell) === '-'
  );
}

export type Outcome = 'win' | 'loss' | 'draw';

export function outcomeFor(game: TttGame, sessionId: string): Outcome | null {
  // An abandoned game is not a result. Nobody won it and it does not count
  // towards games played.
  if (game.status === 'abandoned') return null;
  if (game.status === 'draw') return 'draw';
  if (game.status !== 'won' || !game.winner) return null;
  const mine = markFor(game, sessionId);
  if (!mine) return null;
  return game.winner === mine ? 'win' : 'loss';
}

/** The one line of copy at the top of the board. */
export function headline(game: TttGame, sessionId: string): string {
  if (game.status === 'abandoned') return 'THEY LEFT';
  const outcome = outcomeFor(game, sessionId);
  if (outcome === 'win') return 'YOU WIN';
  if (outcome === 'loss') return 'YOU GOT COOKED 💩';
  if (outcome === 'draw') return 'NOBODY WINS';
  return isMyTurn(game, sessionId) ? 'YOUR TURN' : 'THEIR TURN';
}
