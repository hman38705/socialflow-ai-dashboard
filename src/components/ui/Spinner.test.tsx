import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Spinner, LoadingScreen } from './Spinner';

describe('Spinner', () => {
  test('exposes an accessible status name', () => {
    render(<Spinner label="Fetching analytics" />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Fetching analytics');
  });

  test('defaults the label to "Loading"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
  });

  test('applies the size class for each size', () => {
    const { rerender } = render(<Spinner size="sm" />);
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('w-4', 'h-4');
    rerender(<Spinner size="md" />);
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('w-6', 'h-6');
    rerender(<Spinner size="lg" />);
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('w-10', 'h-10');
  });
});

describe('LoadingScreen', () => {
  test('renders a large spinner over the dark background', () => {
    const { container } = render(<LoadingScreen />);
    expect(container.firstChild).toHaveClass('bg-dark-bg');
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('w-10', 'h-10');
  });
});
