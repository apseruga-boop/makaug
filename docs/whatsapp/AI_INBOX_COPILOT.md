# WhatsApp AI Inbox Copilot

This is the operational guide for the MakaUg WhatsApp support copilot.

## What is now built

The platform now supports a proper WhatsApp inbox workflow inside admin:

1. Every WhatsApp conversation is stored and grouped by phone number.
2. Each conversation can be categorized automatically or manually:
   - Property Search
   - Property Listing
   - Broker Help
   - Mortgage
   - Account
   - Support
   - Fraud / Report
   - Campaign / Marketing
   - General
3. Admin can control the workflow for each conversation:
   - Status
   - Priority
   - Assigned owner
   - AI mode
   - Internal notes
   - Short summary
4. AI can suggest replies for the current conversation.
5. Replies can be sent from the connected WhatsApp provider or opened manually in WhatsApp.
6. The dashboard shows conversation counts, human handoff cases, and AI/manual split.

## AI modes

Each conversation has an AI mode:

- `autopilot`
  - AI can continue handling inbound messages automatically.
- `copilot`
  - AI helps classify and draft, but human review is expected before replies.
- `off`
  - AI stops auto-handling and the thread becomes human-led.

## Best production setup

For real production use, the recommended path is:

1. Use the official Meta WhatsApp Cloud API as the main channel.
2. Point the webhook to:
   - `POST /api/whatsapp/webhook`
3. Use the admin WhatsApp Inbox in the MakaUg dashboard as the control center.

This is better than browser automation because:

- it is more stable
- it is easier to audit
- every conversation can be logged
- every reply can be categorized and tracked
- it supports real dashboards and reporting

## Required env vars

For Meta WhatsApp Cloud API:

- `WHATSAPP_API_VERSION`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Optional Twilio fallback:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

AI features:

- `OPENAI_API_KEY`
- `OPENAI_INTENT_MODEL`
- `OPENAI_REPLY_MODEL`
- `OPENAI_TRANSCRIBE_MODEL`

## Go-live checklist

1. Run database migrations:
   - `npm run migrate`
2. Add the WhatsApp env vars in Render.
3. Set the Meta webhook callback URL to:
   - `https://your-domain/api/whatsapp/webhook`
4. Set the verify token to match `WHATSAPP_VERIFY_TOKEN`.
5. Send a real test message from WhatsApp.
6. Confirm the message appears inside:
   - `Admin -> WhatsApp Inbox`
7. Confirm:
   - category is detected
   - conversation appears in the list
   - AI draft reply works
   - provider send works, or manual WhatsApp fallback opens

## Important limitation

If the team replies directly in WhatsApp Web outside the official provider flow, those manual actions are not guaranteed to be written back into the MakaUg dashboard automatically.

That means:

- official API/webhook flow = fully trackable
- browser-only WhatsApp Web workflow = partial visibility at best

So the reliable production model is:

- WhatsApp number connected through Meta Cloud API
- MakaUg admin inbox used as the main response console

## What this enables next

Once this is live, we can build on top of it:

1. SLA timers for unanswered conversations
2. Team inbox ownership and routing
3. Saved reply templates by category
4. Bulk outreach linked to account segments
5. Performance reporting by admin / broker / field team
6. AI summaries and conversation quality scoring
