import { computePlacement } from './overlayPosition';

const viewport = { width: 1000, height: 800 };
const floating = { width: 100, height: 40 };

describe('computePlacement', () => {
  test('keeps the preferred side when it fits', () => {
    const anchor = { top: 400, left: 400, width: 80, height: 20 };
    const p = computePlacement(anchor, floating, 'bottom', viewport);
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(400 + 20 + 8);
  });

  test('flips to the opposite side when the preferred one overflows', () => {
    // Anchor near the bottom edge: not enough room below for the floating element.
    const anchor = { top: 780, left: 400, width: 80, height: 20 };
    const p = computePlacement(anchor, floating, 'bottom', viewport);
    expect(p.side).toBe('top');
    expect(p.top).toBe(780 - floating.height - 8);
  });

  test('clamps the cross axis so the element stays on screen', () => {
    // Anchor hard against the right edge: centered placement would overflow right.
    const anchor = { top: 100, left: 980, width: 20, height: 20 };
    const p = computePlacement(anchor, floating, 'bottom', viewport);
    expect(p.left).toBeLessThanOrEqual(viewport.width - floating.width - 8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
});
