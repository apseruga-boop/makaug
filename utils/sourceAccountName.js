'use strict';

// C15c (10 Oct 2026): found-online rows showed lister_name / source_name
// "tiktok.com" (e.g. 7918f050…, from @cheap_apartments_uganda). A bare domain
// is never a name: use the source account's handle from its channel or post
// URL, or the platform's account label.

const BARE_DOMAIN = /^(?:https?:\/\/)?(?:www\.|m\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?$/i;

const HANDLE_PATTERNS = [
  [/tiktok\.com\/@([\w.]{2,40})/i, 'TikTok'],
  [/instagram\.com\/(?!p\/|reel\/|tv\/|explore\/)([\w.]{2,40})/i, 'Instagram'],
  [/(?:twitter|x)\.com\/(?!i\/|status\/|home\b|search\b)([\w]{2,30})/i, 'X'],
  [/youtube\.com\/@([\w.-]{2,60})/i, 'YouTube'],
  [/youtube\.com\/(?:c|user)\/([\w.-]{2,60})/i, 'YouTube'],
  [/facebook\.com\/(?!profile\.php|watch|reel|share|groups\/|events\/|photo|story\.php)([\w.]{3,60})/i, 'Facebook']
];

function isBareDomainName(value = '') {
  const text = String(value || '').trim();
  return Boolean(text) && BARE_DOMAIN.test(text);
}

function handleFromUrl(url = '') {
  const text = String(url || '').trim();
  for (const [pattern] of HANDLE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return `@${match[1].replace(/\.+$/, '')}`;
  }
  return '';
}

function platformAccountLabel(platform = '', urls = []) {
  const known = String(platform || '').trim();
  if (known && !isBareDomainName(known)) return `${known} account`;
  for (const url of urls) {
    for (const [pattern, label] of HANDLE_PATTERNS) if (pattern.test(String(url || ''))) return `${label} account`;
  }
  return 'Online source';
}

/**
 * The public name for a found-online source. Keeps a real name; replaces a
 * bare domain with the account handle (from the channel/contact/post URL) or
 * "<Platform> account".
 */
function publicSourceAccountName(name = '', extra = {}, row = {}) {
  const current = String(name || '').trim();
  if (current && !isBareDomainName(current)) return current;
  const urls = [
    extra.source_channel_url, extra.source_contact_url, extra.source_page_url, extra.channel_url,
    extra.profile_url, extra.account_url, extra.source_url, extra.source_post_url, extra.tiktok_url,
    row.source_contact_url, row.source_url
  ].filter(Boolean);
  for (const url of urls) {
    const handle = handleFromUrl(url);
    if (handle) return handle;
  }
  return platformAccountLabel(extra.source_platform || row.source_platform, urls);
}

module.exports = { handleFromUrl, isBareDomainName, publicSourceAccountName };
