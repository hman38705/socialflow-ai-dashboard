import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatBadge } from './StatBadge';

describe('StatBadge', () => {
  test('positive delta: up arrow, trend-up token, spoken "up N percent"', () => {
    const { container } = render(<StatBadge delta={12.5} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge).toHaveClass('text-trend-up');
    expect(badge).toHaveTextContent('+12.5%');
    expect(screen.getByText('up 12.5 percent')).toBeInTheDocument();
    // arrow glyph present, not the only signal
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  test('negative delta: down arrow, trend-down token, spoken "down N percent"', () => {
    const { container } = render(<StatBadge delta={-3.2} />);
    expect(container.firstChild).toHaveClass('text-trend-down');
    expect(container.firstChild).toHaveTextContent('-3.2%');
    expect(screen.getByText('down 3.2 percent')).toBeInTheDocument();
  });

  test('zero delta: neutral gray, no arrow, spoken "no change"', () => {
    const { container } = render(<StatBadge delta={0} />);
    expect(container.firstChild).toHaveClass('text-gray-subtext');
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByText('no change')).toBeInTheDocument();
    expect(container.firstChild).toHaveTextContent('0%');
  });

  test('precision controls the displayed decimals', () => {
    const { container } = render(<StatBadge delta={7} precision={0} />);
    expect(container.firstChild).toHaveTextContent('+7%');
  });
});
