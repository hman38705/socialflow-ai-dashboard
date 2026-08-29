import { io, Socket } from 'socket.io-client';

// Single shared socket for every job-progress consumer in the app (TTS, video,
// webhook deliveries, ...). Consumers call acquireSocket()/releaseSocket() instead
// of opening their own connection so there is ever only one socket per session.

const SOCKET_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SOCKET_URL ||
  'http://localhost:4000';

let socket: Socket | null = null;
let refCount = 0;
let getAccessToken: () => string | null | undefined = () => null;

function createSocket(): Socket {
  return io(SOCKET_URL, {
    path: '/jobs',
    autoConnect: false,
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5, // jitter on top of the exponential backoff
    auth: (cb) => cb({ token: getAccessToken() }),
  });
}

/** Lets the host app plug in wherever it keeps the current access token. */
export function setAccessTokenProvider(fn: () => string | null | undefined) {
  getAccessToken = fn;
}

/** Re-authenticate the live connection, e.g. right after a token refresh. */
export function reauthenticateSocket() {
  if (!socket) return;
  socket.auth = { token: getAccessToken() } as Record<string, unknown>;
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}

/** Acquire a reference to the shared socket, connecting it on first use. */
export function acquireSocket(): Socket {
  if (!socket) socket = createSocket();
  refCount += 1;
  if (!socket.connected && !socket.active) socket.connect();
  return socket;
}

/** Release a reference; the socket disconnects once the last consumer lets go. */
export function releaseSocket() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && socket) {
    socket.disconnect();
  }
}
