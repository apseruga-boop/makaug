# MakaUg Go-Live Today (Simple Steps)

Use this exact order.

## 1. Put code on GitHub

```bash
cd "/Users/arthurseruga/Documents/New project"
git init
git add .
git commit -m "MakaUg launch"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 2. Create Render Postgres

1. Open Render dashboard.
2. Click `New` -> `Postgres`.
3. Name it `makaug-postgres`.
4. Choose region (same region you will use for web service).
5. Create DB.
6. Keep this open. You need the **Internal Database URL**.

## 3. Create Render Web Service

1. In Render, click `New` -> `Web Service`.
2. Connect your GitHub repo.
3. Use:
   - Build Command: `npm ci`
   - Start Command: `npm run start`
4. Add environment variables:
   - `NODE_ENV=production`
   - `APP_BASE_URL=https://makaug.com`
   - `PUBLIC_BASE_URL=https://makaug.com`
   - `CORS_ORIGINS=https://makaug.com,https://www.makaug.com`
   - `DATABASE_URL=<Render Internal Database URL>`
   - `DB_SSL=false`
   - `JWT_SECRET=<long random secret>`
   - `ADMIN_API_KEY=<long random secret>`
   - `SUPPORT_PHONE=+256770646879`
   - `SUPPORT_EMAIL=info@makaug.com`
5. (If Render shows **Pre-Deploy Command**, set it to `npm run migrate`.)
6. Deploy.

## 4. Add domain in Render

1. Open your Render Web Service.
2. Go to `Settings` -> `Custom Domains`.
3. Add:
   - `makaug.com`
   - `www.makaug.com`
4. Keep this page open.

## 5. Point GoDaddy DNS to Render

In GoDaddy DNS for `makaug.com`:

1. Delete any conflicting `A`, `AAAA`, forwarding, or old `CNAME` records for `@` and `www`.
2. Add root record:
   - Type: `A`
   - Host: `@`
   - Value: `216.24.57.1`
3. Add www record:
   - Type: `CNAME`
   - Host: `www`
   - Value: `<your-service>.onrender.com`
4. Save.
5. Wait for DNS propagation.

## 6. Verify domain in Render

1. Back in Render Custom Domains, click `Verify`.
2. Wait until SSL/TLS is issued and status is green.

## 7. Set Twilio WhatsApp sender + webhook

When your WhatsApp sender is approved:

1. In Twilio Console -> Messaging -> Senders -> WhatsApp Sender.
2. Configure incoming webhook:
   - URL: `https://makaug.com/api/whatsapp/webhook`
   - Method: `POST`
3. Save.

Set Twilio env vars in Render:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_SMS`
- `TWILIO_WHATSAPP_NUMBER=whatsapp:+256770646879`

Redeploy after adding env vars.

## 8. Live checks

Open these in browser:

- `https://makaug.com`
- `https://makaug.com/api/health`

Optional API checks from terminal:

```bash
curl https://makaug.com/api/health
curl https://makaug.com/api/mortgage-rates
```

## 9. Final switch-on

1. If `www` and root both load, keep both.
2. In Render, optionally disable `onrender.com` subdomain.
3. Launch announcement.

