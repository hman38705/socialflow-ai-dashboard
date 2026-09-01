import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Skeleton, SkeletonText, SkeletonCard } from './Skeleton';

const useReducedMotionMock = vi.fn(() => false as boolean);

vi.mock('framer-motion', () => ({
  useReducedMotion: () => useReducedMotionMock(),
}));

afterEach(() => {
  useReducedMotionMock.mockReturnValue(false);
});

describe('SkeletonText', () => {
  test('renders one bar per line', () => {
    render(<SkeletonText lines={4} />);
    expect(screen.getAllByTestId('skeleton-line')).toHaveLength(4);
  });

  test('the last line is 60% width', () => {
    render(<SkeletonText lines={3} />);
    const bars = screen.getAllByTestId('skeleton-line');
    expect(bars[bars.length - 1]).toHaveClass('w-3/5');
    expect(bars[0]).toHaveClass('w-full');
  });

  test('clamps to at least one line', () => {
    render(<SkeletonText lines={0} />);
    expect(screen.getAllByTestId('skeleton-line')).toHaveLength(1);
  });
});

describe('reduced motion', () => {
  test('drops the animation class when the user prefers reduced motion', () => {
    useReducedMotionMock.mockReturnValue(true);
    const { container } = render(<Skeleton className="h-8 w-8" />);
    expect(container.firstChild).not.toHaveClass('animate-pulse-slow');
  });

  test('keeps the animation class otherwise', () => {
    useReducedMotionMock.mockReturnValue(false);
    const { container } = render(<Skeleton className="h-8 w-8" />);
    expect(container.firstChild).toHaveClass('animate-pulse-slow');
  });
});

test('every skeleton node is aria-hidden', () => {
  const { container: box } = render(<Skeleton />);
  const { container: text } = render(<SkeletonText />);
  const { container: card } = render(<SkeletonCard />);
  expect(box.firstChild).toHaveAttribute('aria-hidden', 'true');
  expect(text.firstChild).toHaveAttribute('aria-hidden', 'true');
  expect(card.firstChild).toHaveAttribute('aria-hidden', 'true');
});
