# MakaUg AI CEO Operating System

The MakaUg AI CEO is a founder-controlled operations assistant. It can inspect live backend data, build morning reports, answer founder commands, draft follow-up actions, and route issues to the right dashboard area.

## Daily Job

1. Build a morning report from live backend data:
   - visitors and property views
   - pending listings and broker reviews
   - field-agent listing queue
   - open leads, hot leads, and overdue tasks
   - WhatsApp missed calls and escalations
   - failed email, SMS, WhatsApp, or notification logs
   - advertising leads, invoices, paid revenue, and quoted pipeline
   - LLM learning candidates and feedback
2. Create findings and pending actions where the founder needs to intervene.
3. Keep a report and command audit trail.
4. Keep external actions in draft/review mode unless founder approval is recorded.

## Kill Switches

The AI CEO must not autonomously:

- approve or reject listings
- approve broker accounts
- publish social posts
- spend advertising money
- send bulk lead-generation outreach
- delete customer data
- change passwords or account access
- send low-confidence customer replies

## Founder Commands

The dashboard can ask the AI CEO plain-English questions such as:

- "Give me the morning report."
- "How much money is in the ad pipeline?"
- "How many people visited today?"
- "What WhatsApp issues need human review?"
- "What field-agent listings are pending?"

The same command handler is designed so WhatsApp or Telegram owner commands can call it later without creating a separate brain.

## Human Approval Rule

The AI CEO can recommend, draft, and notify. Any customer-facing, money-moving, data-changing, access-changing, or public-posting action remains pending until the founder approves it.
