'use strict';

const DREAM_HOME_V8_BLOCK = Object.freeze({
  key: 'dream-home-real-estate',
  reason: 'owner_requested_permanent_social_source_block_20260909',
  accountIds: ['ucfvusmhrd9iinxi3jgl6qga'],
  handles: ['williolevis'],
  names: [
    'dream home real estate',
    'dream home real estate aka v8',
    'agaba lewis william',
  ],
  phones: [
    '256732639346',
    '256750719382',
    '256750819382',
    '256777647991',
  ],
});

const PERMANENT_SOCIAL_SOURCE_BLOCKS = Object.freeze([DREAM_HOME_V8_BLOCK]);

function clean(value = '') {
  return String(value || '').trim();
}

function normalizedIdentity(value = '') {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizedPhone(value = '') {
  const digits = clean(value).replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('0')) return `256${digits.slice(1)}`;
  return digits;
}

function identityValues(source = {}) {
  const raw = source.raw_source_post && typeof source.raw_source_post === 'object'
    ? source.raw_source_post
    : {};
  const youtubeSnippet = raw.youtube_search_item?.snippet || raw.youtubeSearchItem?.snippet || {};
  return [
    source.key,
    source.source_key,
    source.source_registry_key,
    source.sourceRegistryKey,
    source.agentKey,
    source.agent_key,
    source.external_channel_id,
    source.channel_id,
    source.youtube_channel_id,
    source.youtubeChannelId,
    source.name,
    source.source_name,
    source.source_agent_name,
    source.author_name,
    source.authorName,
    source.public_display_name,
    source.company,
    source.handle,
    source.username,
    source.author_url,
    source.url,
    source.source_url,
    source.sourceUrl,
    source.post_url,
    source.profile_url,
    source.profileUrl,
    source.source_page_url,
    source.sourcePageUrl,
    source.source_contact_url,
    source.sourceContactUrl,
    source.source_channel_url,
    source.sourceChannelUrl,
    source.youtube_channel_url,
    source.youtubeChannelUrl,
    raw.channel_id,
    raw.youtube_channel_id,
    raw.author_name,
    raw.author_url,
    raw.source_page_url,
    youtubeSnippet.channelId,
    youtubeSnippet.videoOwnerChannelId,
    youtubeSnippet.channelTitle,
  ].map(clean).filter(Boolean);
}

function phoneValues(source = {}) {
  return [
    source.phone,
    source.phoneAlt,
    source.phone_alt,
    source.contact_phone,
    source.contact_phone_alt,
    source.lister_phone,
    source.whatsapp,
  ].map(normalizedPhone).filter(Boolean);
}

function blockedSocialSourceMatch(source = {}, blocks = PERMANENT_SOCIAL_SOURCE_BLOCKS) {
  const identities = identityValues(source);
  const compactIdentities = identities.map(normalizedIdentity);
  const phones = phoneValues(source);
  for (const block of blocks) {
    const accountIds = block.accountIds.map(normalizedIdentity);
    const handles = block.handles.map(normalizedIdentity);
    const names = block.names.map(normalizedIdentity);
    const blockPhones = block.phones.map(normalizedPhone);
    const matchedIdentity = compactIdentities.find((value) => (
      accountIds.some((candidate) => value === candidate || value.includes(candidate))
      || handles.some((candidate) => value === candidate || value.includes(candidate))
      || names.includes(value)
      || value === normalizedIdentity(block.key)
    ));
    const matchedPhone = phones.find((value) => blockPhones.includes(value));
    if (matchedIdentity || matchedPhone) {
      return {
        key: block.key,
        reason: block.reason,
        matched_identity: matchedIdentity || '',
        matched_phone: matchedPhone || '',
      };
    }
  }
  return null;
}

function isPermanentlyBlockedSocialSource(source = {}) {
  return Boolean(blockedSocialSourceMatch(source));
}

module.exports = {
  DREAM_HOME_V8_BLOCK,
  PERMANENT_SOCIAL_SOURCE_BLOCKS,
  blockedSocialSourceMatch,
  isPermanentlyBlockedSocialSource,
  normalizedIdentity,
  normalizedPhone,
};
