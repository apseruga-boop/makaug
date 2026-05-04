# MakaUg Super Admin Environment Setup

Use this checklist to create the owner/super_admin account without hardcoded credentials or a universal password.

## Required Render Environment Variables

Set these in Render Web Service -> Environment:

| Variable | Required | Notes |
|---|---:|---|
| `DATABASE_URL` | yes | Use the Render Postgres **Internal Database URL**. |
| `JWT_SECRET` | yes | Long random secret used to sign auth tokens. |
| `ADMIN_API_KEY` | yes for admin API scripts | Long random secret used for admin API smoke/probe requests. |
| `SUPER_ADMIN_EMAIL` | yes for bootstrap | Owner email address. |
| `SUPER_ADMIN_INITIAL_PASSWORD` | yes for bootstrap only | One-time password, at least 12 chars with uppercase, lowercase, and a number. Never commit or print it. |
| `SUPER_ADMIN_PHONE` | optional | Owner phone/WhatsApp. If omitted, the script uses an internal placeholder phone. |

## Generate Safe Secrets

Run these locally and paste the results into Render. Do not paste the values into chat.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use one generated value for `JWT_SECRET` and another generated value for `ADMIN_API_KEY`.

For `SUPER_ADMIN_INITIAL_PASSWORD`, create a strong temporary password in your password manager. It must include uppercase, lowercase, and a number. Rotate it immediately after first login.

## Create Or Update The Super Admin

After the variables are set in Render and the service has redeployed, open a Render Shell for the web service and run:

```bash
npm run admin:create-super
```

Expected behavior:

- password is hashed with the project hashing method;
- password is not printed;
- user role becomes `super_admin`;
- `AdminSecuritySettings` is created/updated;
- `AdminAuditLog` records `super_admin_bootstrapped`;
- `forcePasswordChange` is set when supported.

## Verify Access

Sign in at:

```text
https://makaug.com/login
```

Then verify:

- `/admin`
- `/admin/launch-control`
- `/admin/docs`
- `/admin/crm`
- `/admin/leads`
- `/admin/advertising`
- `/admin/revenue`
- `/admin/notifications`
- `/admin/emails`
- `/admin/whatsapp-inbox`
- `/admin/viewings`
- `/admin/callbacks`
- `/admin/field-agents`
- `/admin/payments`
- `/admin/contracts`
- `/admin/fraud`
- `/admin/data-protection`

## After First Login

1. Change the password.
2. Remove or replace `SUPER_ADMIN_INITIAL_PASSWORD` in Render so the bootstrap password is no longer retained.
3. Keep `SUPER_ADMIN_EMAIL`, `DATABASE_URL`, `JWT_SECRET`, and `ADMIN_API_KEY`.
4. Run:

```bash
BASE_URL=https://makaug.com npm run probe:backend-connections
```

The local probe can report env vars as missing if it is not run inside Render. That is expected. Live health/migration/protected API checks should pass.
