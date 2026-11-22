# WhatsApp AI Inbox Copilot

This is the operational guide for the makaug WhatsApp support copilot.

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

## When a person on the team writes to an agent (21 Nov 2026)

An approved agent's posting session answers before the AI mode above is looked
at, so switching an agent's chat to `copilot` or `off` does not stop the
assistant answering what they type there. On 21 Nov 2026 an agent answered a
message typed in the inbox ("When are you free next week?") with "I'm always
available", and was told twice that his words did not describe a property.

The rule now (`services/whatsappPersonThreadService.js`, used in
`routes/whatsapp.js`):

- For 72 hours after somebody on the team sends an agent a message from the
  inbox, what that agent types back that is talk (a hello, an "ok", an answer,
  a question, a voice note) gets no automatic answer. `WHATSAPP_PERSON_THREAD_HOURS`
  changes the 72.
- The team gets one WhatsApp note with the agent's words and what we last wrote
  to them. Lines sent within 45 seconds of each other go in the same note; at
  night it waits for the morning round-up. The number is shown by its last
  three digits, and the reply goes from the inbox.
- Everything the assistant acts on carries on as before: photos and videos,
  a property caption, COMPLETE and CANCEL, MENU, HELP, STATUS, SHARE, how to
  post, a question about a payment link, agreeing to the terms.
- It applies to approved agents, with or without a posting session open. Staff
  numbers (Arthur, Ronald, staff added to Agent 007 in King) are never left
  unanswered. Customers are not affected: their chats still follow the AI mode.
- A message "sent from the inbox" is one the reply route queued with
  `reply_kind` `admin_human_reply` or `admin_ai_reply`. Automatic messages
  (the Morning Brief, a go-live notice, a lead) do not start the 72 hours.

Outside those 72 hours, an agent's message that is neither a property nor
something the assistant has an answer to is no longer told "I did not save
that, because it does not describe a property...". It gets a short thank-you
(once in half an hour) and goes to the team in the same kind of note.

## Best production setup

For real production use, the recommended path is:

1. Use the official Meta WhatsApp Cloud API as the main channel.
2. Point the webhook to:
   - `POST /api/whatsapp/webhook`
3. Use the admin WhatsApp Inbox in the makaug dashboard as the control center.

This is better than browser automation because:

- it is more stable
- it is easier to audit
- every conversation can be logged
- every reply can be categorized and tracked
- it supports real dashboards and reporting

## Low-cost launch option

If you want to start with WhatsApp Web first, use:

- [WhatsApp Web Copilot Setup](/Users/arthurseruga/Documents/New project/docs/whatsapp/WEB_COPILOT_SETUP.md)

That mode keeps Chrome + WhatsApp Web open on a dedicated machine and lets the makaug inbox queue replies for the local browser bridge to send.

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

If the team replies directly in WhatsApp Web outside the official provider flow, those manual actions are not guaranteed to be written back into the makaug dashboard automatically.

That means:

- official API/webhook flow = fully trackable
- browser-only WhatsApp Web workflow = partial visibility at best

So the reliable production model is:

- WhatsApp number connected through Meta Cloud API
- makaug admin inbox used as the main response console

## What this enables next

Once this is live, we can build on top of it:

1. SLA timers for unanswered conversations
2. Team inbox ownership and routing
3. Saved reply templates by category
4. Bulk outreach linked to account segments
5. Performance reporting by admin / broker / field team
6. AI summaries and conversation quality scoring
