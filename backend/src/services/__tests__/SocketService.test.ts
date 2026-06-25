import jwt from 'jsonwebtoken';
import { SocketService } from '../SocketService';
import { prisma } from '../../lib/prisma';

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    duplicate: jest.fn().mockReturnThis(),
  })),
);

jest.mock('../../lib/prisma', () => ({
  prisma: {
    organizationMember: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

class MockSocket {
  public id: string;
  public handshake: any;
  public user?: any;
  public joinedRooms = new Set<string>();
  public emittedEvents: Array<{ event: string; payload?: any }> = [];
  public handlers: Record<string, (...args: any[]) => void> = {};

  constructor(id: string, handshake: any = {}) {
    this.id = id;
    this.handshake = handshake;
  }

  public join(room: string): void {
    this.joinedRooms.add(room);
  }

  public emit(event: string, payload?: any): void {
    this.emittedEvents.push({ event, payload });
  }

  public to(room: string): { emit: (event: string, payload?: any) => void } {
    return { emit: jest.fn() };
  }

  public on(event: string, handler: (...args: any[]) => void): void {
    this.handlers[event] = handler;
  }

  public broadcast = { emit: jest.fn() };
}

class MockServer {
  public middleware: Array<(socket: MockSocket, next: (err?: Error) => void) => void> = [];
  public connectionHandlers: Array<(socket: MockSocket) => void> = [];
  public rooms = new Map<string, Set<string>>();

  public use(handler: (socket: MockSocket, next: (err?: Error) => void) => void): void {
    this.middleware.push(handler);
  }

  public on(event: string, handler: (socket: MockSocket) => void): void {
    if (event === 'connection') {
      this.connectionHandlers.push(handler);
    }
  }

  public to(room: string): { emit: (event: string, payload?: any) => void } {
    return { emit: jest.fn() };
  }

  public adapter(_adapter: unknown): void {}

  public emit(event: string, payload?: any): void {}

  public close(): void {}
}

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => new MockServer()),
}));

describe('SocketService', () => {
  const mockedJwtVerify = jwt.verify as jest.Mock;
  const mockedPrisma = prisma as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (SocketService as any).instance = undefined;
  });

  it('joins the user and organization rooms for an authenticated connection', async () => {
    mockedJwtVerify.mockReturnValue({ sub: 'user-123' });
    mockedPrisma.organizationMember.findFirst.mockResolvedValue({ organizationId: 'org-1', userId: 'user-123' });

    const service = SocketService.getInstance();
    service.initialize({} as any);
    const server = service.getIo() as any;

    const middleware = server.middleware[0];
    const connectionHandler = server.connectionHandlers[0];

    const socket = new MockSocket('socket-1', {
      auth: { token: 'valid-token' },
      query: { orgId: 'org-1' },
    });

    middleware(socket, jest.fn());
    await connectionHandler(socket);

    expect(socket.joinedRooms.has('user:user-123')).toBe(true);
    expect(socket.joinedRooms.has('org:org-1')).toBe(true);
    expect((service as any).socketRoomMemberships.get('socket-1')).toEqual(
      new Set(['user:user-123', 'org:org-1']),
    );
  });

  it('rejects unauthenticated sockets before the connection handler runs', () => {
    const service = SocketService.getInstance();
    service.initialize({} as any);
    const server = service.getIo() as any;
    const middleware = server.middleware[0];
    const next = jest.fn();
    const socket = new MockSocket('socket-2', { auth: {} });

    mockedJwtVerify.mockImplementation(() => {
      throw new Error('bad token');
    });

    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((service as any).socketRoomMemberships.size).toBe(0);
  });

  it('cleans up room tracking on disconnect', async () => {
    mockedJwtVerify.mockReturnValue({ sub: 'user-456' });
    mockedPrisma.organizationMember.findFirst.mockResolvedValue({ organizationId: 'org-2', userId: 'user-456' });

    const service = SocketService.getInstance();
    service.initialize({} as any);
    const server = service.getIo() as any;
    const middleware = server.middleware[0];
    const connectionHandler = server.connectionHandlers[0];

    const socket = new MockSocket('socket-3', {
      auth: { token: 'valid-token' },
      query: { orgId: 'org-2' },
    });

    middleware(socket, jest.fn());
    await connectionHandler(socket);
    socket.handlers.disconnect();

    expect((service as any).socketRoomMemberships.has('socket-3')).toBe(false);
  });
});
