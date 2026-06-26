/**
 * tracing.ts
 *
 * OpenTelemetry SDK initialisation — must be imported BEFORE any other module
 * so auto-instrumentation patches are applied at startup.
 *
 * Usage:
 *   import './tracing';          // ESM / ts-node
 *   node -r ./dist/tracing.js … // CommonJS pre-require
 *
 * Supported exporters (OTEL_EXPORTER env var):
 *   jaeger   → Jaeger HTTP collector  (default)
 *   honeycomb → Honeycomb OTLP endpoint
 *   otlp     → Generic OTLP/HTTP endpoint
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createLogger } from './lib/logger';
import { config } from './config/config';

const logger = createLogger('tracing');

// ─── Exporter factory ────────────────────────────────────────────────────────

function buildExporter(): SpanExporter {
  switch (config.OTEL_EXPORTER) {
    case 'honeycomb': {
      if (!config.HONEYCOMB_API_KEY) {
        logger.warn('HONEYCOMB_API_KEY is not set — traces will not be exported');
      }
      return new OTLPTraceExporter({
        url: 'https://api.honeycomb.io/v1/traces',
        headers: {
          'x-honeycomb-team': config.HONEYCOMB_API_KEY ?? '',
          'x-honeycomb-dataset': config.HONEYCOMB_DATASET,
        },
      });
    }

    case 'otlp': {
      return new OTLPTraceExporter({ url: config.OTEL_EXPORTER_OTLP_ENDPOINT });
    }

    case 'jaeger':
    default: {
      return new JaegerExporter({ endpoint: config.JAEGER_ENDPOINT });
    }
  }
}

// ─── SDK initialisation ──────────────────────────────────────────────────────

// #903: Prevent OTEL_DEBUG=true in production — it enables per-span I/O latency logging and degrades performance.
let isDebug = config.OTEL_DEBUG;
if (config.NODE_ENV === 'production' && isDebug) {
  logger.error(
    'CRITICAL: OTEL_DEBUG=true is set in a production environment. ' +
    'This enables verbose per-span logging and degrades performance. ' +
    'Disabling OTEL_DEBUG. Remove OTEL_DEBUG=true from your production configuration.'
  );
  isDebug = false;
}

const serviceName = config.OTEL_SERVICE_NAME;

const exporter = buildExporter();

// Use BatchSpanProcessor in production for throughput; Simple in debug for immediacy.
const spanProcessor = isDebug
  ? new SimpleSpanProcessor(exporter)
  : new BatchSpanProcessor(exporter, {
      maxQueueSize: 512,
      scheduledDelayMillis: 5_000,
    });

export const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
    environment: config.NODE_ENV,
  }),
  spanProcessors: [spanProcessor],
  instrumentations: [
    getNodeAutoInstrumentations({
      // Reduce noise from internal fs polling
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();
logger.info('OpenTelemetry tracing initialised', {
  service: serviceName,
  exporter: config.OTEL_EXPORTER,
});

// Flush spans on graceful shutdown
export const shutdownOtel = (timeoutMs = 5_000): Promise<void> =>
  Promise.race([
    sdk.shutdown(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('OTel shutdown timed out')), timeoutMs),
    ),
  ])
    .then(() => logger.info('OTel SDK shut down cleanly'))
    .catch((err: unknown) => logger.error('OTel SDK shutdown error', err));

process.on('SIGTERM', () => { void shutdownOtel(); });
