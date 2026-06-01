import 'reflect-metadata';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { expressMiddleware } from '@as-integrations/express4';
import { requestIdMiddleware } from './middleware/requestId';
import { compressionMiddleware } from './middleware/compression';
import { errorHandler, notFoundHandler } from './middleware/error';
import { initRateLimiters } from './middleware/rateLimit';
import { sliMiddleware } from './middleware/sliMiddleware';
import v1Router from './routes/v1';
import metricsRouter from './routes/metrics';
import { swaggerSpec } from './config/swagger';
import { createApolloServer } from './graphql';
import { buildContext } from './graphql/context';
import { authenticate } from './middleware/authenticate';

// Initialise rate limiters (resolves Redis store in production)
export const rateLimitersReady = initRateLimiters();

const app: Application = express();

// ── Core middleware ───────────────────────────────────────────────────────────

// Security headers — applied globally before any route
app.use(helmet());

// Response compression (Gzip/Brotli) — before body parsing so all responses are eligible
app.use(compressionMiddleware);

// CORS — allow EventSource connections
app.use(cors());
app.use(requestIdMiddleware);
app.use(sliMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// ── API Docs ──────────────────────────────────────────────────────────────────
app.use(
  '/api-docs',
  // Relax helmet's CSP for Swagger UI assets
  helmet({ contentSecurityPolicy: false }),
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, { explorer: true }),
);
// Expose the raw OpenAPI JSON for tooling
app.get('/api-docs.json', (_req: Request, res: Response) => res.json(swaggerSpec));

// ── Versioned API ─────────────────────────────────────────────────────────────

// Current stable version
app.use('/api/v1', v1Router);

// Legacy /api prefix — deprecated alias for backward compatibility.
// Adds a Deprecation header so clients know to migrate to /api/v1.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  res.set('Deprecation', 'true');
  res.set('Link', '</api/v1>; rel="successor-version"');
  next();
}, v1Router);

// Bare /health for load-balancer probes (no versioning needed)
app.get('/health', (_req: Request, res: Response) => {
  const { config } = require('./config/config');
  const ttsAvailable = !!(config.ELEVENLABS_API_KEY || config.GOOGLE_TTS_API_KEY);
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    features: {
      tts: ttsAvailable ? 'available' : 'unavailable',
    },
  });
});

// Prometheus metrics scrape endpoint
app.use('/metrics', metricsRouter);

// ── GraphQL ───────────────────────────────────────────────────────────────────

// Apollo Server must be started before attaching the middleware.
// We export the promise so server.ts can await it during startup.
const apolloServer = createApolloServer();
export const apolloReady = apolloServer.start().then(() => {
  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    express.json(),
    authenticate,
    expressMiddleware(apolloServer, { context: buildContext }),
  );
});

// ── Error handling ────────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
