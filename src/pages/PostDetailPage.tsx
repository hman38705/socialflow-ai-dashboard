import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { OpenAPI } from '../api/core/OpenAPI';
import { request as apiRequest } from '../api/core/request';
import { ApiError } from '../api/core/ApiError';

interface PostTimelineEntry {
  stage: 'created' | 'scheduled' | 'published' | 'failed';
  timestamp: string;
}

interface PostAnalytics {
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
}

interface PostDetail {
  id: string;
  content: string;
  media: { url: string; type: 'image' | 'video' }[];
  platforms: string[];
  status: 'created' | 'scheduled' | 'published' | 'failed';
  errorReason?: string;
  timeline: PostTimelineEntry[];
  analytics?: PostAnalytics;
}

function formatInUserTimezone(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const TIMELINE_STAGES: PostTimelineEntry['stage'][] = [
  'created',
  'scheduled',
  'published',
  'failed',
];

function TimelineSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-4 w-48 rounded bg-dark-surface" />
      ))}
    </div>
  );
}

function PostDetailSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse" data-testid="post-detail-skeleton">
      <div className="h-6 w-64 rounded bg-dark-surface" />
      <div className="h-40 w-full rounded-xl bg-dark-surface" />
      <div className="h-24 w-full rounded-xl bg-dark-surface" />
      <TimelineSkeleton />
    </div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="p-10 text-center text-gray-subtext" data-testid="post-not-found">
      <h1 className="text-xl font-semibold text-white mb-2">Post not found</h1>
      <p>No post exists with id &quot;{id}&quot;.</p>
    </div>
  );
}

async function fetchPost(id: string): Promise<PostDetail> {
  return apiRequest<PostDetail>(OpenAPI, {
    method: 'GET',
    url: '/posts/{id}',
    path: { id },
  });
}

async function retryPost(id: string): Promise<void> {
  await apiRequest(OpenAPI, {
    method: 'POST',
    url: '/posts/{id}/retry',
    path: { id },
  });
}

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    try {
      const data = await fetchPost(id);
      setPost(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRetry = async () => {
    if (!id) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await retryPost(id);
      await load();
    } catch {
      setRetryError('Retry failed. Please try again.');
    } finally {
      setRetrying(false);
    }
  };

  if (!id) {
    return <NotFound id="" />;
  }

  if (loading) {
    return <PostDetailSkeleton />;
  }

  if (notFound || !post) {
    return <NotFound id={id} />;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" data-testid="post-detail-page">
      <header>
        <h1 className="text-xl font-semibold text-white">Post detail</h1>
        <p className="text-sm text-gray-subtext">{post.platforms.join(', ')}</p>
      </header>

      <section className="rounded-xl border border-dark-border bg-dark-surface p-4">
        <p className="whitespace-pre-wrap text-white">{post.content}</p>
        {post.media.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {post.media.map((m, i) =>
              m.type === 'image' ? (
                <img key={i} src={m.url} alt="" className="rounded-lg object-cover w-full h-32" />
              ) : (
                <video key={i} src={m.url} controls className="rounded-lg w-full h-32" />
              ),
            )}
          </div>
        )}
      </section>

      {post.status === 'failed' && (
        <section className="rounded-xl border border-primary-rose/40 bg-primary-rose/10 p-4">
          <p className="text-sm text-primary-rose font-medium">
            Failed: {post.errorReason ?? 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            data-testid="retry-post"
            className="mt-3 rounded-lg bg-primary-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
          {retryError && <p className="mt-2 text-xs text-primary-rose">{retryError}</p>}
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-subtext uppercase mb-3">Status timeline</h2>
        <ol className="space-y-2" data-testid="post-timeline">
          {TIMELINE_STAGES.filter((stage) =>
            post.timeline.some((entry) => entry.stage === stage),
          ).map((stage) => {
            const entry = post.timeline.find((e) => e.stage === stage);
            if (!entry) return null;
            return (
              <li key={stage} className="flex items-center justify-between text-sm">
                <span className="capitalize text-white">{stage}</span>
                <span className="text-gray-subtext font-mono">
                  {formatInUserTimezone(entry.timestamp)}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {post.analytics && (
        <section>
          <h2 className="text-sm font-semibold text-gray-subtext uppercase mb-3">Analytics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="post-analytics">
            {Object.entries(post.analytics).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-dark-surface p-3 text-center">
                <div className="text-lg font-semibold text-white">{value}</div>
                <div className="text-xs text-gray-subtext capitalize">{key}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
