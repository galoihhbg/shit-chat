import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BOARD_SIZE, cellAt, type Mark } from '../lib/game/ttt';
import { C } from '../theme';

type Props = {
  board: string;
  /** Cells to highlight, i.e. the winning streak. */
  highlight?: readonly number[] | null;
  /** Which cells are tappable right now. */
  playable?: (cell: number) => boolean;
  onPlay?: (cell: number) => void;
  disabled?: boolean;
};

const MARK_COLOR: Record<Mark, string> = {
  X: C.gold,
  O: C.white,
};

export function Board({ board, highlight, playable, onPlay, disabled }: Props) {
  const cells = Array.from({ length: BOARD_SIZE }, (_, i) => i);

  return (
    <View style={styles.grid}>
      {cells.map((i) => {
        const mark = cellAt(board, i);
        const isHot = !!highlight?.includes(i);
        const canTap = !disabled && !!playable?.(i);

        return (
          <Pressable
            key={i}
            testID={`cell-${i}`}
            onPress={() => canTap && onPlay?.(i)}
            disabled={!canTap}
            style={({ pressed }) => [
              styles.cell,
              isHot && styles.cellHot,
              canTap && pressed && styles.cellPressed,
            ]}
          >
            <Text
              style={[
                styles.mark,
                mark !== '-' && { color: MARK_COLOR[mark] },
                isHot && styles.markHot,
              ]}
            >
              {mark === '-' ? '' : mark}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'center',
    width: 300,
    gap: 8,
  },
  cell: {
    width: 94,
    height: 94,
    borderRadius: 14,
    backgroundColor: C.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellHot: { backgroundColor: C.ok },
  cellPressed: { opacity: 0.6 },
  mark: { fontSize: 48, fontWeight: '900', color: 'transparent' },
  markHot: { color: C.bg },
});
