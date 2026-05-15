# Outlook AI Email Agent

The Outlook AI Email Agent connects MakaUg support email to Microsoft Graph. It is built to read inbound Outlook messages, classify the enquiry, write a safe reply draft, expose the draft in the King dashboard, and only send when the configured guardrails allow it.

## Safety Model

- Never give the agent a raw Outlook password.
- Use a dedicated Microsoft Entra app registration and Microsoft Graph permissions.
- Keep `OUTLOOK_AI_DRAFT_ONLY=true` until the workflow is proven.
- Keep `OUTLOOK_AI_REQUIRE_APPROVAL=true` for founder/admin approval.
- Leave `OUTLOOK_AI_AUTO_SEND_CATEGORIES` empty unless the team has explicitly approved direct sends for low-risk categories.
- Fraud, payment, legal, security, and complaint emails are always classified as human-review work.

## Environment

```bash
OUTLOOK_AI_AGENT_ENABLED=true
OUTLOOK_AI_DRAFT_ONLY=true
OUTLOOK_AI_REQUIRE_APPROVAL=true
OUTLOOK_AI_POLL_UNREAD_ONLY=true
OUTLOOK_AI_POLL_LIMIT=10
OUTLOOK_AI_MAILBOX=support@makaug.com
OUTLOOK_AI_TENANT_ID=...
OUTLOOK_AI_CLIENT_ID=...
OUTLOOK_AI_CLIENT_SECRET=...
OUTLOOK_AI_AUTO_SEND_CATEGORIES=
```

The agent also falls back to the existing `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, and `MS_GRAPH_SENDER_EMAIL` values when the Outlook-specific keys are not set.

## Microsoft Graph Setup

1. Create a Microsoft Entra app registration for the MakaUg support mailbox.
2. Add Graph permissions needed for the agent:
   - `Mail.Read`
   - `Mail.ReadWrite`
   - `Mail.Send`
3. Grant admin consent for the application.
4. Restrict the app to the dedicated support mailbox with an Exchange application access policy where possible.
5. Put the tenant ID, client ID, secret, and mailbox address in production environment variables.
6. Run migrations so `outlook_email_threads` and `outlook_email_actions` exist.

## Operation

Manual admin control:

- Open King dashboard.
- Go to Lead, Email & Notification Control.
- Use Outlook AI Email Agent.
- Sync inbox, review drafts, approve/reject, and send only when direct send mode is enabled.

Scheduled polling:

```bash
npm run ai:outlook-email-agent
```

Run this from a trusted scheduler. A 5-15 minute interval is suitable for support email; daily is too slow for customer enquiries. For daily content/social posting, use a separate content-agent workflow with its own approval queue.

## Routes

- `GET /api/admin/outlook-agent/status`
- `GET /api/admin/outlook-agent/actions`
- `POST /api/admin/outlook-agent/sync`
- `POST /api/admin/outlook-agent/draft`
- `POST /api/admin/outlook-agent/actions/:id/approve`
- `POST /api/admin/outlook-agent/actions/:id/reject`
- `POST /api/admin/outlook-agent/actions/:id/send`

All routes are behind the existing admin API guard.

## Tables

- `outlook_email_threads`: inbound Outlook thread/message inventory, category, confidence, and review flags.
- `outlook_email_actions`: AI reply drafts, approval state, Outlook draft IDs, send results, and failure reasons.

Every inbound and outbound decision writes to the existing email log service where the table exists.
