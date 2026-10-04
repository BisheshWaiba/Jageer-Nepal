// lib/hooks/useWideGrid.ts
import { useState } from 'react';
import { Platform, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { WEB_SIDEBAR_MIN_WIDTH } from '../components/web/WebSidebarShell';

// A wide web grid wants cards about this wide, so a bigger screen shows more
// of them per row instead of a few huge ones.
const WIDE_CARD_WIDTH = 220;
const WIDE_GRID_GAP = 16;

/** Product-card grids are two to a row on a phone. On wide web this gives
 * as many columns as fit at WIDE_CARD_WIDTH, measured from the grid itself so
 * it follows whatever width the page column ends up with.
 *
 * Spread `containerProps` on the wrapping row (it measures the grid and pulls
 * the outer edges back out), and wrap each card in a View with `cellStyle`.
 * When `wide` is false, render the plain phone grid instead. */
export function useWideGrid() {
  const { width: windowWidth } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const wide = Platform.OS === 'web' && windowWidth >= WEB_SIDEBAR_MIN_WIDTH;
  const columns = Math.min(8, Math.max(2, Math.floor(gridWidth / (WIDE_CARD_WIDTH + WIDE_GRID_GAP))));

  return {
    wide,
    containerProps: {
      onLayout: (e: LayoutChangeEvent) => setGridWidth(e.nativeEvent.layout.width),
      // Each cell pads half the gap on both sides; this pulls the outer edges
      // back out so the grid still lines up with the page.
      style: wide ? { marginHorizontal: -WIDE_GRID_GAP / 2 } : undefined,
    },
    cellStyle: { width: `${100 / columns}%` as `${number}%`, paddingHorizontal: WIDE_GRID_GAP / 2 },
  };
}
