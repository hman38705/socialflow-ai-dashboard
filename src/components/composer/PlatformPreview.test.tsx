import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PlatformPreview, truncateForPlatform, cropForPlatform } from './PlatformPreview';
import type { ComposerDraft } from '../../contexts/ComposerContext';

const draftWith = (overrides: Partial<ComposerDraft>): ComposerDraft => ({
  content: '',
  platforms: [],
  platformOverrides: {},
  media: [],
  scheduledAt: null,
  ...overrides,
});

describe('truncateForPlatform', () => {
  test('does not truncate content within the platform limit', () => {
    const result = truncateForPlatform('short caption', 'x');
    expect(result).toEqual({ visible: 'short caption', truncated: false, cutoffIndex: null });
  });

  test('truncates exactly at the platform boundary', () => {
    const text = 'a'.repeat(300);
    const result = truncateForPlatform(text, 'x');
    expect(result.truncated).toBe(true);
    expect(result.cutoffIndex).toBe(280);
    expect(result.visible).toHaveLength(280);
    expect(result.visible).toBe(text.slice(0, 280));
  });

  test('respects each platform's own truncation boundary', () => {
    const text = 'b'.repeat(200);
    expect(truncateForPlatform(text, 'instagram').cutoffIndex).toBe(125);
    expect(truncateForPlatform(text, 'youtube').cutoffIndex).toBe(100);
  });
});

describe('cropForPlatform', () => {
  test('crops the sides when the source is wider than the target aspect ratio', () => {
    // A 16:9 image (ratio ~1.78) placed into Instagram's 1:1 target crops width, keeps full height.
    const { widthPct, heightPct } = cropForPlatform(16 / 9, 'instagram');
    expect(heightPct).toBe(100);
    expect(widthPct).toBeCloseTo((1 / (16 / 9)) * 100, 5);
    expect(widthPct).toBeLessThan(100);
  });

  test('crops top/bottom when the source is taller than the target aspect ratio', () => {
    // A 1:1 image placed into X's 16:9 target crops height, keeps full width.
    const { widthPct, heightPct } = cropForPlatform(1, 'x');
    expect(widthPct).toBe(100);
    expect(heightPct).toBeLessThan(100);
  });

  test('applies no crop when the source already matches the target aspect ratio', () => {
    const { widthPct, heightPct } = cropForPlatform(1, 'instagram');
    expect(widthPct).toBe(100);
    expect(heightPct).toBe(100);
  });
});

describe('PlatformPreview', () => {
  test('prompts to select a platform when none are chosen', () => {
    render(<PlatformPreview draft={draftWith({})} />);
    expect(screen.getByText('Select a platform to see its preview.')).toBeInTheDocument();
  });

  test('labels every preview as approximate', () => {
    render(<PlatformPreview draft={draftWith({ platforms: ['x'], content: 'hello' })} />);
    expect(screen.getAllByText('Preview — approximate').length).toBeGreaterThan(0);
  });

  test('shows a tab per selected platform for the below-lg layout', () => {
    render(<PlatformPreview draft={draftWith({ platforms: ['x', 'instagram'], content: 'hi' })} />);
    expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instagram' })).toBeInTheDocument();
  });

  test('switching tabs changes the active single-platform preview', () => {
    render(
      <PlatformPreview
        draft={draftWith({
          platforms: ['x', 'instagram'],
          content: 'hi',
          platformOverrides: { instagram: 'insta-only copy' },
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    expect(screen.getAllByText(/insta-only copy/).length).toBeGreaterThan(0);
  });
});
