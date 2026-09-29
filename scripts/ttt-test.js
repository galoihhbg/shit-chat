/**
 * Unit tests for the pure tic-tac-toe helpers.
 *
 * These cover the board maths and the turn/outcome logic the UI relies on.
 * The authoritative rules live in SQL and are covered by test:schema --
 * notably `won_board:XXXOO----` and `draw_board:XOXXOOOXX`, which are
 * asserted here too so the two implementations cannot drift apart unnoticed.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  EMPTY_BOARD, LINES,
  cellAt, winningLine, winnerOf, isFull, isValidBoard,
  markFor, isMyTurn, canPlay, outcomeFor, headline,
} = require('../.ttt-tmp/ttt.js');

const X_SESSION = 'session-x';
const O_SESSION = 'session-o';

function game(overrides = {}) {
  return {
    id: 'g1',
    roomId: 'r1',
    playerX: X_SESSION,
    playerO: O_SESSION,
    board: EMPTY_BOARD,
    turn: 'X',
    status: 'active',
    winner: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

test('board validation rejects malformed input', () => {
  assert.strictEqual(isValidBoard(EMPTY_BOARD), true);
  assert.strictEqual(isValidBoard('XOXXOOOXX'), true);
  assert.strictEqual(isValidBoard('XOX'), false);
  assert.strictEqual(isValidBoard('XOXXOOOXZ'), false);
  assert.strictEqual(isValidBoard(null), false);
  assert.strictEqual(isValidBoard(123), false);
});

test('every line is detected as a win', () => {
  for (const line of LINES) {
    const cells = EMPTY_BOARD.split('');
    for (const i of line) cells[i] = 'X';
    const board = cells.join('');
    assert.strictEqual(winnerOf(board), 'X', `line ${line}`);
    assert.deepStrictEqual([...winningLine(board)], [...line]);
  }
});

test('the board the server calls a win agrees here', () => {
  // Exactly the board asserted by scripts/test-schema.sh (won_board).
  assert.strictEqual(winnerOf('XXXOO----'), 'X');
  assert.deepStrictEqual([...winningLine('XXXOO----')], [0, 1, 2]);
});

test('the board the server calls a draw agrees here', () => {
  // Exactly the board asserted by scripts/test-schema.sh (draw_board).
  assert.strictEqual(winnerOf('XOXXOOOXX'), null);
  assert.strictEqual(winningLine('XOXXOOOXX'), null);
  assert.strictEqual(isFull('XOXXOOOXX'), true);
});

test('an empty or partial board has no winner', () => {
  assert.strictEqual(winnerOf(EMPTY_BOARD), null);
  assert.strictEqual(winnerOf('XO-------'), null);
  assert.strictEqual(isFull(EMPTY_BOARD), false);
  assert.strictEqual(isFull('XOXXOOOX-'), false);
});

test('cellAt reads marks and treats everything else as empty', () => {
  assert.strictEqual(cellAt('XO-------', 0), 'X');
  assert.strictEqual(cellAt('XO-------', 1), 'O');
  assert.strictEqual(cellAt('XO-------', 2), '-');
  assert.strictEqual(cellAt('XO-------', 99), '-');
});

test('players are identified by session id', () => {
  assert.strictEqual(markFor(game(), X_SESSION), 'X');
  assert.strictEqual(markFor(game(), O_SESSION), 'O');
  assert.strictEqual(markFor(game(), 'someone-else'), null);
});

test('only the player whose turn it is may move', () => {
  const g = game({ turn: 'X' });
  assert.strictEqual(isMyTurn(g, X_SESSION), true);
  assert.strictEqual(isMyTurn(g, O_SESSION), false);
  assert.strictEqual(isMyTurn(g, 'stranger'), false);
});

test('nobody may move once the game is finished', () => {
  const won = game({ status: 'won', winner: 'X', board: 'XXXOO----' });
  assert.strictEqual(isMyTurn(won, X_SESSION), false);
  assert.strictEqual(canPlay(won, X_SESSION, 5), false);
});

test('canPlay mirrors the server rules', () => {
  const g = game({ board: 'X--------', turn: 'O' });
  assert.strictEqual(canPlay(g, O_SESSION, 0), false, 'occupied');
  assert.strictEqual(canPlay(g, O_SESSION, 1), true);
  assert.strictEqual(canPlay(g, X_SESSION, 1), false, 'not their turn');
  assert.strictEqual(canPlay(g, O_SESSION, -1), false, 'off board');
  assert.strictEqual(canPlay(g, O_SESSION, 9), false, 'off board');
  assert.strictEqual(canPlay(g, O_SESSION, 1.5), false, 'not an integer');
});

test('outcome is reported from each side', () => {
  const won = game({ status: 'won', winner: 'X', board: 'XXXOO----' });
  assert.strictEqual(outcomeFor(won, X_SESSION), 'win');
  assert.strictEqual(outcomeFor(won, O_SESSION), 'loss');
  assert.strictEqual(outcomeFor(won, 'stranger'), null);

  const drawn = game({ status: 'draw', board: 'XOXXOOOXX' });
  assert.strictEqual(outcomeFor(drawn, X_SESSION), 'draw');
  assert.strictEqual(outcomeFor(drawn, O_SESSION), 'draw');

  assert.strictEqual(outcomeFor(game(), X_SESSION), null);
});

test('headline says the right thing to each player', () => {
  const g = game({ turn: 'X' });
  assert.strictEqual(headline(g, X_SESSION), 'YOUR TURN');
  assert.strictEqual(headline(g, O_SESSION), 'THEIR TURN');

  const won = game({ status: 'won', winner: 'X', board: 'XXXOO----' });
  assert.strictEqual(headline(won, X_SESSION), 'YOU WIN');
  assert.match(headline(won, O_SESSION), /COOKED/);

  const drawn = game({ status: 'draw', board: 'XOXXOOOXX' });
  assert.strictEqual(headline(drawn, X_SESSION), 'NOBODY WINS');
});
