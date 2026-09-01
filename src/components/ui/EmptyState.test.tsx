import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Inbox } from 'lucide-react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  test('renders title and description and fires the action', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={Inbox}
        title="No posts yet"
        description="Create your first post to get started."
        action={{ label: 'New post', onClick }}
      />,
    );
    expect(screen.getByText('No posts yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first post to get started.')).toBeInTheDocument();

    screen.getByRole('button', { name: 'New post' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('error variant is an alert with a retry action', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={Inbox}
        title="Could not load"
        variant="error"
        action={{ label: 'Retry', onClick }}
      />,
    );
    const container = screen.getByRole('alert');
    expect(container).toHaveClass('border-primary-rose/25');
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('non-error variant is a status region', () => {
    render(<EmptyState icon={Inbox} title="No results" variant="no-results" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
