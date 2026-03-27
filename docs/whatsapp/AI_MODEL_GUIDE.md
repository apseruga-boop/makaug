# MakaUg AI Model Guide (Very Simple)

This guide explains the MakaUg AI system like a simple checklist.

## 1) What this AI does

The AI helps with 3 big things:

1. Understand WhatsApp messages (`intent classification`)
2. Improve listing text (`listing intelligence`)
3. Suggest short support replies (`assistant reply`)

It is made for Uganda property workflows and supports:

- English
- Luganda
- Kiswahili
- Acholi
- Runyankole
- Rukiga
- Lusoga

## 2) How data flows

1. User sends message (or voice note) on WhatsApp.
2. Backend receives it.
3. We save raw data in PostgreSQL tables.
4. AI classifies what the user wants.
5. Bot replies in the selected language.
6. AI event is logged in `ai_model_events`.
7. Team feedback is saved in `ai_model_feedback`.
8. Later we export high-quality examples to improve prompts/models.

## 3) Setup once

1. Fill `.env`:
   - `OPENAI_API_KEY`
   - `OPENAI_INTENT_MODEL`
   - `OPENAI_LISTING_MODEL`
   - `OPENAI_REPLY_MODEL`
   - `OPENAI_TRANSCRIBE_MODEL`
   - `AI_MODEL_VERSION`
2. Run DB migration:
   - `npm run migrate`
3. Start app:
   - `npm run dev` (or production start command)

## 4) Quick test commands

1. Health:
   - `GET /api/health`
2. Model card:
   - `GET /api/ai/model-card`
3. Listing rewrite:
   - `POST /api/ai/rewrite-description`
4. Assistant reply:
   - `POST /api/ai/assistant-reply`

## 5) Weekly improvement loop

Every week do:

1. Export good AI examples:
   - `npm run ai:export-training -- 30 4 5000`
   - Means: last 30 days, min rating 4/5, max 5000 rows.
2. Open output:
   - `exports/ai-training/makaug-ai-training-YYYYMMDD.jsonl`
   - `exports/ai-training/makaug-ai-events-YYYYMMDD.csv`
3. Review bad answers in CSV.
4. Add notes/labels with `/api/ai/feedback`.
5. Update prompt/rules if needed.
6. Deploy.

## 6) What team members do day-to-day

### Support team
- Check user complaints.
- Add feedback labels for bad AI answers.

### Listings team
- Use rewrite endpoint to polish descriptions.
- Approve/reject listings (manual moderation).

### Admin/ops
- Watch logs and error rates.
- Export weekly training data.
- Track language quality per market.

## 7) Safety rules

- Never auto-publish listings from AI.
- Keep NIN/ID docs private.
- Keep admin API key secret.
- Only approved listings go live.

## 8) AI Agent Motherboard (Human-in-the-loop)

The new AI agent layer does this:

- scans pending listings for quality gaps
- checks NIN format + ID document metadata
- flags duplicate image URLs across listings
- drafts support replies for unresolved reports

Important control rule:

- AI can recommend and queue actions.
- Human admin approves.
- Super-admin key is required to execute sensitive actions.

This gives you one private control path while still using AI at scale.
