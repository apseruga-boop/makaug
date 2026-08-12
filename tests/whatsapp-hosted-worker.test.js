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
const whatsappRoute = read('routes/whatsapp.js');
const chatFilter = require('../services/whatsappWebChatFilter');

assert(renderYaml.includes('type: worker'), 'Render blueprint must define a background worker for the WhatsApp agent');
assert(renderYaml.includes('runtime: docker'), 'WhatsApp worker must run with Docker so Playwright/Chrome is available');
assert(renderYaml.includes('dockerfilePath: ./Dockerfile.whatsapp-agent'), 'Render worker must use the WhatsApp agent Dockerfile');
assert(renderYaml.includes('numInstances: 1'), 'WhatsApp Web profile must run as exactly one worker instance');
assert(renderYaml.includes('mountPath: /var/data'), 'Render worker must attach persistent disk at /var/data');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_PROFILE_DIR') && renderYaml.includes('/var/data/whatsapp-profile-live'), 'Render worker must persist WhatsApp login profile on disk');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_HEADLESS') && renderYaml.includes('value: "true"'), 'Render worker must default to headless Chrome after its persisted WhatsApp session is linked');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_LOGIN_METHOD') && renderYaml.includes('WHATSAPP_WEB_COPILOT_PAIRING_PHONE'), 'Render worker must expose phone-number pairing as a QR fallback');
assert(renderYaml.includes('WHATSAPP_WEB_BRIDGE_TOKEN') && renderYaml.includes('sync: false'), 'Bridge token must be prompted in Render, not committed');
assert(renderYaml.includes('WHATSAPP_ACCESS_TOKEN') && renderYaml.includes('WHATSAPP_PHONE_NUMBER_ID') && renderYaml.includes('WHATSAPP_VERIFY_TOKEN'), 'Render worker must declare private Meta WhatsApp Cloud API env vars for provider mode');
assert(renderYaml.includes('WHATSAPP_API_VERSION') && renderYaml.includes('v25.0'), 'Render worker must pin the production Meta WhatsApp API version');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_PAIRING_PHONE') && renderYaml.includes('sync: false'), 'Phone pairing number must be configured as a private Render env var');
assert(renderYaml.includes('WHATSAPP_WEB_COPILOT_HOSTED') && renderYaml.includes('makaug-whatsapp-web-prod'), 'Render worker must use hosted production identity');

assert(dockerfile.includes('mcr.microsoft.com/playwright') && dockerfile.includes('scripts/start-whatsapp-agent-render.sh'), 'Dockerfile must provide Playwright runtime and start the hosted agent script');
assert(startScript.includes('exec xvfb-run -a') && startScript.includes('WHATSAPP_WEB_COPILOT_PROFILE_DIR="${WHATSAPP_WEB_COPILOT_PROFILE_DIR:-/var/data/whatsapp-profile-live}"'), 'Hosted start script must supervise Chrome with xvfb-run and default to persistent disk profile');
assert(startScript.includes('WHATSAPP_WEB_COPILOT_HEADLESS="${WHATSAPP_WEB_COPILOT_HEADLESS:-true}"'), 'Hosted start script must default to headless Chrome so the linked session does not depend on an X server');
assert(startScript.includes('exec node scripts/whatsapp-web-agent.js'), 'Hosted start script must hand off directly to the WhatsApp Node agent');
assert(!renderYaml.includes('/ms-playwright/chromium-1217'), 'Render config must not pin Chrome to a Playwright revision-specific path');
assert(!startScript.includes('/ms-playwright/chromium-1217'), 'Hosted start script must let Playwright resolve the Chromium executable path');
assert(!agentScript.includes('if (!CDP_URL && !fs.existsSync(CHROME_PATH))'), 'WhatsApp agent must not exit before Playwright browser path fallback runs');
assert(startScript.includes('WHATSAPP_WEB_COPILOT_XVFB_MANAGED="true"'), 'xvfb-run must tell the Node supervisor that the display is externally managed');

const workerSupervisor = read('scripts/whatsapp-web-agent.js');
assert(workerSupervisor.includes('async function ensureVirtualDisplay()'), 'Worker supervisor must verify a display even when Render bypasses the Docker start script');
assert(workerSupervisor.includes("'/usr/bin/Xvfb'") && workerSupervisor.includes('hasLiveDisplay'), 'Worker supervisor must recover a missing Render X display');
assert(workerSupervisor.includes("WHATSAPP_WEB_COPILOT_HEADLESS = 'true'"), 'Worker supervisor must have a bounded headless fallback instead of looping offline');
assert(workerSupervisor.includes('exiting so Render can restart the full worker'), 'Worker supervisor must let Render recover if its managed display dies');

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
assert(agentScript.includes('ready_state: readyState') && agentScript.includes("phase: 'online'"), 'Online heartbeats must replace stale login readiness metadata');
assert(agentScript.includes('isIgnoredWhatsappSystemChat(chatKey)') && agentScript.includes("skipped: 'whatsapp_system_chat'"), 'Worker must not ingest WhatsApp official system threads as customers');
assert(agentScript.includes('.filter((row) => !isIgnoredWhatsappSystemChat(row.title))'), 'Unread counts and scans must exclude WhatsApp official system threads');
assert.strictEqual(chatFilter.isIgnoredWhatsappSystemChat('WhatsApp'), true, 'WhatsApp official system chat must be ignored');
assert.strictEqual(chatFilter.isIgnoredWhatsappSystemChat('  WHATSAPP  '), true, 'WhatsApp system chat matching must ignore case and spacing');
assert.strictEqual(chatFilter.isIgnoredWhatsappSystemChat('+256 700 123456'), false, 'Real phone recipients must remain eligible');
assert.strictEqual(chatFilter.isIgnoredWhatsappSystemChat('WhatsApp Customer'), false, 'Only the exact official system chat title should be suppressed');
assert(agentScript.includes('WHATSAPP_WEB_COPILOT_USER_AGENT') && agentScript.includes('Chrome/120.0.0.0'), 'Hosted browser must present a normal Chrome user agent for WhatsApp Web');
assert(agentScript.includes('--disable-blink-features=AutomationControlled') && agentScript.includes("navigator, 'webdriver'"), 'Hosted browser must avoid the automated/headless browser rejection path');
assert(agentScript.includes('isChromiumProfileLockError') && agentScript.includes('launchPersistentContextWithProfileRetry'), 'Hosted worker must retry while Render rolling deploys still hold the persistent WhatsApp profile lock');
assert(agentScript.includes('WHATSAPP_WEB_COPILOT_PROFILE_LOCK_MAX_WAIT_MS') && agentScript.includes('WhatsApp Web profile is locked by another Chromium process'), 'Profile-lock retry must be bounded and visible in worker logs');
assert(agentScript.includes('hasChromiumProfileLockFiles') && agentScript.includes('SingletonLock'), 'Profile-lock retry must detect Chrome lock files when Playwright only throws a generic closed-browser error');
assert(agentScript.includes('WHATSAPP_WEB_COPILOT_PROFILE_LOCK_STALE_CLEAR_MS') && agentScript.includes('clearChromiumProfileLockFiles'), 'Hosted worker must clear stale Chrome profile locks after a guarded wait');
assert(agentScript.includes('cleared ${cleared} stale Chrome profile lock'), 'Stale profile-lock cleanup must be visible in Render logs');
assert(agentScript.includes('fs.lstatSync(filePath)'), 'Stale profile-lock cleanup must see broken Chrome lock symlinks');

assert(readiness.includes('hosted_agent_online') && readiness.includes('only_local_laptop_bridge_is_online'), 'Admin readiness must distinguish hosted 24/7 bridge from local-only bridge');
assert(adminApp.includes('Hosted WhatsApp login screen') && adminApp.includes('login_screenshot_data_url'), 'Admin WhatsApp overview must render the hosted login screenshot from protected insights');
assert(whatsappRoute.includes("router.get('/web-bridge/status'") && whatsappRoute.includes('evaluateHostedWhatsappBridgeReadiness'), 'Bridge token must expose a protected read-only status endpoint for hosted worker proof');
assert(whatsappRoute.includes('summarizeWhatsappBridgeClient') && whatsappRoute.includes('isWhatsappWebBridgeAuthorized(req)'), 'Bridge status endpoint must be token-protected and return sanitized client metadata');

console.log('WhatsApp hosted worker setup ok');
