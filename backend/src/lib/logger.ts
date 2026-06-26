import winston from 'winston';
import { getRequestId } from '../middleware/requestId';
import { config } from '../config/config';

const isProduction = config.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Base transports — console always on, file logs in production
// ---------------------------------------------------------------------------
const transports: winston.transport[] = [
  new winston.transports.Console(),
  ...(isProduction
    ? [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
      ]
    : []),
];

// ---------------------------------------------------------------------------
// Elasticsearch transport — activated when ELASTICSEARCH_URL is set.
// Uses winston-elasticsearch which ships logs as structured JSON documents,
// making them immediately searchable in Kibana.
// ---------------------------------------------------------------------------
if (config.ELASTICSEARCH_URL) {
  try {
    // Dynamic require so the app still boots if the package isn't installed
    // (e.g. local dev without the dep).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ElasticsearchTransport } = require('winston-elasticsearch');

    const esTransport = new ElasticsearchTransport({
      level: config.LOG_LEVEL,
      indexPrefix: process.env.ELASTICSEARCH_INDEX_PREFIX ?? 'socialflow-logs',
      // Rotate index daily: socialflow-logs-YYYY.MM.DD
      indexSuffixPattern: 'YYYY.MM.DD',
      clientOpts: {
        node: config.ELASTICSEARCH_URL,
        auth:
          process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD
            ? {
                username: process.env.ELASTICSEARCH_USERNAME,
                password: process.env.ELASTICSEARCH_PASSWORD,
              }
            : undefined,
        // Trust self-signed certs in dev/staging; enforce TLS in production
        tls: {
          rejectUnauthorized: config.ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED !== 'false',
        },
      },
      // Map Winston levels to ECS-compatible severity
      transformer: (logData: Record<string, unknown>) => ({
        '@timestamp': new Date().toISOString(),
        severity: logData.level,
        message: logData.message,
        fields: logData.meta ?? {},
        service: {
          name: config.OTEL_SERVICE_NAME,
          environment: config.NODE_ENV,
        },
      }),
    });

    // Surface ES transport errors without crashing the app
    esTransport.on('error', (err: Error) => {
      console.error('[logger] Elasticsearch transport error:', err.message);
    });

    transports.push(esTransport);
  } catch (err) {
    console.warn(
      '[logger] winston-elasticsearch not available, skipping ES transport:',
      (err as Error).message,
    );
  }
}

// ---------------------------------------------------------------------------
// Winston instance
// ---------------------------------------------------------------------------
const winstonLogger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: isProduction
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(
          ({ timestamp, level, message, scope, requestId, ...meta }: Record<string, unknown>) => {
            const reqIdStr = requestId ? ` [${requestId}]` : '';
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${scope ?? 'app'}]${reqIdStr} ${level}: ${message}${metaStr}`;
          },
        ),
      ),
  transports,
});

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------
export interface Logger {
  info: (message: string, metadata?: unknown) => void;
  warn: (message: string, metadata?: unknown) => void;
  error: (message: string, metadata?: unknown) => void;
  debug: (message: string, metadata?: unknown) => void;
}
/**
 * Create a context-aware logger that automatically includes the current
 * request ID (via AsyncLocalStorage) and a module scope label.
 *
 * @param scope - Module / service name shown in every log line
 */
export const createLogger = (scope: string): Logger => ({
  info: (message, metadata) =>
    winstonLogger.info(message, { scope, requestId: getRequestId(), ...(metadata as object) }),
  warn: (message, metadata) =>
    winstonLogger.warn(message, { scope, requestId: getRequestId(), ...(metadata as object) }),
  error: (message, metadata) =>
    winstonLogger.error(message, { scope, requestId: getRequestId(), ...(metadata as object) }),
  debug: (message, metadata) =>
    winstonLogger.debug(message, { scope, requestId: getRequestId(), ...(metadata as object) }),
});
