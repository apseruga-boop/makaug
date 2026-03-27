# MakaUg Launch Command Pack (Copy/Paste)

Use this in order.

## 1) Push latest code to GitHub

```bash
cd "/Users/arthurseruga/Documents/New project"
git status
git add .
git commit -m "Launch: AI brain + AI agents + production hardening"
git push origin main
```

## 2) Render shell commands (after deploy starts)

Run in Render Web Shell:

```bash
npm run migrate
npm run ai:run-agents
```

## 3) Health + AI checks (from your laptop terminal)

```bash
curl -s https://makaug.com/api/health
curl -s https://makaug.com/api/ai/model-card
```

## 4) AI listing rewrite test

```bash
curl -s -X POST https://makaug.com/api/ai/rewrite-description \
  -H "Content-Type: application/json" \
  -d '{
    "listing_type":"sale",
    "title":"3 Bedroom House in Ntinda",
    "description":"Nice house.",
    "district":"Kampala",
    "area":"Ntinda",
    "language":"en"
  }'
```

## 5) AI agent motherboard run test

Replace `YOUR_ADMIN_API_KEY`:

```bash
curl -s -X POST https://makaug.com/api/admin/ai-agents/run \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"agent_code":"all","trigger_source":"launch_test","created_by":"founder","limit":30}'
```

## 6) Pull findings to review

```bash
curl -s "https://makaug.com/api/admin/ai-agents/findings?status=open&limit=50" \
  -H "x-api-key: YOUR_ADMIN_API_KEY"
```

## 7) Accept a finding and create action

Replace `FINDING_ID`:

```bash
curl -s -X POST "https://makaug.com/api/admin/ai-agents/findings/FINDING_ID/decision" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"decision":"accepted","actor_id":"founder","notes":"Approved by launch review"}'
```

## 8) Approve action

Replace `ACTION_ID`:

```bash
curl -s -X POST "https://makaug.com/api/admin/ai-agents/actions/ACTION_ID/approve" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"actor_id":"founder"}'
```

## 9) Execute action (super-admin protected)

Replace keys + `ACTION_ID`:

```bash
curl -s -X POST "https://makaug.com/api/admin/ai-agents/actions/ACTION_ID/execute" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-super-admin-key: YOUR_SUPER_ADMIN_KEY" \
  -d '{"actor_id":"founder_super_admin"}'
```

## 10) Export weekly AI training data

Run in Render Shell or your secured ops machine:

```bash
npm run ai:export-training -- 30 4 5000
```

Output files:

- `exports/ai-training/makaug-ai-training-YYYYMMDD.jsonl`
- `exports/ai-training/makaug-ai-events-YYYYMMDD.csv`
