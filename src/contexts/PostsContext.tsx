import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type PostStatus = 'scheduled' | 'published' | 'draft';

export interface ScheduledPost {
  id: string;
  content: string;
  platform: string;
  hashtags: string[];
  mediaType: 'text' | 'image' | 'video' | 'carousel';
  scheduledAt: number; // Unix ms
  reachScore: number;
  status: PostStatus;
}

interface PostsContextValue {
  posts: ScheduledPost[];
  addPost: (post: Omit<ScheduledPost, 'id' | 'status'> & { status?: PostStatus }) => ScheduledPost;
  removePost: (id: string) => void;
  updateStatus: (id: string, status: PostStatus) => void;
}

const STORAGE_KEY = 'sf_scheduled_posts';

const seed = (): ScheduledPost[] => {
  const now = Date.now();
  const h = 3600_000;
  return [
    {
      id: 'seed-1',
      content: 'Excited to announce our new product launch! 🚀 Check it out #innovation #tech',
      platform: 'instagram',
      hashtags: ['innovation', 'tech', 'startup'],
      mediaType: 'image',
      scheduledAt: now + 2 * h,
      reachScore: 88,
      status: 'scheduled',
    },
    {
      id: 'seed-2',
      content: 'Behind the scenes of our latest campaign. Link in bio! #BTS #marketing',
      platform: 'tiktok',
      hashtags: ['BTS', 'marketing'],
      mediaType: 'video',
      scheduledAt: now + 5 * h,
      reachScore: 72,
      status: 'scheduled',
    },
    {
      id: 'seed-3',
      content: 'Industry insights: The future of social media marketing in 2026.',
      platform: 'linkedin',
      hashtags: [],
      mediaType: 'text',
      scheduledAt: now + 26 * h,
      reachScore: 61,
      status: 'draft',
    },
  ];
};

const PostsContext = createContext<PostsContextValue | null>(null);

export const PostsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [posts, setPosts] = useState<ScheduledPost[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ScheduledPost[]) : seed();
    } catch {
      return seed();
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  }, [posts]);

  const addPost = useCallback<PostsContextValue['addPost']>((post) => {
    const created: ScheduledPost = {
      ...post,
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: post.status ?? 'scheduled',
    };
    setPosts((prev) => [created, ...prev]);
    return created;
  }, []);

  const removePost = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const updateStatus = useCallback((id: string, status: PostStatus) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
  }, []);

  return (
    <PostsContext.Provider value={{ posts, addPost, removePost, updateStatus }}>
      {children}
    </PostsContext.Provider>
  );
};

export const usePosts = (): PostsContextValue => {
  const ctx = useContext(PostsContext);
  if (!ctx) throw new Error('usePosts must be used within a PostsProvider');
  return ctx;
};
