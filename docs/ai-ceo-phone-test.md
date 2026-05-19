# AI CEO phone test

Use this when you want to prove that the founder phone can control the makaug AI CEO through WhatsApp and that non-owner phones cannot.

## Environment

Set these in local `.env` and in Render:

```env
AI_CEO_OWNER_WHATSAPP_ENABLED=true
AI_CEO_OWNER_PHONES=+44XXXXXXXXXX
AI_CEO_REPORT_WHATSAPP_RECIPIENTS=+256XXXXXXXXX
AI_CEO_PHONE_TEST_OWNER=+44XXXXXXXXXX
AI_CEO_OWNER_COMMAND_PREFIX=CEO
AI_CEO_EMAIL_SEND_MODE=draft
AI_CEO_PHONE_TEST_COMMAND=CEO report
AI_CEO_PHONE_TEST_TIMEOUT_MS=15000
```

`AI_CEO_OWNER_PHONES` can contain more than one trusted phone, separated by commas. Those numbers can control the AI CEO over WhatsApp.

`AI_CEO_REPORT_WHATSAPP_RECIPIENTS` can contain one or more report-only partner numbers, separated by commas. These recipients receive the scheduled morning WhatsApp report and can request read-only reports such as `CEO report`, `CEO leads`, or `CEO WhatsApp health`. They are not authorised for risky WhatsApp CEO commands such as email sending unless they are also added to `AI_CEO_OWNER_PHONES`.

Keep `AI_CEO_EMAIL_SEND_MODE=draft` until founder approval for direct sending is intentional.

The test also needs `DATABASE_URL` because it verifies command logging, AI CEO report generation, and WhatsApp runtime routing.

## Run the automated test

```bash
npm run migrate
npm run test:ai-ceo-phone
```

Expected success output:

```json
{
  "ok": true,
  "owner_authorized": true,
  "non_owner_blocked": true,
  "direct_command_handled": true,
  "whatsapp_runtime_intercepted": true
}
```

If you see `Set AI_CEO_OWNER_PHONES...`, add the founder phone to the environment first.

If you see `ECONNREFUSED`, the test cannot reach the configured Postgres database. Fix `DATABASE_URL`, start local Postgres, or run the test in the Render environment.

## Run the real phone test

1. Deploy the environment variables.
2. Restart the makaug web service and WhatsApp bridge.
3. From the authorized founder phone, send this to the makaug WhatsApp number:

```text
CEO report
```

The assistant should reply with the AI CEO report, including listing status, leads, WhatsApp health, revenue/advertising indicators, and urgent owner actions.

Send the same phrase from a non-owner phone. It must not reveal CEO/admin data and should stay in the normal customer chatbot flow.

## Useful owner commands

```text
CEO report
CEO pending listings
CEO leads
CEO WhatsApp health
CEO email status
CEO revenue
CEO brokers
```

Risky actions stay queued for founder approval unless the relevant kill switch and direct-send mode are deliberately enabled.
