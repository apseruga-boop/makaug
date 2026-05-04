# Field Agent Live Setup

Use this for the first MakaUg field agents you are signing up manually.

## Admin setup path

1. Sign in as `super_admin` or admin.
2. Open `/admin`.
3. Go to `Contacts & Account Control`.
4. Use `Create Field Agent login`.
5. Enter:
   - First name
   - Email address
   - Phone / WhatsApp
   - Private 4-digit PIN
   - Territory
   - Payout per approved listing, usually `15000`
6. Give the agent their phone/email and PIN privately.

The PIN is saved through the same hashed password field as normal login. It is not returned by the API, not printed in logs, and should not be shared in group chats.

## Starter agent codes

Use these as internal labels if useful:

- `FA-0001`
- `FA-0002`
- `FA-0003`
- `FA-0004`

The admin endpoint can also generate a code automatically when no code is provided.

## Agent login

Field agents sign in from the MakaUg account drawer:

- Choose `Field Agent`
- Enter phone/WhatsApp or email
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

## Owner controls

Admin can:

- Create/update field agent login
- Pause/restore field agent access
- Contact the agent on WhatsApp or email
- Review listing throughput and engagement
- See payout/listing rate

## Provider notes

WhatsApp/email/SMS delivery still depends on live provider credentials. If a provider is missing, MakaUg should keep a safe notification log rather than pretending a message was sent.
