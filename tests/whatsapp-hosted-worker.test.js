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
const adminApp = read('assets/makaug-app.js');
const readiness = read('services/whatsappBridgeReadiness.js');

assert(renderYaml.includes('type: worker'), 'Render blueprint must define a background worker for the WhatsApp agent');
assert(renderYaml.includes('runtime: docker'), 'WhatsApp worker must run with Docker so Playwright/Chrome is available');
assert(renderYaml.includes('dockerfilePath: ./Dockerfile.whatsapp-agent'), 'Render worker must use the WhatsApp agent Dockerfile');
assert(renderYaml.includes('numInstances: 1'), 'WhatsApp Web profile must run as exactly one worker instance');
assert(renderYaml.includes('mountPath: /var/data'), 'Render worker must attach persistent disk at /var/data');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_PROFILE_DIR') && renderYaml.includes('/var/data/whatsapp-profile-live'), 'Render worker must persist WhatsApp login profile on disk');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_HEADLESS') && renderYaml.includes('value: "false"'), 'Render worker must run a visible browser under xvfb for WhatsApp linking');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_LOGIN_METHOD') && renderYaml.includes('WHATSAPP_WEB_COPILOT_PAIRING_PHONE'), 'Render worker must expose phone-number pairing as a QR fallback');
assert(renderYaml.includes('WHATSAPP_WEB_BRIDGE_TOKEN') && renderYaml.includes('sync: false'), 'Bridge token must be prompted in Render, not committed');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_PAIRING_PHONE') && renderYaml.includes('sync: false'), 'Phone pairing number must be configured as a private Render env var');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_HOSTED') && renderYaml.includes('makaug-whatsapp-web-prod'), 'Render worker must use hosted production identity');

assert(dockerfile.includes('mcr.microsoft.com/playwright') && dockerfile.includes('scripts/start-whatsapp-agent-render.sh'), 'Dockerfile must provide Playwright runtime and start the hosted agent script');
assert(startScript.includes('command -v Xvfb') && startScript.includes('WHATSAPP_WEB_COPILOT_PROFILE_DIR="${WHATSAPP_WEB_COPILOT_PROFILE_DIR:-/var/data/whatsapp-profile-live}"'), 'Hosted start script must run Chrome under Xvfb and default to persistent disk profile');
assert(startScript.includes('WHATSAPP_WEB_COPILOT_HEADLESS="${WHATSAPP_WEB_COPILOT_HEADLESS:-false}"'), 'Hosted start script must default to a visible browser for WhatsApp linking');
assert(startScript.includes('exec node scripts/whatsapp-web-agent.js'), 'Hosted start script must hand off directly to the WhatsApp Node agent');
assert(!renderYaml.includes('/ms-playwright/chromium-1217'), 'Render config must not pin Chrome to a Playwright revision-specific path');
assert(!startScript.includes('/ms-playwright/chromium-1217'), 'Hosted start script must let Playwright resolve the Chromium executable path');
assert(!agentScript.includes('if (!CDP_URL && !fs.existsSync(CHROME_PATH))'), 'WhatsApp agent must not exit before Playwright browser path fallback runs');

assert(dockerignore.includes('.env') && dockerignore.includes('.env.*'), 'Docker build must exclude local env files');
assert(dockerignore.includes('.whatsapp-web-copilot-profile*'), 'Docker build must exclude local WhatsApp browser profiles');
assert(dockerignore.includes('node_modules') && dockerignore.includes('.git'), 'Docker build must exclude local dependencies and git metadata');

assert(agentScript.includes('function hostedRuntimeMetadata()'), 'WhatsApp agent must report hosted runtime metadata');
assert(agentScript.includes('WHATSAPP_WEB_COPILOT_HOSTED') && agentScript.includes("PROFILE_DIR.startsWith('/var/data')"), 'Hosted metadata must detect Render worker/profile disk');
assert(agentScript.includes("runtime: hosted ? 'render_worker' : 'local_browser'"), 'Heartbeat metadata must distinguish Render worker from local browser');
assert(agentScript.includes('...hostedRuntimeMetadata()'), 'Every heartbeat must include hosted metadata');
assert(agentScript.includes('captureLoginScreenshotDataUrl(page)'), 'Hosted worker must capture a protected login screenshot while WhatsApp is not ready');
assert(agentScript.includes('refreshWhatsappLoginQrIfNeeded(page)'), 'Hosted worker must refresh stale WhatsApp login QR codes before screenshot heartbeats');
assert(agentScript.includes('select to reload qr code') && agentScript.includes('clicked_reload_qr'), 'Hosted worker must detect and click WhatsApp reload-QR prompts');
assert(agentScript.includes('startWhatsappPhonePairingIfConfigured(page)'), 'Hosted worker must support WhatsApp phone-number pairing when QR linking fails');
assert(agentScript.includes('WHATSAPP_WEB_COPILOT_PAIRING_PHONE') && agentScript.includes('log in with phone number'), 'Phone pairing must use the configured private phone number and click the WhatsApp phone login path');
assert(agentScript.includes('clickWhatsappPhoneLoginLink(page)') && agentScript.includes('getByRole'), 'Phone pairing must use Playwright locator clicks for the login link');
assert(agentScript.includes('submitWhatsappPhonePairingWithPlaywright(page)') && agentScript.includes('phone_fill_did_not_stick'), 'Phone pairing must fill and submit the phone form with Playwright and report fill failures');
assert(agentScript.includes('pairing_code_loading') && agentScript.includes("getByText(/^edit$/i)"), 'Phone pairing must recover from a stuck loading code screen by editing and resubmitting');
assert(agentScript.includes('phonePairingPrompt') && agentScript.includes('enter code on phone'), 'Readiness detection must treat phone-code screens as login states');
assert(agentScript.includes('phone_form_not_visible_after_click'), 'Phone pairing must not claim submission if the phone form never appears');
assert(agentScript.includes("text.includes('code on your phone')"), 'Phone pairing detection must require real pairing-code copy, not QR-screen text');
assert(!agentScript.includes("text.includes('link with phone number'))"), 'Phone pairing detection must not confuse the QR login link with a visible pairing code');
assert(agentScript.includes('login_screenshot_data_url: loginScreenshotDataUrl || null'), 'Non-ready heartbeats must expose the current login screenshot');
assert(agentScript.includes('login_phone_pairing: phonePairing'), 'Non-ready heartbeats must expose phone pairing metadata for proof');
assert(agentScript.includes('login_qr_refresh: qrRefresh'), 'Non-ready heartbeats must include QR refresh metadata for proof');
assert(agentScript.includes('login_screenshot_data_url: null'), 'Online heartbeats must clear stale login screenshots');
assert(agentScript.includes('WHATSAPP_WEB_COPILOT_USER_AGENT') && agentScript.includes('Chrome/120.0.0.0'), 'Hosted browser must present a normal Chrome user agent for WhatsApp Web');
assert(agentScript.includes('--disable-blink-features=AutomationControlled') && agentScript.includes("navigator, 'webdriver'"), 'Hosted browser must avoid the automated/headless browser rejection path');

assert(readiness.includes('hosted_agent_online') && readiness.includes('only_local_laptop_bridge_is_online'), 'Admin readiness must distinguish hosted 24/7 bridge from local-only bridge');
assert(adminApp.includes('Hosted WhatsApp login screen') && adminApp.includes('login_screenshot_data_url'), 'Admin WhatsApp overview must render the hosted login screenshot from protected insights');

console.log('WhatsApp hosted worker setup ok');
