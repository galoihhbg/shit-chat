/**
 * End-of-session summary.
 *
 * Everything here is derived from things the app already knows: when the
 * session started, who it matched with, and how the games it already
 * subscribes to ended. Nothing is tracked or stored server side for this.
 *
 * Pure, so it is unit tested in scripts/stats-test.js.
 */

export type SessionStats = {
  startedAt: number;
  endedAt: number;
  peopleMet: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
};

export function emptyStats(startedAt: number): SessionStats {
  return {
    startedAt,
    endedAt: startedAt,
    peopleMet: 0,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    gamesDrawn: 0,
  };
}

export function durationSeconds(stats: SessionStats): number {
  return Math.max(0, Math.round((stats.endedAt - stats.startedAt) / 1000));
}

/** "8m 42s", or "42s" when it was a quick one. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** A title, awarded generously. */
export function rank(stats: SessionStats): string {
  if (stats.gamesWon >= 2) return 'Toilet Champion';
  if (stats.gamesWon >= 1) return 'Certified Shitter';
  if (stats.gamesPlayed >= 1) return 'Flushed With Shame';
  if (stats.peopleMet >= 1) return 'Social Shitter';
  return 'Lone Wolf';
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Lines shown on the summary screen and reused in the share text. */
export function statLines(stats: SessionStats): string[] {
  const lines = [
    formatDuration(durationSeconds(stats)),
    plural(stats.peopleMet, 'person met', 'people met'),
  ];

  if (stats.gamesPlayed > 0) {
    lines.push(plural(stats.gamesPlayed, 'game played', 'games played'));
    if (stats.gamesWon > 0) lines.push(plural(stats.gamesWon, 'game won', 'games won'));
  }

  return lines;
}

export function buildShareText(stats: SessionStats): string {
  return [
    'SHITCHAT',
    'TOILET SESSION COMPLETE 🚽',
    '',
    ...statLines(stats),
    '',
    `"${rank(stats)}"`,
  ].join('\n');
}
