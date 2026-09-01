// === Types

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  side: Side;
  /** Coordinates in the same space as `anchor` (viewport coordinates when the anchor
   *  rect comes from `getBoundingClientRect`). */
  top: number;
  left: number;
}

// === Helpers

const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function coordsFor(
  side: Side,
  anchor: AnchorRect,
  floating: FloatingSize,
  gap: number,
): { top: number; left: number } {
  switch (side) {
    case 'top':
      return {
        top: anchor.top - floating.height - gap,
        left: anchor.left + anchor.width / 2 - floating.width / 2,
      };
    case 'bottom':
      return {
        top: anchor.top + anchor.height + gap,
        left: anchor.left + anchor.width / 2 - floating.width / 2,
      };
    case 'left':
      return {
        top: anchor.top + anchor.height / 2 - floating.height / 2,
        left: anchor.left - floating.width - gap,
      };
    case 'right':
      return {
        top: anchor.top + anchor.height / 2 - floating.height / 2,
        left: anchor.left + anchor.width + gap,
      };
  }
}

function fits(
  coords: { top: number; left: number },
  floating: FloatingSize,
  viewport: Viewport,
): boolean {
  return (
    coords.top >= 0 &&
    coords.left >= 0 &&
    coords.top + floating.height <= viewport.height &&
    coords.left + floating.width <= viewport.width
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// === Public API

/**
 * Position a floating element next to an anchor on `preferred` side, flipping to the
 * opposite side when the preferred one would overflow the viewport, then clamping the
 * cross-axis so the element stays fully on screen. No external positioning library.
 */
export function computePlacement(
  anchor: AnchorRect,
  floating: FloatingSize,
  preferred: Side,
  viewport: Viewport,
  gap = 8,
): Placement {
  const primary = coordsFor(preferred, anchor, floating, gap);
  let side = preferred;
  let coords = primary;

  if (!fits(primary, floating, viewport)) {
    const flipped = coordsFor(OPPOSITE[preferred], anchor, floating, gap);
    if (fits(flipped, floating, viewport)) {
      side = OPPOSITE[preferred];
      coords = flipped;
    }
  }

  return {
    side,
    top: clamp(coords.top, gap, Math.max(gap, viewport.height - floating.height - gap)),
    left: clamp(coords.left, gap, Math.max(gap, viewport.width - floating.width - gap)),
  };
}
