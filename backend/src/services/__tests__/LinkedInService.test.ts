import { ValidationError, RateLimitError } from '../../lib/errors';

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('../CircuitBreakerService', () => ({
  circuitBreakerService: {
    execute: jest.fn((_name: string, fn: () => unknown) => fn()),
  },
}));

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { linkedInService, LINKEDIN_MAX_IMAGES, LinkedInShareRequest } from '../LinkedInService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    json: () => Promise.resolve({}),
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as Response;
}

function errorResponse(
  body: object,
  status = 400,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
  } as unknown as Response;
}

const BASE_REQUEST: LinkedInShareRequest = {
  authorUrn: 'urn:li:person:abc123',
  text: 'Hello LinkedIn!',
};

// ---------------------------------------------------------------------------
// buildShareContent — unit tests (no network)
// ---------------------------------------------------------------------------

describe('LinkedInService.buildShareContent', () => {
  const svc = linkedInService as any;

  it('returns NONE category for a text-only post', () => {
    const content = svc.buildShareContent(BASE_REQUEST);
    expect(content.shareMediaCategory).toBe('NONE');
    expect(content.media).toBeUndefined();
    expect(content.shareCommentary.text).toBe('Hello LinkedIn!');
  });

  it('returns ARTICLE category for a link share', () => {
    const content = svc.buildShareContent({
      ...BASE_REQUEST,
      url: 'https://example.com',
      title: 'My Article',
      description: 'A great read',
    });
    expect(content.shareMediaCategory).toBe('ARTICLE');
    expect(content.media).toHaveLength(1);
    expect(content.media[0].originalUrl).toBe('https://example.com');
    expect(content.media[0].title.text).toBe('My Article');
    expect(content.media[0].description.text).toBe('A great read');
  });

  it('returns IMAGE category for a single-image post', () => {
    const content = svc.buildShareContent({
      ...BASE_REQUEST,
      mediaAssets: [{ url: 'https://cdn.example.com/img1.jpg', title: 'Photo 1' }],
    });
    expect(content.shareMediaCategory).toBe('IMAGE');
    expect(content.media).toHaveLength(1);
    expect(content.media[0].originalUrl).toBe('https://cdn.example.com/img1.jpg');
    expect(content.media[0].title.text).toBe('Photo 1');
    expect(content.media[0].status).toBe('READY');
  });

  it('returns IMAGE category for a multi-image post with 5 assets', () => {
    const assets = Array.from({ length: 5 }, (_, i) => ({
      url: `https://cdn.example.com/img${i + 1}.jpg`,
    }));
    const content = svc.buildShareContent({ ...BASE_REQUEST, mediaAssets: assets });
    expect(content.shareMediaCategory).toBe('IMAGE');
    expect(content.media).toHaveLength(5);
    content.media.forEach((m: any, i: number) => {
      expect(m.originalUrl).toBe(`https://cdn.example.com/img${i + 1}.jpg`);
      expect(m.status).toBe('READY');
    });
  });

  it('returns IMAGE category for exactly 20 images (max limit)', () => {
    const assets = Array.from({ length: 20 }, (_, i) => ({
      url: `https://cdn.example.com/img${i + 1}.jpg`,
    }));
    const content = svc.buildShareContent({ ...BASE_REQUEST, mediaAssets: assets });
    expect(content.shareMediaCategory).toBe('IMAGE');
    expect(content.media).toHaveLength(20);
  });

  it('omits title/description fields when not provided on an image asset', () => {
    const content = svc.buildShareContent({
      ...BASE_REQUEST,
      mediaAssets: [{ url: 'https://cdn.example.com/img.jpg' }],
    });
    expect(content.media[0].title).toBeUndefined();
    expect(content.media[0].description).toBeUndefined();
  });

  it('mediaAssets takes precedence over url when both are provided', () => {
    const content = svc.buildShareContent({
      ...BASE_REQUEST,
      url: 'https://example.com',
      mediaAssets: [{ url: 'https://cdn.example.com/img.jpg' }],
    });
    expect(content.shareMediaCategory).toBe('IMAGE');
    expect(content.media[0].originalUrl).toBe('https://cdn.example.com/img.jpg');
  });
});

// ---------------------------------------------------------------------------
// shareContent — validation (no network)
// ---------------------------------------------------------------------------

describe('LinkedInService.shareContent — validation', () => {
  beforeEach(() => mockFetch.mockReset());

  it('throws ValidationError when mediaAssets array is empty', async () => {
    await expect(
      linkedInService.shareContent('token', { ...BASE_REQUEST, mediaAssets: [] }),
    ).rejects.toThrow(ValidationError);

    await expect(
      linkedInService.shareContent('token', { ...BASE_REQUEST, mediaAssets: [] }),
    ).rejects.toThrow('at least one image');
  });

  it(`throws ValidationError when mediaAssets exceeds ${LINKEDIN_MAX_IMAGES} images`, async () => {
    const assets = Array.from({ length: LINKEDIN_MAX_IMAGES + 1 }, (_, i) => ({
      url: `https://cdn.example.com/img${i + 1}.jpg`,
    }));

    await expect(
      linkedInService.shareContent('token', { ...BASE_REQUEST, mediaAssets: assets }),
    ).rejects.toThrow(ValidationError);

    await expect(
      linkedInService.shareContent('token', { ...BASE_REQUEST, mediaAssets: assets }),
    ).rejects.toThrow(`maximum of ${LINKEDIN_MAX_IMAGES} images`);
  });

  it('does not call fetch when validation fails', async () => {
    const assets = Array.from({ length: 21 }, (_, i) => ({
      url: `https://cdn.example.com/img${i + 1}.jpg`,
    }));
    await linkedInService.shareContent('token', { ...BASE_REQUEST, mediaAssets: assets }).catch(() => {});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws ValidationError when an image URL is not publicly accessible', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({}, 404));

    await expect(
      linkedInService.shareContent('token', {
        ...BASE_REQUEST,
        mediaAssets: [{ url: 'https://cdn.example.com/private-photo.jpg' }],
      }),
    ).rejects.toThrow(ValidationError);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://cdn.example.com/private-photo.jpg');
  });
});

// ---------------------------------------------------------------------------
// shareContent — network integration
// ---------------------------------------------------------------------------

describe('LinkedInService.shareContent — network', () => {
  beforeEach(() => mockFetch.mockReset());

  it('posts a text-only UGC post and returns the post URN', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ 'x-restli-id': 'urn:li:ugcPost:111' }),
    );

    const result = await linkedInService.shareContent('my-token', BASE_REQUEST);

    expect(result.id).toBe('urn:li:ugcPost:111');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/ugcPosts');
    const body = JSON.parse(init.body);
    expect(body.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory).toBe('NONE');
  });

  it('posts a single-image UGC post with correct IMAGE payload', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    mockFetch.mockResolvedValueOnce(
      okResponse({ 'x-restli-id': 'urn:li:ugcPost:222' }),
    );

    const result = await linkedInService.shareContent('my-token', {
      ...BASE_REQUEST,
      mediaAssets: [{ url: 'https://cdn.example.com/photo.jpg', title: 'A photo' }],
    });

    expect(result.id).toBe('urn:li:ugcPost:222');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [headUrl, headInit] = mockFetch.mock.calls[0];
    expect(headUrl).toBe('https://cdn.example.com/photo.jpg');
    expect(headInit.method).toBe('HEAD');

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    const shareContent = body.specificContent['com.linkedin.ugc.ShareContent'];
    expect(shareContent.shareMediaCategory).toBe('IMAGE');
    expect(shareContent.media).toHaveLength(1);
    expect(shareContent.media[0].originalUrl).toBe('https://cdn.example.com/photo.jpg');
    expect(shareContent.media[0].title.text).toBe('A photo');
  });

  it('posts a multi-image UGC post with 3 assets', async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return okResponse();
      }
      return okResponse({ 'x-restli-id': 'urn:li:ugcPost:333' });
    });

    const assets = [
      { url: 'https://cdn.example.com/img1.jpg' },
      { url: 'https://cdn.example.com/img2.jpg', title: 'Second' },
      { url: 'https://cdn.example.com/img3.jpg', description: 'Third desc' },
    ];

    const result = await linkedInService.shareContent('my-token', {
      ...BASE_REQUEST,
      mediaAssets: assets,
    });

    expect(result.id).toBe('urn:li:ugcPost:333');
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(mockFetch.mock.calls.slice(0, 3).every((call) => call[1]?.method === 'HEAD')).toBe(true);

    const body = JSON.parse(mockFetch.mock.calls[3][1].body);
    const shareContent = body.specificContent['com.linkedin.ugc.ShareContent'];
    expect(shareContent.shareMediaCategory).toBe('IMAGE');
    expect(shareContent.media).toHaveLength(3);
    expect(shareContent.media[1].title.text).toBe('Second');
    expect(shareContent.media[2].description.text).toBe('Third desc');
  });

  it('posts a multi-image UGC post with exactly 20 assets (boundary)', async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return okResponse();
      }
      return okResponse({ 'x-restli-id': 'urn:li:ugcPost:444' });
    });

    const assets = Array.from({ length: 20 }, (_, i) => ({
      url: `https://cdn.example.com/img${i + 1}.jpg`,
    }));

    const result = await linkedInService.shareContent('my-token', {
      ...BASE_REQUEST,
      mediaAssets: assets,
    });

    expect(result.id).toBe('urn:li:ugcPost:444');
    expect(mockFetch).toHaveBeenCalledTimes(21);
    expect(mockFetch.mock.calls.slice(0, 20).every((call) => call[1]?.method === 'HEAD')).toBe(true);

    const body = JSON.parse(mockFetch.mock.calls[20][1].body);
    const shareContent = body.specificContent['com.linkedin.ugc.ShareContent'];
    expect(shareContent.media).toHaveLength(20);
  });

  it('uses PUBLIC visibility by default', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ 'x-restli-id': 'urn:li:ugcPost:555' }));

    await linkedInService.shareContent('my-token', BASE_REQUEST);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.visibility['com.linkedin.ugc.MemberNetworkVisibility']).toBe('PUBLIC');
  });

  it('respects CONNECTIONS visibility when specified', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ 'x-restli-id': 'urn:li:ugcPost:666' }));

    await linkedInService.shareContent('my-token', {
      ...BASE_REQUEST,
      visibility: 'CONNECTIONS',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.visibility['com.linkedin.ugc.MemberNetworkVisibility']).toBe('CONNECTIONS');
  });

  it('throws when the LinkedIn API returns an error response', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse({ message: 'Unauthorized', status: 401 }, 401),
    );

    await expect(
      linkedInService.shareContent('bad-token', BASE_REQUEST),
    ).rejects.toThrow('LinkedIn share failed');
  });

  it('throws a RateLimitError with the parsed Retry-After (seconds) on a 429', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse({ message: 'Too Many Requests' }, 429, { 'retry-after': '30' }),
    );

    const promise = linkedInService.shareContent('my-token', BASE_REQUEST);
    await expect(promise).rejects.toBeInstanceOf(RateLimitError);
    await expect(promise.catch((e) => e.retryAfter)).resolves.toBe(30);
  });

  it('parses an HTTP-date Retry-After header into seconds', async () => {
    const retryDate = new Date(Date.now() + 60_000).toUTCString();
    mockFetch.mockResolvedValueOnce(
      errorResponse({ message: 'Too Many Requests' }, 429, { 'retry-after': retryDate }),
    );

    const err = await linkedInService
      .shareContent('my-token', BASE_REQUEST)
      .catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBeGreaterThan(0);
    expect(err.retryAfter).toBeLessThanOrEqual(60);
  });

  it('throws a RateLimitError with undefined retryAfter when the header is missing', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse({ message: 'Too Many Requests' }, 429));

    const err = await linkedInService
      .shareContent('my-token', BASE_REQUEST)
      .catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBeUndefined();
  });

  it('sends the correct Authorization and protocol headers', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ 'x-restli-id': 'urn:li:ugcPost:777' }));

    await linkedInService.shareContent('bearer-xyz', BASE_REQUEST);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer bearer-xyz');
    expect(init.headers['X-Restli-Protocol-Version']).toBe('2.0.0');
    expect(init.headers['Content-Type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// LINKEDIN_MAX_IMAGES constant
// ---------------------------------------------------------------------------

describe('LINKEDIN_MAX_IMAGES', () => {
  it('is 20', () => {
    expect(LINKEDIN_MAX_IMAGES).toBe(20);
  });
});
