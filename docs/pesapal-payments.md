# Pesapal payments on MakaUG

Pesapal adds one-time UGX checkout to the existing `/pay/:code` page. MTN MoMo, Airtel Money, and cards use Pesapal's hosted checkout. Direct MoMo transfers and Revolut retain their existing buttons and references. This change does not add recurring mobile-money mandates.

## Payment verification and application

Each checkout has an immutable purchase snapshot and merchant reference in `pesapal_payment_attempts`. The service commits the reference before submitting the order. It stores the provider tracking ID and checkout URL before redirecting the customer. Repeated clicks reuse the attempt.

A timeout after submission leaves an `unknown` attempt. The service never submits that attempt again. A later authenticated status check can bind the original tracking ID. The protected revenue dashboard also accepts an original tracking ID copied from the merchant portal.

The browser return and IPN contain untrusted identifiers. Both fetch the transaction through the merchant API. The service matches the merchant reference, exact whole UGX amount, currency, and requested tracking ID to the stored purchase. A success URL or browser field cannot mark a payment paid.

Pesapal, Revolut, and pay-link-backed staff confirmations share one transaction boundary. That transaction locks the debt and product, records the receipt, applies the purchase, closes the link, and stores notification jobs. A product-write failure rolls back all these changes. A pending agent stays pending after payment, with a marker for staff approval.

One receipt can apply to each debt. Another actual collection for an already-paid debt is recorded as an excess receipt for staff review. It cannot grant another period. Ledger identity and application constraints remain in force after a receipt is voided. A later reversal remains visible for review, with the receipt and granted period retained. No refund or revocation is automatic.

## Configuration reference

| Variable | Meaning |
| --- | --- |
| `PESAPAL_ENABLED` | `true` permits new checkout when every other readiness check passes. Defaults off. |
| `PESAPAL_ENV` | Explicit `sandbox` or `live`. No default. |
| `PESAPAL_MERCHANT_APPROVED` | Must be `true` for live checkout after Pesapal approval. |
| `PESAPAL_MERCHANT_PROFILE` | Stable merchant identity for stored attempts. Default `makaug_uganda`. |
| `PESAPAL_CONSUMER_KEY` | Server-only key for the selected environment. |
| `PESAPAL_CONSUMER_SECRET` | Server-only secret for the selected environment. |
| `PESAPAL_IPN_ID` | UUID returned by explicit IPN setup for that merchant and environment. |
| `PUBLIC_BASE_URL` | HTTPS origin, such as `https://makaug.com`, with no path or query. |
| `COUNTRY_CODE` | Checkout is restricted to `UG`. |
| `PAYMENT_NOTICE_DISPATCH_ENABLED` | `false` holds committed notification jobs without transport. |

`PESAPAL_TEST_BASE_URL` is a test-only loopback override. Sandbox and fake-provider work require `NODE_ENV=test`, the launcher's database naming pattern, a non-superuser application role, an actual loopback PostgreSQL address, and the random ownership sentinel. The guard applies to both checkout and settlement. Production rejects sandbox checkout. Keys never appear in API readiness responses or browser HTML.

New checkout can be disabled while reconciliation continues for accepted attempts. Keep the merchant environment and credentials available for that reconciliation.

## Routes and dashboard

| Route | Responsibility |
| --- | --- |
| `POST /pay/:code/pesapal` | Reserve or resume the link's checkout. |
| `GET /pay/:code/pesapal-return` | Validate `CALLBACKURL` identifiers and fetch provider status. |
| `POST /api/pay/webhooks/pesapal` | Validate `IPNCHANGE` identifiers, fetch status, and acknowledge after processing. |
| `GET /api/admin/revenue/pesapal` | Read readiness and recent attempts through existing admin authentication. |
| `POST /api/admin/revenue/pesapal/:id/check` | Fetch status for the stored tracking ID. |
| `POST /api/admin/revenue/pesapal/:id/recover` | Verify an original tracking ID for an uncertain submission. |

The existing Sales & Revenue dashboard shows checkout readiness, attempt states, excess collections, reversals, and notification status. It uses the existing revenue ledger and adds a `pesapal_ugx` account. Recovery never changes merchant credentials or creates a replacement order.

The Pesapal account records gross customer receipts. Merchant fees, settlement transfers, and the bank's net deposit still require finance reconciliation after the contracted fees are confirmed. This feature does not initiate bank withdrawals or refunds.

## Notification delivery

`payment_notice_retries` stores the exact recipient, body, or typed internal event in the settlement transaction. Workers claim jobs with leases and claim IDs, then call the existing transport after commit. An expired worker cannot overwrite a newer worker's result.

`queued` means the transport accepted the message into its queue. It does not mean delivered. `sent`, `simulated`, `retry`, and `review` are separate states. Transport delivery is at least once: a crash after transport acceptance but before the result is stored can repeat a message. Stable event keys support downstream deduplication.

## Activation procedure

1. Complete Pesapal's current merchant agreement and secure KYC process. Confirm the registered Uganda entity, settlement bank, fees, and live API approval with Pesapal.
2. Apply migration `193_pesapal_payment_attempts.sql` before deploying these routes. Retain the default `PESAPAL_ENABLED=false`.
3. Run sandbox acceptance on a dedicated local test or sandbox database. Use separate sandbox merchant credentials.
4. Configure the live key and secret in server secret settings. Keep the same merchant profile on future deployments.
5. Run `node scripts/pesapal-ipn-setup.js` to inspect the proposed notification URL without changing Pesapal. Use its documented `--apply` option only for the approved merchant and origin. Store the returned notification ID in the server settings.
6. Confirm live merchant approval, then set `PESAPAL_ENV=live` and `PESAPAL_MERCHANT_APPROVED=true`.
7. After release approval, set `PESAPAL_ENABLED=true`. Complete a user-authorized payment through the real hosted checkout and check the receipt, product, dashboard, and notice states.

The IPN setup script does not run during startup or payment requests. It refuses an existing registration whose method or active state it cannot verify.

## Verification reference

Run `node scripts/test-pesapal-payments.js` with Node 20 and local PostgreSQL tools. The launcher creates its own temporary loopback cluster, applies migrations, and runs through a non-superuser application role. It refuses an existing supplied database URL and verifies a random ownership sentinel. It uses local fake HTTP providers and blocked external transports, then removes its cluster.

The behavior suites cover concurrent checkout, duplicate IPNs, lost responses, callback recovery, cross-provider collections, fulfillment rollback, missed IPN reconciliation, pending-agent approval, exact money, immutable history, reversals, environment gates, notification retries, and stale worker claims. Additional route tests cover public HTML, pending receipts, notification types, dashboard recovery, and admin authorization.

No signup, OTP, CRM, or marketing workflow changes are part of this feature. Existing regression suites cover those paths where they share the changed application bundle or hosted-payment service. The pay page retains its existing English copy pattern. Translation work is a separate release requirement if localized checkout is requested.

Operational counts come from attempts, ledger allocations, and notice states in the protected dashboard. No new third-party analytics destination receives payment identifiers.

Historical links do not acquire a voluntary-payment override by inference. Staff can create a replacement exempt-agent link with explicit `allow_exempt=true`. The agent's fee exemption remains unchanged.

Pesapal order reservation is serialized. Revolut retains its existing single order-ID field and checkout-creation behavior. This change improves Revolut settlement atomicity but does not provide durable recovery for competing Revolut order-creation requests. Review that separate path before claiming all-provider submission recovery.

## Rollback reference

Set `PESAPAL_ENABLED=false` to stop new checkout. Retain the callback, IPN, reconciliation, ledger, and outbox code for payments already accepted. Keep all receipt and attempt history. Do not drop migration 193 after any attempt or receipt exists. A code rollback requires checking compatibility with the new permanent receipt constraints and unresolved attempts first.

## Official references

- [API 3.0 documentation](https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json)
- [Uganda merchant support](https://www.pesapal.com/ug/help-support)
