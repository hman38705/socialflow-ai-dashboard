import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Badge, type BadgeVariant } from './Badge';

describe('Badge', () => {
  test('renders its content', () => {
    render(<Badge>Draft</Badge>);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  test('each variant maps to its own token class', () => {
    const cases: Array<[BadgeVariant, string]> = [
      ['neutral', 'text-gray-subtext'],
      ['info', 'text-primary-blue'],
      ['success', 'text-trend-up'],
      ['warning', 'text-amber-400'],
      ['danger', 'text-primary-rose'],
    ];
    for (const [variant, token] of cases) {
      const { container, unmount } = render(<Badge variant={variant}>x</Badge>);
      expect(container.firstChild).toHaveClass(token);
      unmount();
    }
  });

  test('dot is decorative and only rendered when requested', () => {
    const { container: withDot } = render(
      <Badge variant="success" dot>
        Live
      </Badge>,
    );
    const dot = withDot.querySelector('span[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();

    const { container: noDot } = render(<Badge variant="success">Live</Badge>);
    expect(noDot.querySelector('span[aria-hidden="true"]')).not.toBeInTheDocument();
  });
});
