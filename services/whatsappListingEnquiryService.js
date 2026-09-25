'use strict';

/**
 * Someone asking about a listing they are looking at.
 *
 * Every property page has a WhatsApp button that writes the message for them:
 *
 *   Hi makaug, I'm viewing this listing on makaug.com: Property for rent in
 *   Lweza in Lweza, Wakiso, Central. Please help me confirm availability and
 *   the next safe step. Ref: MK-20260809-A7EA38 https://makaug.com/property/<id>
 *
 * That text contains the words "listing" and "for rent", so the listing-intent
 * check read it as someone wanting to *post* a property and answered "Got it -
 * I will help you list this to rent. Are you the owner of this property…". The
 * person was a renter asking whether a house was still free.
 *
 * The message is machine-written by our own site, so it can be recognised
 * exactly, and the listing it points at carries everything the answer needs:
 * where it came from, who posted it, and how to reach them.
 *
 * makaug never confirms availability on a lister's behalf. For a listing found
 * published online we did not take it in from anyone, so the only honest answer
 * is who posted it, where, and how to reach them there.
 */

const { tenantFor } = require('../packages/shared-country-core');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const ACTIVE_TENANT = tenantFor(ACTIVE_COUNTRY_CODE);

const LISTING_REFERENCE_PATTERN = /\b(MK-\d{8}-[A-Z0-9]{4,12})\b/i;
const PROPERTY_LINK_PATTERN = /(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]*\/property\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const VIEWING_PHRASE_PATTERN = /\b(?:i am|i'm|im)\s+(?:viewing|looking at|on)\s+this\s+listing\b/i;
const AVAILABILITY_PHRASE_PATTERN = /\b(?:confirm|check|is it still|still)\b[^.]{0,40}\b(?:availability|available|on the market|vacant|taken)\b/i;

function cleanText(value = '') {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function firstUrl(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item);
      if (url) return url;
    }
    return '';
  }
  const candidate = cleanText(value);
  if (!candidate || candidate.length > 2000) return '';
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
}

/**
 * What in this message says "I am asking about a listing", and which one.
 * Returns null when the message is not an enquiry about a specific listing, so
 * ordinary conversation is left alone.
 */
function parseListingEnquiry(input = '') {
  const text = cleanText(input);
  if (!text) return null;

  const linkMatch = text.match(PROPERTY_LINK_PATTERN);
  const referenceMatch = text.match(LISTING_REFERENCE_PATTERN);
  const propertyId = linkMatch ? linkMatch[1].toLowerCase() : '';
  const reference = referenceMatch ? referenceMatch[1].toUpperCase() : '';
  if (!propertyId && !reference) return null;

  // A property link or a listing reference is only ever sent by someone asking
  // about that listing — an owner starting a new listing has neither.
  return {
    propertyId,
    reference,
    viewingPhrase: VIEWING_PHRASE_PATTERN.test(text),
    asksAvailability: AVAILABILITY_PHRASE_PATTERN.test(text)
  };
}

function listingSourceFacts(property = {}) {
  const extra = property.extra_fields && typeof property.extra_fields === 'object' ? property.extra_fields : {};
  const foundOnline = extra.found_online === true
    || cleanText(extra.source_badge).toLowerCase() === 'found_online'
    || cleanText(property.listed_via).toLowerCase() === 'found_online'
    || /^found_online/i.test(cleanText(property.source));
  return {
    foundOnline,
    platform: cleanText(extra.source_platform || extra.source_contact_platform),
    posterName: cleanText(extra.source_name || extra.source_agent_name || extra.public_display_name || property.lister_name),
    contactUrl: firstUrl(extra.source_contact_url) || firstUrl(extra.source_channel_url) || firstUrl(extra.source_urls),
    postUrl: firstUrl(extra.source_url),
    sourceUnavailable: extra.source_unavailable === true,
    phone: cleanText(
      property.public_contact_phone
      || extra.public_contact_phone
      || property.contact_phone
      || extra.contact_phone
      || property.lister_phone
    )
  };
}

/** The same five steps whatever the listing is, because the risk is the same. */
function listingSafetySteps() {
  return [
    '1. View the property in person before you pay anything — no exceptions.',
    '2. Never send a deposit, "viewing fee" or booking money to hold a place you have not stood in.',
    '3. Ask to see the title, tenancy agreement or ownership papers, and check the name on them matches who you are talking to.',
    '4. Meet at the property in daylight and take someone with you.',
    `5. If anything feels wrong, stop and tell us — reply here and we will look into it. ${ACTIVE_TENANT.publicName || ACTIVE_TENANT.brandName} never collects deposits or payments for a listing.`
  ];
}

function buildListingEnquiryReply(property, {
  title = '',
  priceLabel = '',
  propertyUrl = '',
  reference = ''
} = {}) {
  const facts = listingSourceFacts(property);
  const location = [cleanText(property.area), cleanText(property.district)]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(', ') || ACTIVE_TENANT.countryName;
  const ref = cleanText(reference || property.inquiry_reference);

  const lines = [];
  lines.push(`🏡 *${cleanText(title) || 'This listing'}*`);
  lines.push(`📍 ${location}`);
  if (priceLabel) lines.push(`💰 ${priceLabel}`);
  if (ref) lines.push(`🔖 Ref: ${ref}`);
  if (propertyUrl) lines.push(`🔗 ${propertyUrl}`);
  lines.push('');

  if (facts.foundOnline) {
    // We did not take this listing in from anyone, so there is nobody here to
    // ask. Saying so plainly is the whole answer.
    lines.push('🔎 *We found this one published online* — it was not sent to us by the lister, so we cannot confirm whether it is still available, what the real price is, or who is holding it.');
    lines.push('');
    const postedBy = facts.posterName
      ? `It was posted by *${facts.posterName}*${facts.platform ? ` on ${facts.platform}` : ''}.`
      : `It was posted${facts.platform ? ` on ${facts.platform}` : ' online'} by the original advertiser.`;
    lines.push(postedBy);
    if (facts.phone) {
      lines.push(`📞 The number on the post: ${facts.phone}`);
    }
    if (facts.contactUrl) {
      lines.push(`👤 Their page: ${facts.contactUrl}`);
    }
    if (facts.postUrl && facts.postUrl !== facts.contactUrl) {
      lines.push(`📄 The original post: ${facts.postUrl}`);
    }
    if (!facts.phone && !facts.contactUrl && !facts.postUrl) {
      lines.push('We do not have a phone number or a page for them. Reply *FIND* and we will try to trace the original post for you.');
    } else {
      lines.push('Please contact them there to ask about availability and viewing.');
    }
  } else if (facts.phone) {
    lines.push('This one was listed with us. We cannot confirm availability on the lister\'s behalf — availability changes by the hour and only they know.');
    lines.push('');
    lines.push(`📞 Contact ${facts.posterName || 'the lister'} directly: ${facts.phone}`);
  } else {
    lines.push('This one was listed with us, but we do not have a contact number on file for it. We cannot confirm availability on the lister\'s behalf.');
    lines.push('');
    lines.push('Reply *FIND* and we will chase the lister and come back to you.');
  }

  lines.push('');
  lines.push('🛡️ *Before you pay anyone, anything:*');
  listingSafetySteps().forEach((step) => lines.push(step));
  lines.push('');
  lines.push('Want to see others like it? Reply *SEARCH* and tell me the area and budget.');

  return lines.join('\n');
}

function listingEnquiryNotFoundReply(reference = '') {
  const ref = cleanText(reference);
  return [
    'I could not find that listing — it may have been taken down since you opened it.',
    ref ? `Reference: ${ref}` : '',
    '',
    'Reply *SEARCH* with the area and budget you want and I will show you what is live now.'
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildListingEnquiryReply,
  listingEnquiryNotFoundReply,
  listingSafetySteps,
  listingSourceFacts,
  parseListingEnquiry,
  LISTING_REFERENCE_PATTERN,
  PROPERTY_LINK_PATTERN
};
