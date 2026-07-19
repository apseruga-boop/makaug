# Marketplace source access

## LinkedIn

The approved route is LinkedIn's Community Management API. It is not a general
public-company search or scraping API. The authenticated member must administer
each organization whose posts are read.

Arthur needs to provide or complete:

- A LinkedIn Developer application associated with the makaug LinkedIn Company Page.
- Community Management API Development tier approval, followed by Standard tier approval for production use.
- A review video showing the end-to-end integration if LinkedIn requests technical sign-off.
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_REDIRECT_URI` (HTTPS and registered exactly in the app)
- `LINKEDIN_ACCESS_TOKEN` issued through three-legged OAuth
- `LINKEDIN_ORGANIZATION_IDS` for pages Arthur administers
- Approved read scope `r_organization_social` or its current Community Management successor shown in the app's Auth tab.

Official references:

- https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api

## Meta / Facebook

The initial adapter should read approved Facebook Pages, not personal profiles or
closed groups. Broad public Page content requires Meta App Review and may require
Page Public Content Access; managed Pages use Page access tokens.

Arthur needs to provide or complete:

- A Meta Developer app owned by a Meta Business Portfolio.
- Business verification for the legal business controlling the app.
- App ID and App Secret (store only in Render): `META_APP_ID`, `META_APP_SECRET`.
- A long-lived System User/Page access token: `META_GRAPH_ACCESS_TOKEN`.
- Comma-separated approved Page IDs: `FACEBOOK_PAGE_IDS`.
- App Review / Advanced Access for `pages_show_list`, `pages_read_engagement`, and `pages_read_user_content` where the requested Page-content flow requires it.
- Page Public Content Access approval if makaug will read Pages it does not manage.
- A public privacy policy, terms URL, data-deletion instructions, app icon, test credentials, and a review video showing exactly how Page content becomes a moderated Marketplace source.

Do not paste secrets into source control, tickets, or chat. Add them directly to
the Render environment and rotate any value that is accidentally exposed.

## MTN directory

Parked. No supported public business-directory adapter or approved data contract
has been identified. Do not scrape an authenticated customer directory or infer
consent from MTN subscriber data.

## Yellow Uganda and Uganda Business Directory

Proposed adapter effort: 3-5 engineering days plus a terms/robots review.

1. Confirm robots.txt and written terms permit automated directory indexing.
2. Crawl category and district result pages at no more than one request every 2-5 seconds.
3. Store the exact public profile URL, first/last seen timestamps, source label, and crawl audit event.
4. Parse only public business fields: name, category, district/area, phone/WhatsApp, website/social links, and coordinates where published.
5. Apply canonical Uganda district mapping, competitor blocking, contact-first holding, and name+district/source-URL dedupe before any profile becomes public.
6. Respect removal/claim requests and stop immediately on robots, terms, rate-limit, or legal objections.

Until that review is complete, both sources remain catalogued but disabled.
