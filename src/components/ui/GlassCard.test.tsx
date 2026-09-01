import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlassCard } from './GlassCard';

describe('GlassCard', () => {
  it('renders its children', () => {
    render(<GlassCard>Hello world</GlassCard>);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('applies the glass surface styling by default', () => {
    const { container } = render(<GlassCard>Content</GlassCard>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('bg-dark-surface/80');
    expect(card).toHaveClass('backdrop-blur-xl');
    expect(card).toHaveClass('border-dark-border');
    expect(card).toHaveClass('rounded-2xl');
    expect(card).toHaveClass('shadow-elev-2');
    expect(card).toHaveClass('p-6');
  });

  it('merges a custom className with the defaults', () => {
    const { container } = render(<GlassCard className="max-w-2xl space-y-6">Content</GlassCard>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('max-w-2xl', 'space-y-6');
    expect(card).toHaveClass('p-6');
  });

  it('renders with a stagger delay without breaking', () => {
    render(
      <GlassCard delay={0.2}>
        <span>Delayed</span>
      </GlassCard>,
    );
    expect(screen.getByText('Delayed')).toBeInTheDocument();
  });
});
