# TWENDE Go-Live API Plan

This app is now structured as a launch-facing mobile prototype. The interface runs standalone, while `api-client.js` and `twende-config.example.js` define the production connection points.

## Recommended Map Stack

Use Leaflet with OpenStreetMap tiles for prototype and early demos because it is fast, mobile-friendly, and does not require a private key.

For production, choose one:

- Google Maps Platform: best if you need Places, traffic, rich POIs, and Google-grade mobile SDKs. Requires a Google Cloud project, billing, enabled APIs, and restricted keys.
- Mapbox: strong visual control and vector tiles. Requires a Mapbox access token.
- Hosted OpenStreetMap/vector tiles: best long-term control if you want predictable costs and local styling.

## Route And Live Bus Data

Current seed data is based on public Kigali Bus Services route tables, including stop names, coordinates, route corridors, and fares.

Production data model:

- GTFS Static for stops, routes, trips, calendars, fares, and route shapes.
- GTFS-Realtime VehiclePositions for moving buses.
- GTFS-Realtime TripUpdates for ETA and delay.
- GTFS-Realtime ServiceAlerts for disruptions, skipped stops, and stop closures.

Backend endpoints expected by `api-client.js`:

```http
GET /routes
GET /stops/:stopId/arrivals?routeId=517
GET /live/vehicles?routeId=517
GET /live/alerts?routeId=517
```

## Tap&Go Card Integration

Tap&Go balance, top-up, card linking, and fare deduction require a partner integration with the Tap&Go/AC Group card platform.

Expected backend endpoints:

```http
POST /cards/link
POST /cards/create
GET /cards/:cardId/balance
POST /cards/:cardId/topups
GET /cards/:cardId/transactions
```

## Mobile Money

Best launch default: MTN Mobile Money Collections because it is familiar locally and works well for top-up intents. Airtel Money should be a second wallet option, with card payments added once compliance and processor setup are ready.

Payment rules:

- Create a payment intent before prompting the user.
- Send the provider reference and idempotency key.
- Credit Tap&Go balance only after provider webhook confirmation.
- Keep payment PII separate from trip telemetry.

Expected backend endpoints:

```http
POST /payments/topup-intents
POST /payments/ticket-intents
POST /webhooks/momo
POST /webhooks/airtel
POST /webhooks/card
```

## Tap To Board

For a browser demo, Web NFC may work only in limited secure-context environments. For the real mobile app, use native NFC or Host Card Emulation where supported, plus the Tap&Go partner reader protocol.

Production paths:

- Android: native NFC/HCE, partner reader token, fare deduction callback.
- iOS: Wallet/pass integration or partner-supported NFC flow, depending on Tap&Go reader capability.
- Fallback: QR boarding token generated after payment.

## Alerts

Launch alert types:

- Leave now.
- Bus arriving.
- Hurry or you may miss it.
- Two stops away.
- Your stop is next.
- This is your stop.
- Route disruption.
- Stop closed or moved.

Expected backend endpoints:

```http
POST /alerts/subscriptions
GET /alerts/subscriptions
PATCH /alerts/subscriptions/:id
DELETE /alerts/subscriptions/:id
```

Use Web Push for web, FCM for Android, and APNs for iOS.

## Privacy And Support

- Do not expose exact rider location to other riders.
- Store only the minimum telemetry needed for ETA quality, fraud prevention, and customer support.
- Audit every card top-up, fare deduction, refund, and failed payment.
- Add lost-card support, card blacklist status, and balance transfer flow before public launch.
