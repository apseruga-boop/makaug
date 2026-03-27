# MakaUg Postman QA Pack

## Files
- `MakaUg_GoLive_QA.postman_collection.json`
- `MakaUg_GoLive_QA.postman_environment.json`

## Import
1. Open Postman.
2. Import both files.
3. Select environment: **MakaUg - Go Live QA Environment**.
4. Fill environment variables:
   - `admin_api_key`
   - `super_admin_key`
   - `listing_otp_code` (real OTP from SMS/email during test)

## One-command terminal run (Newman)
```bash
cd "/Users/arthurseruga/Documents/New project"
export ADMIN_API_KEY="your-admin-key"
export SUPER_ADMIN_KEY="your-super-admin-key"
export LISTING_OTP_CODE="the-real-otp-you-received"
npm run qa:postman
```

Optional (test against Render URL directly):
```bash
cd "/Users/arthurseruga/Documents/New project"
export ADMIN_API_KEY="your-admin-key"
export SUPER_ADMIN_KEY="your-super-admin-key"
export LISTING_OTP_CODE="the-real-otp-you-received"
npm run qa:postman:render
```

## Run order
Run requests in numeric order (`01` to `10`).

## Auto-saved variables
These are set automatically by test scripts:
- `listing_otp_token` (from OTP verify)
- `property_id` (from create property)
- `finding_id` (from open findings)
- `action_id` (from actions list)

## Notes
- Admin endpoints use header: `x-api-key`
- Super-admin execution endpoint also needs: `x-super-admin-key`
- WhatsApp webhook endpoint expects Twilio-style form payload (`From`, `Body`, `NumMedia`).
- `/api/whatsapp/test` is development-only and is blocked in production.
- Newman reports are generated in `reports/postman/`.
