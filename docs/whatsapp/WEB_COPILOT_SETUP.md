# WhatsApp Web Copilot Setup

This is the low-cost first version of the MakaUg WhatsApp assistant.

Instead of paying for every reply through the official WhatsApp API from day one, this mode keeps **WhatsApp Web open on a dedicated machine** and lets the MakaUg admin inbox act as the control center.

## How it works

1. A team machine keeps **Google Chrome + WhatsApp Web** open all day.
2. The local bridge script watches unread chats.
3. New messages are pushed into MakaUg:
   - saved in the database
   - categorized
   - shown in `Admin -> WhatsApp Inbox`
4. AI can suggest replies or, for safe threads, queue replies automatically.
5. The local bridge polls the reply queue and sends the message through WhatsApp Web.
6. The dashboard still keeps the thread history, workflow state, and notes.

## Important limitations

This mode is practical and cheap, but it is still browser automation.

That means:

- Chrome must stay open
- WhatsApp Web must stay logged in
- the machine must stay awake and connected
- DOM/layout changes in WhatsApp Web can break selectors

So this should be treated as **Phase 1**, not the forever architecture.

## Environment variables

Add these to the machine running the bridge:

- `WHATSAPP_WEB_BRIDGE_ENABLED=true`
- `WHATSAPP_DELIVERY_MODE=web_bridge`
- `WHATSAPP_WEB_BRIDGE_TOKEN=...`
- `WHATSAPP_WEB_COPILOT_BASE_URL=http://localhost:8080`
- `WHATSAPP_WEB_COPILOT_CLIENT_ID=makaug-whatsapp-web`
- `WHATSAPP_WEB_COPILOT_OPERATOR_NAME=Arthur`
- `WHATSAPP_WEB_COPILOT_CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `WHATSAPP_WEB_COPILOT_PROFILE_DIR=.whatsapp-web-copilot-profile`
- `WHATSAPP_WEB_COPILOT_CDP_URL=http://127.0.0.1:9222` (optional, for attaching to an already-running Chrome)

The backend and the bridge must share the same:

- `WHATSAPP_WEB_BRIDGE_TOKEN`

## Start sequence

1. Start MakaUg backend:
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
