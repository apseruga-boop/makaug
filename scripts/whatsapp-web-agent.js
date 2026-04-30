#!/usr/bin/env node
require('dotenv').config();

const { spawn } = require('child_process');

const RESTART_DELAY_MS = Math.max(3000, Number(process.env.WHATSAPP_AGENT_RESTART_DELAY_MS || 8000));
const MAX_RESTARTS_PER_HOUR = Math.max(3, Number(process.env.WHATSAPP_AGENT_MAX_RESTARTS_PER_HOUR || 20));

let child = null;
let stopping = false;
let restartTimes = [];

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), '[whatsapp-web-agent]', ...args);
}

function pruneRestartWindow() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  restartTimes = restartTimes.filter((ts) => ts >= cutoff);
}

function startBridge() {
  pruneRestartWindow();
  if (restartTimes.length >= MAX_RESTARTS_PER_HOUR) {
    log(`restart limit reached (${MAX_RESTARTS_PER_HOUR}/hour). Leaving agent stopped so the error can be inspected.`);
    process.exit(1);
  }

  restartTimes.push(Date.now());
  log('starting WhatsApp Web bridge...');
  child = spawn(process.execPath, ['scripts/whatsapp-web-copilot.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WHATSAPP_WEB_COPILOT_AGENT: '1'
    },
    stdio: 'inherit'
  });

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
