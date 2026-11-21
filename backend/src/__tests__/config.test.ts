process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';
import { RoleStore } from '../models/Role';
import { AuditLogStore } from '../models/AuditLog';
import { configSchema } from '../config/config';

const SECRET = 'test-secret';

function token(userId: string) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: '15m' });
}

const adminId = 'admin-user-1';
const editorId = 'editor-user-1';

beforeAll(() => {
  RoleStore.assign(adminId, 'admin');
  RoleStore.assign(editorId, 'editor');
});

describe('GET /api/v1/config — admin only', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/v1/config')
      .set('Authorization', `Bearer ${token(editorId)}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 for admin', async () => {
    const res = await request(app)
      .get('/api/v1/config')
      .set('Authorization', `Bearer ${token(adminId)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/v1/config');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/config/refresh — admin only', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/v1/config/refresh')
      .set('Authorization', `Bearer ${token(editorId)}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 for admin and writes audit log', async () => {
    const before = AuditLogStore.recent(1).length;
    const res = await request(app)
      .post('/api/v1/config/refresh')
      .set('Authorization', `Bearer ${token(adminId)}`);
    expect(res.status).toBe(200);
    const after = AuditLogStore.recent(50);
    const entry = after.find((l) => l.resourceId === 'cache' && l.actorId === adminId);
    expect(entry).toBeDefined();
    expect(entry?.action).toBe('org:settings:update');
    void before;
  });
});

describe('SSE ticket TTL config', () => {
  const ENV_KEY = 'SSE_TICKET_TTL_MS';
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it('defaults to the documented TTL value', () => {
    delete process.env[ENV_KEY];
    const parsed = configSchema.parse({});
    expect(parsed[ENV_KEY]).toBe(60_000);
  });

  it('parses an explicit override as a number', () => {
    process.env[ENV_KEY] = '120000';
    const parsed = configSchema.parse({});
    expect(parsed[ENV_KEY]).toBe(120000);
    expect(typeof parsed[ENV_KEY]).toBe('number');
  });

  it('fails validation for an invalid value and names the field', () => {
    process.env[ENV_KEY] = 'not-a-number';
    const result = configSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain(ENV_KEY);
    }
  });
});

describe('PUT /api/v1/config/:key — admin only', () => {
  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .put('/api/v1/config/feature_x')
      .set('Authorization', `Bearer ${token(editorId)}`)
      .send({ value: 'true' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when value is missing', async () => {
    const res = await request(app)
      .put('/api/v1/config/feature_x')
      .set('Authorization', `Bearer ${token(adminId)}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 200 for admin and writes audit log', async () => {
    const res = await request(app)
      .put('/api/v1/config/feature_x')
      .set('Authorization', `Bearer ${token(adminId)}`)
      .send({ value: 'true', type: 'boolean' });
    expect(res.status).toBe(200);
    const logs = AuditLogStore.recent(50);
    const entry = logs.find((l) => l.resourceId === 'feature_x' && l.actorId === adminId);
    expect(entry).toBeDefined();
    expect(entry?.action).toBe('org:settings:update');
    expect(entry?.metadata?.value).toBe('true');
  });
});
