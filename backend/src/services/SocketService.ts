import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { createLogger } from '../lib/logger';
import { config } from '../config/config';
import { getRedisConnection } from '../config/runtime';
import { eventBus, JobProgressEvent } from '../lib/eventBus';
import { prisma } from '../lib/prisma';

const logger = createLogger('SocketService');

interface AuthenticatedSocket extends Socket {
  user?: any; // Define user format matching your JWT payload
}

export class SocketService {
  private static instance: SocketService;
  private io?: Server;
  private jobProgressListener?: (event: JobProgressEvent) => void;

  private constructor() {}

  /**
   * Returns the singleton instance of the SocketService
   */
  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  /**
   * Initializes the Socket.io server and binds events
   * @param httpServer The Node HTTP server instance
   */
  public initialize(httpServer: HttpServer): void {
    this.io = new Server(httpServer, {
      cors: {
        origin: '*', // To be restricted in production
        methods: ['GET', 'POST'],
      },
    });

    // Configure Redis Adapter
    const pubClient = new Redis(getRedisConnection());
    const subClient = pubClient.duplicate();
    this.io.adapter(createAdapter(pubClient, subClient));

    // Listen to job progress events and emit to user rooms
    this.jobProgressListener = (event: JobProgressEvent) => {
      const room = `user:${event.userId}`;
      this.io?.to(room).emit('job_progress', event);
    };
    eventBus.on('job:*', this.jobProgressListener);

    // Authenticated connection middleware
    this.io.use((socket: AuthenticatedSocket, next) => {
      // First try to grab token from auth payload, fallback to Authorization header
      const token =
        socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) {
        return next(new Error('Authentication error'));
      }
      try {
        const secret = config.JWT_SECRET;
        const decoded = jwt.verify(token, secret);
        socket.user = decoded;
        next();
      } catch (_err) {
        next(new Error('Authentication error'));
      }
    });

    this.io.on('connection', async (socket: AuthenticatedSocket) => {
      logger.info(`Authorized connection from ${socket.id}`);

      // Join user-specific room for job progress
      const userId = socket.user?.sub;
      if (userId) {
        const userRoom = `user:${userId}`;
        socket.join(userRoom);
        logger.info(`Client ${socket.id} joined room ${userRoom}`);
      }

      // Auto-join specific namespace or org-based rooms based on client query
      const orgId = socket.handshake.query.orgId as string;
      if (orgId && userId) {
        const member = await prisma.organizationMember.findFirst({
          where: { organizationId: orgId, userId },
        });
        if (member) {
          socket.join(`org:${orgId}`);
          logger.info(`Client ${socket.id} joined room org:${orgId}`);
        } else {
          socket.emit('error', { message: 'Not a member of this organisation' });
          logger.warn(`Client ${socket.id} denied access to org:${orgId} — not a member`);
        }
      }

      // Handle message events dynamically
      socket.on('message', (payload) => {
        logger.info(`Message from ${socket.id}`, { payload });
        // Relay message or process it
        if (orgId) {
          this.io?.to(`org:${orgId}`).emit('message', { ...payload, from: socket.user });
        } else {
          this.io?.emit('message', { ...payload, from: socket.user });
        }
      });

      // Collaborative updating events (e.g. document edits)
      socket.on('collaboration:update', (payload) => {
        if (orgId) {
          // Broadcast to everyone in the room except the sender
          socket.to(`org:${orgId}`).emit('collaboration:update', payload);
        } else {
          socket.broadcast.emit('collaboration:update', payload);
        }
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Helper to push notifications targeted at specific rooms
   * @param room The room scope
   * @param payload The notification body
   */
  public emitNotification(room: string, payload: any): void {
    if (this.io) {
      this.io.to(room).emit('notification', payload);
    }
  }

  /**
   * Helper to broadcast a global message across all namespaces
   * @param event The event identifier
   * @param payload Body of the broadcast
   */
  public broadcast(event: string, payload: any): void {
    if (this.io) {
      this.io.emit(event, payload);
    }
  }

  /**
   * Allow access to underling server object for extreme customization or testing
   */
  public getIo(): Server | undefined {
    return this.io;
  }
}
