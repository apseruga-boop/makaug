# Field Agent Live Setup

Use this for the first makaug.com Field Agents you are signing up manually.

## Admin setup path

1. Sign in as `super_admin` or admin.
2. Open `/admin`.
3. Go to `Contacts & Account Control`.
4. Use `Create Field Agent ID + PIN`.
5. Enter:
   - First name
   - Email address
   - Phone / WhatsApp
   - Private 4-digit PIN
   - Field Agent ID, for example `FA-0001` (optional; admin can generate the next ID)
   - Territory
   - Payout per approved listing, usually `15000`
6. Give the agent their Field Agent ID and PIN privately.

The PIN is saved through the same hashed password field as normal login. It is not returned by the API, not printed in logs, and should not be shared in group chats.

Field Agent sign-in does not use email/phone as the primary login. The live sign-in is:

- Field Agent ID: `FA-0001`
- 4-digit PIN: the private PIN set by admin

## Starter agent codes

Use these as internal labels if useful:

- `FA-0001`
- `FA-0002`
- `FA-0003`
- `FA-0004`

The admin endpoint generates the next available code automatically when no code is provided, and prevents duplicate Field Agent IDs.

## Agent login

Field Agents sign in from the makaug.com account drawer:

- Choose `Field Agent`
- Enter their Field Agent ID, for example `FA-0001`
- Enter the admin-issued `4-digit PIN`
- Open `/field-agent-dashboard`

## Dashboard proof points

The field-agent dashboard shows:

- Submitted listings
- Approved listings
- Rejected listings and reasons
- Conversion rate
- Agent rank
- Weekly payable balance
- Next payout/cut-off
- Money collection notes
- WhatsApp Operations link
- How to list online, via WhatsApp, and through the WhatsApp AI bot
- Contract and payout terms

Rejected listings include the rejection reason and a response/contest action. Responses are saved to moderation events and notification logs for admin follow-up.

## Listing attribution

Field Agent credit is linked by the Field Agent ID:

- Online listing form: if `Field Agent assisted?` is `Yes`, enter `FA-0001` style ID.
- WhatsApp listing flow: if assisted, the user is asked for the Field Agent ID, not the agent name or phone.
- Broker registration helper field also accepts `FA-0001` style ID.

The dashboard pulls matching listings from `properties.extra_fields.field_agent_id`, `field_agent_code`, `field_agent_reference`, and compatible legacy aliases.

## Dashboard downloads

These static resources are available from the Field Agent dashboard:

- `/assets/docs/field-agent/makaug-field-agent-job-ad.pdf`
- `/assets/docs/field-agent/makaug-field-agent-job-description.docx`
- `/assets/docs/field-agent/makaug-field-agent-welcome-pack.pptx`
- `/assets/docs/field-agent/makaug-field-agent-contract.docx`
- `/assets/docs/field-agent/makaug-field-agent-training-deck.pptx`

## Owner controls

Admin can:

- Create/update field agent login
- Pause/restore field agent access
- Contact the agent on WhatsApp or email
- Review listing throughput and engagement
- See payout/listing rate

## Provider notes

WhatsApp/email/SMS delivery still depends on live provider credentials. If a provider is missing, MakaUg should keep a safe notification log rather than pretending a message was sent.
