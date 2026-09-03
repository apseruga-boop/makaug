# WhatsApp Web Copilot Setup

This is the browser-transport version of the makaug WhatsApp assistant.

Production runs this transport in the dedicated always-on Render worker
`makaug-whatsapp-agent-docker`. A local Chrome session is a development and
recovery option only; Arthur's laptop is not part of the production runtime.

## How it works

1. The hosted worker keeps **Chromium + WhatsApp Web** open continuously using a persistent Render disk.
2. The hosted bridge script watches unread chats.
3. New messages are pushed into makaug:
   - saved in the database
   - categorized
   - shown in `Admin -> WhatsApp Inbox`
4. AI can suggest replies or, for safe threads, queue replies automatically.
5. The local bridge polls the reply queue and sends the message through WhatsApp Web.
6. The dashboard still keeps the thread history, workflow state, and notes.

## Important limitations

This mode is practical and cheap, but it is still browser automation.

That means:

- hosted Chromium must stay open
- WhatsApp Web must stay logged in
- the Render worker must stay online
- DOM/layout changes in WhatsApp Web can break selectors

So this should be treated as **Phase 1**, not the forever architecture.

## Environment variables

Add these to the machine running the bridge:

- `WHATSAPP_WEB_BRIDGE_ENABLED=true`
- `WHATSAPP_DELIVERY_MODE=web_bridge`
- `WHATSAPP_WEB_BRIDGE_TOKEN=...`
- `WHATSAPP_WEB_COPILOT_BASE_URL=https://makaug.com`
- `PUBLIC_BASE_URL=https://makaug.com`
- `WHATSAPP_WEB_COPILOT_CLIENT_ID=makaug-whatsapp-web`
- `WHATSAPP_WEB_COPILOT_OPERATOR_NAME=Arthur`
- `WHATSAPP_WEB_COPILOT_CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `WHATSAPP_WEB_COPILOT_PROFILE_DIR=.whatsapp-web-copilot-profile`
- `WHATSAPP_WEB_COPILOT_CDP_URL=http://127.0.0.1:9222` (optional, for attaching to an already-running Chrome)
- `WHATSAPP_WEB_COPILOT_POLL_MS=750` (optional; values below 400ms are clamped to prevent Chromium memory exhaustion)
- `WHATSAPP_WEB_COPILOT_RECENT_SWEEP_MS=3000` (optional; controls the wider recent-chat sweep)
- `WHATSAPP_WEB_COPILOT_FAST_LANE_SWEEP_MS=900` (optional; checks the newest chat rows without running a full sweep)
- `WHATSAPP_WEB_COPILOT_OUTBOX_POLL_MS=1000` (optional; bounds database/API outbox calls)
- `WHATSAPP_WEB_COPILOT_MAX_SESSION_MS=14400000` (optional; planned Chromium recycle every four hours)

The backend and the bridge must share the same:

- `WHATSAPP_WEB_BRIDGE_TOKEN`

For the live `makaug.com` setup, keep both the deployed backend and the
machine running WhatsApp Web pointed at the same production URL:

- `PUBLIC_BASE_URL=https://makaug.com`
- `WHATSAPP_WEB_COPILOT_BASE_URL=https://makaug.com`

Do not point the always-on WhatsApp Web bridge at `localhost` unless you are
intentionally testing a local backend.

For production use, keep the values above. The earlier 50ms/60ms configuration
busy-looped WhatsApp DOM scans and exhausted a 2 GB worker. The current fast
lane remains sub-second while wide scans and outbox polling are bounded.

## Isolated WhatsApp AI runtime

The WhatsApp transport remains a single sender. Do **not** run a second browser
worker against the same number.

The production AI credential is isolated in `makaug-whatsapp-ai-runtime`:

- Create a dedicated OpenAI project for makaug WhatsApp in Arthur's existing
  OpenAI organization. A separate OpenAI account is unnecessary; the separate
  project provides its own key, budget, usage view, and revocation boundary.
- Store the project's `OPENAI_API_KEY` (and optional `OPENAI_PROJECT`) only on
  `makaug-whatsapp-ai-runtime`.
- Generate one random `WHATSAPP_AI_RUNTIME_TOKEN` and store the same value on
  the AI runtime, the web service, and the existing transport worker.
- On the web service set:
  - `WHATSAPP_LLM_PROVIDER=openai_compat`
  - `WHATSAPP_LLM_API_BASE_URL=https://makaug-whatsapp-ai-runtime.onrender.com/v1`
  - `WHATSAPP_LLM_API_KEY=<WHATSAPP_AI_RUNTIME_TOKEN>`
- On the transport worker set:
  - `WHATSAPP_AI_RUNTIME_URL=https://makaug-whatsapp-ai-runtime.onrender.com`
  - `WHATSAPP_AI_RUNTIME_TOKEN=<same token>`

The main web service contains only the runtime token, not the dedicated OpenAI
key. Once `WHATSAPP_LLM_PROVIDER` is configured, WhatsApp fails closed rather
than borrowing the generic site/Seshaikhaya provider.

Health endpoints:

- `/health`: process liveness for Render.
- `/ready`: OpenAI configuration plus a fresh `online` heartbeat from the
  transport worker. Point the external uptime monitor here.

If the AI runtime is unavailable, the existing deterministic replies and
database outbox/human Inbox path remain available; messages are not silently
dropped.

## Start sequence

1. Start makaug backend:
   - `npm run dev`
2. Run migrations:
   - `npm run migrate`
3. Start the bridge:
   - `npm run dev:whatsapp-web`
4. Chrome will open WhatsApp Web.
5. Scan the QR code once.
6. Leave that Chrome window open.

### Attach to an existing Chrome session

If WhatsApp Web is already logged in inside a normal Chrome profile, start Chrome with remote debugging enabled:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
```

Then run the bridge with:

```bash
WHATSAPP_WEB_COPILOT_CDP_URL=http://127.0.0.1:9222 npm run dev:whatsapp-web
```

When `WHATSAPP_WEB_COPILOT_CDP_URL` is set, the bridge attaches to that browser instead of launching its own persistent profile.

## Admin workflow

Go to:

- `Admin -> WhatsApp Inbox`

There you can:

- see every tracked conversation
- categorize the contact reason
- switch AI mode
- assign the conversation
- ask AI for a reply draft
- queue a reply for the bridge to send in WhatsApp Web

## Recommended operating rules

Use:

- `Autopilot` for simple, repeatable threads
- `Copilot` for normal customer service
- `Human Only` for sensitive issues

Always force human review for:

- fraud / scam reports
- payment disputes
- legal questions
- unclear ownership or identity issues
- abusive or high-risk chats

## Recommended dedicated-machine setup

Use one Mac or laptop only for this:

- power connected
- sleep disabled
- Chrome pinned open
- WhatsApp Web pinned
- backend running in a stable terminal / service
- bridge running in a stable terminal / service

## What to test first

1. Send a WhatsApp message from a real phone.
2. Confirm it appears in `Admin -> WhatsApp Inbox`.
3. Ask AI to draft a reply.
4. Click send.
5. Confirm the message is delivered by the browser bridge.
6. Confirm the conversation thread updates in admin.

## When to move to the official API

Move to the official Meta WhatsApp Cloud API when:

- message volume grows
- uptime becomes critical
- you want stronger auditability
- you want less browser fragility
- you want richer automation at scale

At that point, the inbox and categorization logic can stay. We just switch the transport layer.
