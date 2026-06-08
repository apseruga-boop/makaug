#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

try {
  process.chdir(PROJECT_ROOT);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(new Date().toISOString(), '[whatsapp-web-agent]', `failed to enter project root: ${error.message}`);
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function readTextFileWithRetry(filePath, label, attempts = 8) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      const message = String(error?.message || error || '');
      const retryable = error?.code === 'EAGAIN'
        || error?.code === 'ETIMEDOUT'
        || error?.errno === -11
        || message.includes('Unknown system error -11')
        || message.includes('ETIMEDOUT');
      if (!retryable || attempt >= attempts) {
        console.error(new Date().toISOString(), '[whatsapp-web-agent]', `failed to read ${label}: ${message}`);
        return null;
      }
      sleepSync(Math.min(2000, 250 * attempt));
    }
  }
  return null;
}

function loadProjectEnv() {
  const candidates = [
    String(process.env.MAKAUG_WHATSAPP_ENV_FILE || '').trim(),
    '/private/tmp/makaug-whatsapp.env',
    path.join(PROJECT_ROOT, '.env')
  ].filter(Boolean);
  let source = '';
  for (const envPath of candidates) {
    source = readTextFileWithRetry(envPath, envPath);
    if (source) break;
  }
  if (!source) return;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadProjectEnv();

const RESTART_DELAY_MS = Math.max(5000, Number(process.env.WHATSAPP_AGENT_RESTART_DELAY_MS || 10000));
const MAX_RESTARTS_PER_HOUR = Math.max(3, Number(process.env.WHATSAPP_AGENT_MAX_RESTARTS_PER_HOUR || 24));
const PREFLIGHT_RETRIES = Math.max(1, Number(process.env.WHATSAPP_AGENT_PREFLIGHT_RETRIES || 5));
const PREFLIGHT_RETRY_MS = Math.max(500, Number(process.env.WHATSAPP_AGENT_PREFLIGHT_RETRY_MS || 1500));
const LOCAL_PLAYWRIGHT_CORE_PATH = '/private/tmp/makaug-playwright-runtime/node_modules/playwright-core';

let child = null;
let stopping = false;
let restartTimes = [];
let starting = false;

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), '[whatsapp-web-agent]', ...args);
}

function pruneRestartWindow() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  restartTimes = restartTimes.filter((ts) => ts >= cutoff);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePlaywrightCoreModule() {
  const candidates = [
    String(process.env.WHATSAPP_WEB_COPILOT_PLAYWRIGHT_CORE_PATH || '').trim(),
    LOCAL_PLAYWRIGHT_CORE_PATH
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    } catch (_error) {
      // Try the next candidate.
    }
  }
  return 'playwright-core';
}

async function preflightBridgeRuntime() {
  for (let attempt = 1; attempt <= PREFLIGHT_RETRIES; attempt += 1) {
    try {
      require.resolve(resolvePlaywrightCoreModule());
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      log(`bridge runtime preflight failed (${attempt}/${PREFLIGHT_RETRIES}): ${message}`);
      if (attempt < PREFLIGHT_RETRIES) {
        await sleep(PREFLIGHT_RETRY_MS * attempt);
      }
    }
  }
  return false;
}

async function startBridge() {
  if (starting || stopping) return;
  starting = true;

  pruneRestartWindow();
  if (restartTimes.length >= MAX_RESTARTS_PER_HOUR) {
    log(`restart limit reached (${MAX_RESTARTS_PER_HOUR}/hour). Leaving agent stopped so the error can be inspected.`);
    process.exit(1);
  }

  const runtimeReady = await preflightBridgeRuntime();
  if (!runtimeReady) {
    starting = false;
    log(`bridge runtime preflight did not pass; retrying in ${Math.round(RESTART_DELAY_MS / 1000)}s.`);
    setTimeout(startBridge, RESTART_DELAY_MS);
    return;
  }

  restartTimes.push(Date.now());
  log('starting WhatsApp Web bridge...');
  child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'scripts', 'whatsapp-web-copilot.js')], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      WHATSAPP_WEB_COPILOT_AGENT: '1',
      WHATSAPP_WEB_COPILOT_PLAYWRIGHT_CORE_PATH: resolvePlaywrightCoreModule()
    },
    stdio: 'inherit'
  });
  starting = false;

  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) {
      log(`bridge stopped (${signal || code || 0}).`);
      return;
    }
    log(`bridge exited (${signal || code || 0}); restarting in ${Math.round(RESTART_DELAY_MS / 1000)}s.`);
    setTimeout(startBridge, RESTART_DELAY_MS);
  });
}

function stop(signal) {
  stopping = true;
  log(`received ${signal}; stopping bridge.`);
  if (child && !child.killed) {
    child.kill(signal);
    setTimeout(() => {
      if (child && !child.killed) child.kill('SIGKILL');
    }, 5000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

log('agent online. Keep this terminal open while WhatsApp Web is serving live replies.');
log('Using WhatsApp Web is preferred over the desktop app because the bridge can read/send through a persistent Chrome profile and report heartbeats to admin.');
startBridge();
