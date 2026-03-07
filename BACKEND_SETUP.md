# MakayUg Backend Setup

This backend is now scaffolded for same-day launch support.

## What is included

- Express API server (`server.js`)
- PostgreSQL integration (`config/database.js`)
- Structured routes:
  - `GET /api/health`
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/request-otp`
  - `POST /api/auth/request-password-reset`
  - `POST /api/auth/reset-password`
  - `POST /api/auth/verify-otp`
  - `GET /api/auth/me`
  - `PATCH /api/auth/me`
  - `POST /api/auth/change-password`
  - `GET/POST /api/properties`
  - `GET /api/properties/:id`
  - `POST /api/properties/:id/inquiries`
  - `PATCH /api/properties/:id/status` (admin key)
  - `GET/POST /api/agents`
  - `GET /api/agents/:id`
  - `POST /api/agents/register`
  - `POST /api/contact/report-listing`
  - `POST /api/contact/looking-for-property`
  - `POST /api/analytics/event`
  - `GET /api/analytics/config`
  - `GET /api/mortgage-rates`
  - `PUT /api/mortgage-rates` (admin key)
  - `GET /api/admin/summary` (admin key)
  - `GET /api/admin/recent` (admin key)
  - `GET /api/admin/users` (admin key)
  - `GET /api/admin/users/:id` (admin key)
  - `PATCH /api/admin/users/:id` (admin key)
  - `POST /api/whatsapp/webhook`
- Google Analytics 4 forwarding support (`services/ga4Service.js`)
- Twilio SMS integration/fallback (`models/smsService.js`)
- DB migrations + seed scripts:
  - `npm run migrate`
  - `npm run seed`

## Environment

1. Copy env file:

```bash
cp .env.example .env
```

2. Update these required values:

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_API_KEY`

3. Optional integrations:

- GA4:
  - `GA4_MEASUREMENT_ID`
  - `GA4_API_SECRET`
- Twilio:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_SMS`

## Launch steps

```bash
npm install
npm run migrate
npm run seed
npm run dev
```

Production:

```bash
npm ci
npm run migrate
npm run start
```

Smoke test (one command):

```bash
npm run smoke
```

Use custom target/admin key:

```bash
BASE_URL=https://yourdomain.com ADMIN_API_KEY=your_admin_key npm run smoke
```

Prelaunch check (GO/NO-GO):

```bash
npm run prelaunch
```

Prelaunch against live URL:

```bash
BASE_URL=https://yourdomain.com ADMIN_API_KEY=your_admin_key RUN_SEED=0 npm run prelaunch
```

## Admin endpoints

Set `x-api-key: <ADMIN_API_KEY>` header.

## Mortgage rates (weekly updates)

Frontend Mortgage Finder now loads rates from backend first, with static fallback if API is unavailable.

- Public endpoint:
  - `GET /api/mortgage-rates`
- Admin update endpoint:
  - `PUT /api/mortgage-rates`
  - Header: `x-api-key: <ADMIN_API_KEY>`

Example update:

```bash
curl -X PUT http://localhost:8080/api/mortgage-rates \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -d '{
    "providers": [
      {
        "key": "hfb",
        "name": "Housing Finance Bank",
        "residentialRate": 16.0,
        "commercialRate": 18.0,
        "landRate": 18.0,
        "minDepositPct": { "residential": 30, "commercial": 40, "land": 40 },
        "maxYears": { "residential": 20, "commercial": 20, "land": 15 },
        "arrangementFeePct": 1.5,
        "sourceLabel": "Housing Finance mortgage FAQs",
        "sourceUrl": "https://housingfinance.co.ug/mortgages-faqs/"
      }
    ]
  }'
```

## Frontend analytics connection

To track important frontend events through backend + GA4, call:

- `POST /api/analytics/event`

Example payload:

```json
{
  "event_name": "property_search",
  "client_id": "web.12345",
  "page_path": "/",
  "source": "web",
  "params": {
    "listing_type": "rent",
    "district": "Kampala"
  }
}
```

## Notes

- Static frontend is served from the same project root (`index.html`).
- WhatsApp flow in `routes/whatsapp.js` is fully wired to this DB schema.
- Property table stores dynamic listing fields for sale/rent/land/commercial/student variants.
