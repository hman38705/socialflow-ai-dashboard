import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import '@testing-library/jest-dom';
import { MobileNav } from './MobileNav';

// jsdom has no matchMedia; provide a controllable stub.
let mediaMatches = true;
const listeners = new Set<(e: MediaQueryListEvent) => void>();

beforeEach(() => {
  mediaMatches = true;
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    matches: mediaMatches,
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

function Harness() {
  return (
    <MemoryRouter initialEntries={['/analytics']}>
      <MobileNav />
      <Link to="/predictor">go predictor</Link>
      <Routes>
        <Route path="/analytics" element={<p>analytics page</p>} />
        <Route path="/predictor" element={<p>predictor page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('MobileNav', () => {
  test('renders the hamburger only when the media query matches', () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();

    // simulate leaving the mobile breakpoint
    act(() => {
      mediaMatches = false;
      listeners.forEach((cb) => cb({ matches: false } as MediaQueryListEvent));
    });
    rerender(<Harness />);
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();
  });

  test('the drawer closes automatically on navigation', () => {
    render(<Harness />);
    act(() => screen.getByRole('button', { name: 'Open navigation' }).click());
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();

    act(() => screen.getByRole('link', { name: 'go predictor' }).click());
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  test('the hamburger tap target is at least 44px', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Open navigation' });
    expect(btn.className).toMatch(/h-11/);
    expect(btn.className).toMatch(/w-11/);
  });
});
