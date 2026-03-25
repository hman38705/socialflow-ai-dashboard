/**
 * verify-contracts.ts
 *
 * Standalone script to verify all consumer contracts against a running provider.
 * Useful in CI pipelines where the provider is already deployed.
 *
 * Usage:
 *   npm run pact:verify
 *
 * Environment variables:
 *   PROVIDER_BASE_URL  – base URL of the running provider  (default: http://localhost:3000)
 *   PACT_BROKER_URL    – Pact Broker URL                   (default: http://localhost:9292)
 *   PROVIDER_VERSION   – semver / git SHA of the provider  (default: 1.0.0)
 *   PUBLISH_RESULTS    – set to "true" to publish results  (default: false)
 */

import path from 'path';
import { Verifier } from '@pact-foundation/pact';

const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL || 'http://localhost:3000';
const PROVIDER_VERSION  = process.env.PROVIDER_VERSION  || '1.0.0';
const PUBLISH_RESULTS   = process.env.PUBLISH_RESULTS   === 'true';
const PACT_DIR          = path.resolve(__dirname, '../pacts');

async function main() {
  console.log('=== Pact Contract Verification ===');
  console.log(`Provider URL : ${PROVIDER_BASE_URL}`);
  console.log(`Pact dir     : ${PACT_DIR}`);
  console.log(`Publish      : ${PUBLISH_RESULTS}`);
  console.log('');

  const verifier = new Verifier({
    provider: 'socialflow-api',
    providerBaseUrl: PROVIDER_BASE_URL,

    // Use local pact files when broker is not available
    pactUrls: [path.resolve(PACT_DIR, 'socialflow-frontend-socialflow-api.json')],

    // Uncomment to pull pacts from the broker (set PACT_BROKER_URL env var):
    // brokerUrl: process.env.PACT_BROKER_URL || 'http://localhost:9292',
    // consumerVersionSelectors: [{ mainBranch: true }, { deployedOrReleased: true }],

    publishVerificationResult: PUBLISH_RESULTS,
    providerVersion: PROVIDER_VERSION,
    logLevel: 'info',
  });

  try {
    await verifier.verifyProvider();
    console.log('\n✅  All contracts verified successfully.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌  Contract verification failed:', err);
    process.exit(1);
  }
}

main();
