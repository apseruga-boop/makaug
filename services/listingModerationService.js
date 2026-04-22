const crypto = require('crypto');

const { sendSupportEmail, getSupportEmail } = require('./emailService');
const { sendWhatsAppText } = require('./whatsappNotificationService');

const REVIEW_CHECKS = [
  { key: 'previous_lister_checked', label: 'Previous lister history checked' },
  { key: 'makaug_duplicate_checked', label: 'Not duplicated on MakaUg' },
  { key: 'external_duplicate_checked', label: 'Not copied from another website' },
  { key: 'identity_number_matches_document', label: 'ID number matches document' },
  { key: 'id_image_clear', label: 'ID image is clear' },
  { key: 'image_quality_checked', label: 'Property images are clear and relevant' },
  { key: 'ownership_or_authority_checked', label: 'Owner or broker authority checked' },
  { key: 'contact_details_verified', label: 'Phone/email details verified' },
  { key: 'location_verified', label: 'Location details verified' },
  { key: 'pricing_checked', label: 'Price looks plausible for area/type' }
];

const REQUIRED_REVIEW_CHECK_KEYS = REVIEW_CHECKS.map((item) => item.key);

function createOwnerEditToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashOwnerEditToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token || ''), 'utf8')
    .digest('hex');
}

function isOwnerEditTokenValid(token, hash) {
  const tokenHash = hashOwnerEditToken(token);
  const expected = Buffer.from(String(hash || ''), 'hex');
  const actual = Buffer.from(tokenHash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function ownerEditTokenExpiry() {
  const days = Math.max(parseInt(process.env.LISTING_OWNER_EDIT_TOKEN_DAYS || '30', 10), 1);
  return new Date(Date.now() + (days * 24 * 60 * 60 * 1000));
}

function getSiteBaseUrl() {
  return String(
    process.env.PUBLIC_SITE_URL
      || process.env.APP_BASE_URL
      || process.env.BASE_URL
      || 'https://makaug.com'
  ).replace(/\/+$/, '');
}

function getListingReference(listing = {}) {
  return listing.inquiry_reference || listing.reference || listing.id || '-';
}

function getPublicListingUrl(listing = {}) {
  return `${getSiteBaseUrl()}/?property=${encodeURIComponent(listing.id || '')}`;
}

function getOwnerPreviewUrl(listing = {}, token = '') {
  const params = new URLSearchParams({
    listing: String(listing.id || ''),
    token: String(token || '')
  });
  return `${getSiteBaseUrl()}/?listing_preview=1&${params.toString()}`;
}

function getWhatsAppShareUrl(listing = {}) {
  const text = [
    `${listing.title || 'MakaUg property listing'}`,
    getPublicListingUrl(listing)
  ].filter(Boolean).join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function normalizeReviewChecklist(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const normalized = {};
  REVIEW_CHECKS.forEach((item) => {
    normalized[item.key] = source[item.key] === true;
  });
  return normalized;
}

function getMissingApprovalChecks(checklist = {}) {
  const normalized = normalizeReviewChecklist(checklist);
  return REQUIRED_REVIEW_CHECK_KEYS
    .filter((key) => normalized[key] !== true)
    .map((key) => REVIEW_CHECKS.find((item) => item.key === key)?.label || key);
}

function statusLabel(status) {
  const safeStatus = String(status || '').toLowerCase();
  if (safeStatus === 'approved') return 'Approved';
  if (safeStatus === 'rejected') return 'Rejected';
  if (safeStatus === 'hidden') return 'Hidden';
  if (safeStatus === 'deleted') return 'Removed';
  if (safeStatus === 'pending') return 'Pending Review';
  return 'Updated';
}

function buildOwnerStatusMessage({ listing = {}, status, reason }) {
  const reference = getListingReference(listing);
  const label = statusLabel(status);
  const title = listing.title || 'Your property listing';
  const supportEmail = getSupportEmail();

  if (String(status || '').toLowerCase() === 'approved') {
    const publicUrl = getPublicListingUrl(listing);
    return {
      subject: `[MakaUg] Listing approved • ${title}`,
      text: [
        `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
        '',
        'Good news, your MakaUg property listing is now approved and live.',
        `Listing reference: ${reference}`,
        `Title: ${title}`,
        `Live link: ${publicUrl}`,
        '',
        'Share links:',
        `WhatsApp: ${getWhatsAppShareUrl(listing)}`,
        `Instagram/link-in-bio: ${publicUrl}`,
        '',
        `If you need help, contact ${supportEmail}.`,
        'Thank you for using MakaUg.'
      ].join('\n'),
      whatsapp: [
        `MakaUg: your listing is approved and live.`,
        `Ref: ${reference}`,
        `Title: ${title}`,
        `View/share: ${publicUrl}`,
        `WhatsApp share: ${getWhatsAppShareUrl(listing)}`
      ].join('\n')
    };
  }

  if (String(status || '').toLowerCase() === 'rejected') {
    const previewUrl = listing.owner_edit_token ? getOwnerPreviewUrl(listing, listing.owner_edit_token) : '';
    return {
      subject: `[MakaUg] Listing rejected • ${title}`,
      text: [
        `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
        '',
        'Thank you for submitting your MakaUg listing.',
        `Listing reference: ${reference}`,
        `Title: ${title}`,
        'The listing has been rejected during review.',
        reason ? `Reason: ${reason}` : 'Reason: It did not pass our current quality checks.',
        previewUrl ? `Preview/edit link: ${previewUrl}` : '',
        '',
        `Please resend the correct information or contact ${supportEmail} for help.`,
        'Thank you for using MakaUg.'
      ].filter(Boolean).join('\n'),
      whatsapp: [
        `MakaUg: your listing was rejected during review.`,
        `Ref: ${reference}`,
        `Title: ${title}`,
        reason ? `Reason: ${reason}` : 'Reason: It did not pass our current quality checks.',
        previewUrl ? `Preview/edit: ${previewUrl}` : `Contact ${supportEmail} for help.`
      ].filter(Boolean).join('\n')
    };
  }

  return {
    subject: `[MakaUg] Listing ${label} • ${title}`,
    text: [
      `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
      '',
      `Your MakaUg listing status is now: ${label}.`,
      `Listing reference: ${reference}`,
      `Title: ${title}`,
      reason ? `Reason: ${reason}` : '',
      '',
      `If you need help, contact ${supportEmail}.`
    ].filter(Boolean).join('\n'),
    whatsapp: [
      `MakaUg listing update: ${label}`,
      `Ref: ${reference}`,
      `Title: ${title}`,
      reason ? `Reason: ${reason}` : ''
    ].filter(Boolean).join('\n')
  };
}

function buildOwnerSubmissionMessage({ listing = {}, token = '' }) {
  const reference = getListingReference(listing);
  const title = listing.title || 'Your property listing';
  const previewUrl = getOwnerPreviewUrl(listing, token);
  const supportEmail = getSupportEmail();

  return {
    subject: `[MakaUg] Listing received for review • ${title}`,
    text: [
      `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
      '',
      'We received your MakaUg property listing and it is now pending review.',
      `Listing reference: ${reference}`,
      `Title: ${title}`,
      '',
      `Preview/edit link: ${previewUrl}`,
      'You can use this private link to review the listing and update wording while it is pending.',
      '',
      `If you need help, contact ${supportEmail}.`,
      'Thank you for using MakaUg.'
    ].join('\n'),
    whatsapp: [
      'MakaUg: your listing is pending review.',
      `Ref: ${reference}`,
      `Title: ${title}`,
      `Preview/edit: ${previewUrl}`
    ].join('\n')
  };
}

async function sendOwnerListingStatusNotifications({ listing = {}, status, reason }) {
  const message = buildOwnerStatusMessage({ listing, status, reason });
  const result = {
    email: { sent: false, reason: 'no_lister_email' },
    whatsapp: { sent: false, reason: 'no_lister_phone' }
  };

  if (listing.lister_email) {
    result.email = await sendSupportEmail({
      to: listing.lister_email,
      subject: message.subject,
      text: message.text
    });
  }

  if (listing.lister_phone) {
    result.whatsapp = await sendWhatsAppText({
      to: listing.lister_phone,
      body: message.whatsapp
    });
  }

  return result;
}

async function sendOwnerListingSubmissionNotifications({ listing = {}, token = '' }) {
  const message = buildOwnerSubmissionMessage({ listing, token });
  const result = {
    email: { sent: false, reason: 'no_lister_email' },
    whatsapp: { sent: false, reason: 'no_lister_phone' }
  };

  if (listing.lister_email) {
    result.email = await sendSupportEmail({
      to: listing.lister_email,
      subject: message.subject,
      text: message.text
    });
  }

  if (listing.lister_phone) {
    result.whatsapp = await sendWhatsAppText({
      to: listing.lister_phone,
      body: message.whatsapp
    });
  }

  return result;
}

module.exports = {
  REVIEW_CHECKS,
  REQUIRED_REVIEW_CHECK_KEYS,
  buildOwnerStatusMessage,
  createOwnerEditToken,
  getMissingApprovalChecks,
  getOwnerPreviewUrl,
  getPublicListingUrl,
  hashOwnerEditToken,
  isOwnerEditTokenValid,
  normalizeReviewChecklist,
  ownerEditTokenExpiry,
  sendOwnerListingStatusNotifications,
  sendOwnerListingSubmissionNotifications
};
