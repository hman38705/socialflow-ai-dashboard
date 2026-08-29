import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from '../../types';
import { PagedResponse, Post } from '../../types/post';
import { PostList } from './PostList';

const SAMPLE_POST: Post = {
  id: 'post-1',
  content: 'Launching our new feature today!',
  platform: Platform.TWITTER,
  status: 'scheduled',
  scheduledAt: '2026-01-01T12:00:00.000Z',
  createdAt: '2025-12-01T12:00:00.000Z',
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderPostList(props: Partial<React.ComponentProps<typeof PostList>> = {}) {
  const fetchPosts = vi.fn(
    async (): Promise<PagedResponse<Post>> => ({
      data: [SAMPLE_POST],
      total: 1,
      page: 1,
      limit: 10,
      pages: 1,
    }),
  );

  const utils = render(
    <MemoryRouter initialEntries={['/posts']}>
      <PostList fetchPosts={props.fetchPosts ?? fetchPosts} {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );

  return { ...utils, fetchPosts };
}

describe('PostList', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('syncs the status filter into the URL and back out on re-render', async () => {
    renderPostList();
    await waitFor(() => expect(screen.getByText(SAMPLE_POST.content)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'published' } });

    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('status=published'));
    expect(screen.getByLabelText('Filter by status')).toHaveValue('published');
  });

  it('asks for confirmation before calling onDelete', async () => {
    const onDelete = vi.fn();
    renderPostList({ onDelete });
    await waitFor(() => expect(screen.getByText(SAMPLE_POST.content)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this post?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onDelete).toHaveBeenCalledWith(SAMPLE_POST);
  });

  it('persists the density toggle per user in localStorage', async () => {
    renderPostList();
    await waitFor(() => expect(screen.getByText(SAMPLE_POST.content)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    expect(window.localStorage.getItem('socialflow:postList:density')).toBe('table');
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores density from localStorage on mount', async () => {
    window.localStorage.setItem('socialflow:postList:density', 'table');
    renderPostList();
    await waitFor(() => expect(screen.getByText(SAMPLE_POST.content)).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  });
});
