#!/usr/bin/env node
'use strict';

// Reads only the caller's explicit environment. Never loads a .env file.
const { fromEnvironment, readiness, PesapalError } = require('../services/pesapalClient');

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = new Set(argv);
  if (argv.some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/pesapal-ipn-setup.js [--apply]');
  const configuration = readiness(env);
  const origin = configuration.publicOrigin;
  let url;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    url = new URL('/api/pay/webhooks/pesapal', parsed).href;
  } catch { throw new Error('Set PUBLIC_BASE_URL to the public HTTPS origin before IPN setup.'); }
  if (!args.has('--apply')) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry_run', environment: configuration.environment, countryCode: configuration.countryCode, url, method: 'POST', credentialsConfigured: configuration.credentialsConfigured, action: 'List registrations and register only if no URL match exists. No provider call was made.' }, null, 2)}\n`);
    return;
  }
  const registration = await fromEnvironment(env).ensureNotification({ url });
  process.stdout.write(`${JSON.stringify({ environment: configuration.environment, ...registration, nextStep: 'Set PESAPAL_IPN_ID to notificationId for this environment. Checkout remains subject to its separate readiness gates.' }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error instanceof PesapalError ? error.message : 'Pesapal IPN setup failed. Check the command arguments and public origin.'}\n`);
  process.exitCode = 1;
});

module.exports = { main };
