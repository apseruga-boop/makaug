const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const renderYaml = read('render.yaml');
const dockerfile = read('Dockerfile.whatsapp-agent');
const dockerignore = read('.dockerignore');
const agentScript = read('scripts/whatsapp-web-copilot.js');
const startScript = read('scripts/start-whatsapp-agent-render.sh');
const readiness = read('services/whatsappBridgeReadiness.js');

assert(renderYaml.includes('type: worker'), 'Render blueprint must define a background worker for the WhatsApp agent');
assert(renderYaml.includes('runtime: docker'), 'WhatsApp worker must run with Docker so Playwright/Chrome is available');
assert(renderYaml.includes('dockerfilePath: ./Dockerfile.whatsapp-agent'), 'Render worker must use the WhatsApp agent Dockerfile');
assert(renderYaml.includes('numInstances: 1'), 'WhatsApp Web profile must run as exactly one worker instance');
assert(renderYaml.includes('mountPath: /var/data'), 'Render worker must attach persistent disk at /var/data');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_PROFILE_DIR') && renderYaml.includes('/var/data/whatsapp-profile'), 'Render worker must persist WhatsApp login profile on disk');
assert(renderYaml.includes('WHATSAPP_WEB_BRIDGE_TOKEN') && renderYaml.includes('sync: false'), 'Bridge token must be prompted in Render, not committed');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_HOSTED') && renderYaml.includes('makaug-whatsapp-web-prod'), 'Render worker must use hosted production identity');

assert(dockerfile.includes('mcr.microsoft.com/playwright') && dockerfile.includes('scripts/start-whatsapp-agent-render.sh'), 'Dockerfile must provide Playwright runtime and start the hosted agent script');
assert(startScript.includes('xvfb-run') && startScript.includes('WHATSAPP_WEB_COPILOT_PROFILE_DIR="${WHATSAPP_WEB_COPILOT_PROFILE_DIR:-/var/data/whatsapp-profile}"'), 'Hosted start script must run Chrome headlessly and default to persistent disk profile');

assert(dockerignore.includes('.env') && dockerignore.includes('.env.*'), 'Docker build must exclude local env files');
assert(dockerignore.includes('.whatsapp-web-copilot-profile*'), 'Docker build must exclude local WhatsApp browser profiles');
assert(dockerignore.includes('node_modules') && dockerignore.includes('.git'), 'Docker build must exclude local dependencies and git metadata');

assert(agentScript.includes('function hostedRuntimeMetadata()'), 'WhatsApp agent must report hosted runtime metadata');
assert(agentScript.includes('WHATSAPP_WEB_COPILOT_HOSTED') && agentScript.includes("PROFILE_DIR.startsWith('/var/data')"), 'Hosted metadata must detect Render worker/profile disk');
assert(agentScript.includes("runtime: hosted ? 'render_worker' : 'local_browser'"), 'Heartbeat metadata must distinguish Render worker from local browser');
assert(agentScript.includes('...hostedRuntimeMetadata()'), 'Every heartbeat must include hosted metadata');

assert(readiness.includes('hosted_agent_online') && readiness.includes('only_local_laptop_bridge_is_online'), 'Admin readiness must distinguish hosted 24/7 bridge from local-only bridge');

console.log('WhatsApp hosted worker setup ok');
