import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Icon } from './Icon';

describe('Icon', () => {
  test('is decorative (aria-hidden) by default', () => {
    const { container } = render(<Icon name="search" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role', 'img');
  });

  test('a labelled icon is exposed as role="img" with the label', () => {
    render(<Icon name="bell" label="Notifications" />);
    const img = screen.getByRole('img', { name: 'Notifications' });
    expect(img.tagName.toLowerCase()).toBe('svg');
  });

  test('applies the size in pixels', () => {
    const { container } = render(<Icon name="check" size="lg" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '24');
  });

  test('an unknown name is a type error', () => {
    // @ts-expect-error - "not-a-real-icon" is not in the IconName union
    const bad = <Icon name="not-a-real-icon" />;
    expect(bad).toBeTruthy();
  });
});
