# makaug-waha-bridge

Adapter between **WAHA** (GOWS / whatsmeow engine) and the existing **makaug**
`web-bridge` API.

It replaces the Playwright + WhatsApp Web transport. **No changes are required
to makaug's conversation logic** — Agent 007, the admin WhatsApp Inbox, the
outbox queue and the AI runtime all keep working exactly as they do today.
Only the transport underneath changes.

```
  customer ──► WhatsApp ──► WAHA (GOWS) ──webhook──►  bridge  ──► makaug /web-bridge/inbound
  customer ◄── WhatsApp ◄── WAHA (GOWS) ◄──send────  bridge  ◄── makaug /web-bridge/outbox
```

## Why

The old transport drove a headless Chromium against web.whatsapp.com. It broke
on every WhatsApp UI change, needed ~1GB of RAM, corrupted its Chrome profile on
unclean restarts, and required a **manual re-pair by a human** every time the
session dropped. GOWS speaks the WhatsApp protocol directly: no browser, a
fraction of the memory, and it is currently the only engine that implements
WhatsApp's passkey (WebAuthn) pairing step.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness + WAHA session status + counters. Use as the Render health check. |
| `POST` | `/waha/webhook` | Receives WAHA events. HMAC-SHA512 verified when `WAHA_HOOK_HMAC_KEY` is set. |
| `GET` | `/media?p=…&s=…` | Signed proxy for inbound media. |

### Why media is proxied

WAHA serves media from `/api/files/...` behind its API key. makaug must not
hold that key, and the raw URL must not be made public. The bridge hands makaug
a short signed URL on its own domain and streams the bytes through, verifying
an HMAC signature on every request.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `WAHA_URL` | ✅ | — | e.g. `https://makaug-waha.onrender.com` |
| `WAHA_API_KEY` | ✅ | — | Must match WAHA's `WAHA_API_KEY`. |
| `WHATSAPP_WEB_BRIDGE_TOKEN` | ✅ | — | Must match makaug's value. |
| `WAHA_SESSION` | | `default` | WAHA session name. |
| `WAHA_HOOK_HMAC_KEY` | | — | Must match WAHA's `WHATSAPP_HOOK_HMAC_KEY`. **Set this.** |
| `MAKAUG_BASE_URL` | | `https://makaug.com` | |
| `ADAPTER_PUBLIC_URL` | | — | This service's public URL. **Inbound media is dropped without it.** |
| `ADAPTER_MEDIA_SECRET` | | bridge token | Signs media URLs. |
| `BRIDGE_CLIENT_ID` | | `makaug-waha-gows` | Shown in the admin inbox. |
| `OUTBOX_POLL_MS` | | `2000` | |
| `SEND_MIN_INTERVAL_MS` | | `3000` | Anti-ban pacing; floor is 1000. |
| `SEND_JITTER_MS` | | `1500` | Randomises the gap; fixed intervals look automated. |
| `HEARTBEAT_MS` | | `30000` | |
| `DRY_RUN` | | `false` | Logs instead of sending. Useful for a first smoke test. |

## Deploy (Render)

Web Service, Node runtime, `npm start`, health check path `/health`.
Single instance only — **never run two instances against one WhatsApp session**,
it is a documented cause of a permanent `device_removed` unlink.

## Test

```bash
npm test
```

Spins up a mock WAHA and a mock makaug and exercises the full path: inbound text,
inbound media through the signed proxy, echo suppression, forged-webhook
rejection, outbound text and image, failure reporting, and heartbeat. No network
and no real WhatsApp involved.

## Known limits

- **Buttons do not work** on any WhatsApp library; list menus are 1:1 only and
  may stop working without notice. Keep the bot on numbered text menus.
- **Albums arrive as separate events**, one per image. Grouping several photos
  into one submission has to happen in makaug, not here.
- `session.status: WORKING` is **not** proof the session is healthy — there are
  open WAHA issues where sends fail or webhooks stop while the status stays
  green. Treat a long gap in `last_inbound_ms_ago` plus rising `failed` as the
  real signal.
- This is an unofficial transport and remains against WhatsApp's terms. It can
  get the number banned. Inbound-reply-only, which is what makaug does, is the
  single biggest protective factor.
