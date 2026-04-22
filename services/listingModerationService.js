const crypto = require('crypto');

const { sendSupportEmail, getSupportEmail } = require('./emailService');
const { normalizeUgPhoneForWhatsApp, sendWhatsAppText } = require('./whatsappNotificationService');

const REVIEW_CHECKS = [
  { key: 'required_listing_fields', label: 'Required listing fields complete' },
  { key: 'contact_details_verified', label: 'Phone/email details verified' },
  { key: 'identity_number_supplied', label: 'ID number supplied' },
  { key: 'identity_number_format', label: 'ID number format looks valid' },
  { key: 'identity_document_available', label: 'ID document preview available' },
  { key: 'identity_number_not_reused', label: 'ID number not reused by another contact' },
  { key: 'previous_lister_checked', label: 'Previous lister history checked' },
  { key: 'makaug_duplicate_checked', label: 'Not duplicated on MakaUg' },
  { key: 'image_count_checked', label: 'Required property photos present' },
  { key: 'image_quality_checked', label: 'Photo manifest and URLs look usable' },
  { key: 'location_verified', label: 'Location details and map pin present' },
  { key: 'pricing_checked', label: 'Price present for listing type' },
  { key: 'otp_verified', label: 'OTP verification completed' },
  { key: 'terms_accepted', label: 'Verification declarations accepted' },
  { key: 'external_duplicate_checked', label: 'External duplicate scan status' }
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

function getSocialShareLinks(listing = {}) {
  const publicUrl = getPublicListingUrl(listing);
  const title = listing.title || 'MakaUg property listing';
  const text = `${title}\n${publicUrl}`;
  return {
    live: publicUrl,
    whatsapp: getWhatsAppShareUrl(listing),
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(publicUrl)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(publicUrl)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(publicUrl)}`,
    youtube_caption: text
  };
}

function getDirectWhatsAppUrl(phone, message) {
  const normalized = normalizeUgPhoneForWhatsApp(phone);
  if (!normalized) return '';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(String(message || '').trim())}`;
}

function isValidUgNinFormat(value) {
  return /^(CM|CF|PM|PF)[A-Z0-9]{12}$/.test(String(value || '').trim().toUpperCase());
}

function isUsableMediaUrl(value, { allowPdf = false } = {}) {
  const url = String(value || '').trim();
  if (!url || url === '[object Object]') return false;
  if (/^https?:\/\//i.test(url)) return true;
  if (/^data:image\//i.test(url)) return true;
  if (allowPdf && /^data:application\/pdf/i.test(url)) return true;
  return false;
}

function boolFromExtra(extraFields = {}, key) {
  if (extraFields?.[key] === true) return true;
  if (extraFields?.verify?.[key] === true) return true;
  return false;
}

function checkResult(key, status, message, evidence = {}, blocking = status === 'fail') {
  const meta = REVIEW_CHECKS.find((item) => item.key === key) || { key, label: key };
  return {
    key,
    label: meta.label,
    status,
    message,
    evidence,
    blocking: blocking === true
  };
}

function normalizeExternalDuplicateScan(scan = {}) {
  const source = scan && typeof scan === 'object' ? scan : {};
  if (!Object.keys(source).length) {
    return {
      status: 'pass',
      blocking: false,
      message: 'External duplicate search is deferred; internal duplicate and reused-image checks completed.',
      evidence: {
        provider: 'deferred',
        cached: false,
        checked_at: null,
        query: null,
        search_url: null,
        result_count: 0,
        high_confidence_count: 0,
        possible_match_count: 0,
        matches: []
      }
    };
  }
  let status = ['pass', 'warning', 'fail'].includes(String(source.status || '').toLowerCase())
    ? String(source.status).toLowerCase()
    : 'warning';
  const provider = source.provider || 'not_run';
  const nonBlockingProvider = ['not_configured', 'disabled', 'search_timeout', 'search_error', 'missing_listing_data', 'deferred', 'not_run'].includes(String(provider).toLowerCase());
  if (status === 'warning' && source.blocking !== true && nonBlockingProvider) {
    status = 'pass';
  }
  const matches = Array.isArray(source.matches) ? source.matches.slice(0, 8) : [];
  return {
    status,
    blocking: source.blocking === true,
    message: nonBlockingProvider && !matches.length
      ? 'External duplicate search is deferred; internal duplicate and reused-image checks completed.'
      : (source.message || (status === 'pass'
        ? 'External duplicate scan completed; no strong external duplicates found.'
        : 'External duplicate scan needs review.')),
    evidence: {
      provider,
      cached: source.cached === true,
      checked_at: source.checked_at || null,
      query: source.query || null,
      search_url: source.search_url || null,
      result_count: source.result_count ?? matches.length,
      high_confidence_count: source.high_confidence_count || 0,
      possible_match_count: source.possible_match_count || 0,
      matches
    }
  };
}

function buildAutomatedListingReview({
  listing = {},
  images = [],
  previousListerListings = [],
  likelyDuplicates = [],
  reusedImages = [],
  idNumberMatches = [],
  matchingUsers = [],
  externalDuplicateScan = null
} = {}) {
  const extra = listing.extra_fields && typeof listing.extra_fields === 'object' ? listing.extra_fields : {};
  const imageUrls = images.map((item) => String(item?.url || '').trim()).filter(Boolean);
  const usableImageUrls = imageUrls.filter((url) => isUsableMediaUrl(url));
  const uniqueUsableImageUrls = new Set(usableImageUrls);
  const photoManifest = Array.isArray(extra.photo_manifest) ? extra.photo_manifest : [];
  const assignments = extra.photo_assignments && typeof extra.photo_assignments === 'object' ? Object.values(extra.photo_assignments).filter(Boolean) : [];
  const idNumber = String(listing.id_number || '').trim().toUpperCase();
  const otherIdContacts = idNumberMatches.filter((row) => {
    const samePhone = row.lister_phone && listing.lister_phone && row.lister_phone === listing.lister_phone;
    const sameEmail = row.lister_email && listing.lister_email && String(row.lister_email).toLowerCase() === String(listing.lister_email).toLowerCase();
    return !samePhone && !sameEmail;
  });
  const hasMapPin = (listing.latitude != null && listing.longitude != null) || !!extra.map_pin_confirmed || !!extra.coordinates;
  const hasContact = !!listing.lister_phone && !!listing.lister_email;
  const hasRequiredCore = !!(listing.title && listing.description && listing.district && listing.area && listing.listing_type);
  const hasPrice = String(listing.listing_type || '').toLowerCase() === 'student'
    ? listing.price != null
    : Number(listing.price || 0) > 0;
  const idDocumentUrl = listing.id_document_url || extra?.verify?.id_document_url || '';
  const hasViewableIdDocument = isUsableMediaUrl(idDocumentUrl, { allowPdf: true });
  const idDocumentName = listing.id_document_name || extra?.verify?.id_document_name || '';
  const externalScan = normalizeExternalDuplicateScan(externalDuplicateScan);

  const checks = [
    checkResult(
      'required_listing_fields',
      hasRequiredCore ? 'pass' : 'fail',
      hasRequiredCore ? 'Title, description, location, and listing type are present.' : 'One or more required listing fields are missing.',
      { title: !!listing.title, description: !!listing.description, district: !!listing.district, area: !!listing.area, listing_type: !!listing.listing_type }
    ),
    checkResult(
      'contact_details_verified',
      hasContact ? 'pass' : 'fail',
      hasContact ? 'Phone and email are present.' : 'Phone and email are both required for owner notifications.',
      { phone: listing.lister_phone || null, email: listing.lister_email || null, matching_users: matchingUsers.length }
    ),
    checkResult(
      'identity_number_supplied',
      idNumber ? 'pass' : 'fail',
      idNumber ? 'ID number was supplied.' : 'ID number is missing.',
      { id_number_present: !!idNumber }
    ),
    checkResult(
      'identity_number_format',
      idNumber && isValidUgNinFormat(idNumber) ? 'pass' : 'fail',
      idNumber && isValidUgNinFormat(idNumber) ? 'ID number matches Uganda NIN-style format.' : 'ID number does not match expected Uganda NIN-style format.',
      { expected: 'Two letters followed by 12 letters/numbers', value: idNumber || null }
    ),
    checkResult(
      'identity_document_available',
      hasViewableIdDocument ? 'pass' : 'fail',
      hasViewableIdDocument ? 'ID document can be opened for review.' : (idDocumentName ? 'ID document name is stored, but the document itself is not viewable.' : 'ID document is missing.'),
      { id_document_name: idDocumentName || null, id_document_url_present: !!idDocumentUrl, id_document_viewable: hasViewableIdDocument }
    ),
    checkResult(
      'identity_number_not_reused',
      otherIdContacts.length ? 'fail' : (idNumberMatches.length ? 'warning' : 'pass'),
      otherIdContacts.length
        ? 'This ID number has been used by another phone/email.'
        : (idNumberMatches.length ? 'This ID number appeared before with the same contact.' : 'No previous reuse of this ID number found.'),
      { matches: idNumberMatches.length, other_contact_matches: otherIdContacts.length, rows: idNumberMatches.slice(0, 5) }
    ),
    checkResult(
      'previous_lister_checked',
      previousListerListings.length ? 'warning' : 'pass',
      previousListerListings.length ? 'This lister has previous listings in the database.' : 'No previous listings found for this lister.',
      { count: previousListerListings.length, rows: previousListerListings.slice(0, 5) },
      false
    ),
    checkResult(
      'makaug_duplicate_checked',
      likelyDuplicates.length ? 'fail' : 'pass',
      likelyDuplicates.length ? 'Possible duplicate listing found on MakaUg.' : 'No likely MakaUg duplicate found.',
      { count: likelyDuplicates.length, rows: likelyDuplicates.slice(0, 5) }
    ),
    checkResult(
      'image_count_checked',
      usableImageUrls.length >= 5 ? 'pass' : 'fail',
      usableImageUrls.length >= 5 ? 'At least five viewable property photos are attached.' : 'Fewer than five viewable property photos are attached.',
      { image_count: images.length, usable_image_count: usableImageUrls.length }
    ),
    checkResult(
      'image_quality_checked',
      usableImageUrls.length >= 5 && uniqueUsableImageUrls.size === usableImageUrls.length && !reusedImages.length ? 'pass' : 'fail',
      reusedImages.length
        ? 'One or more image URLs are reused by another listing.'
        : (usableImageUrls.length >= 5 && uniqueUsableImageUrls.size === usableImageUrls.length ? 'Image URLs are present, viewable, and unique.' : 'Image URLs are missing, duplicated, or not viewable.'),
      {
        image_url_count: imageUrls.length,
        usable_image_url_count: usableImageUrls.length,
        unique_image_url_count: uniqueUsableImageUrls.size,
        invalid_image_url_count: Math.max(imageUrls.length - usableImageUrls.length, 0),
        reused_images: reusedImages.length,
        assigned_photo_slots: assignments.length || photoManifest.filter((item) => item.slot).length
      }
    ),
    checkResult(
      'location_verified',
      hasMapPin ? 'pass' : 'fail',
      hasMapPin ? 'Location details and coordinates/map confirmation are present.' : 'Map pin or coordinates are missing.',
      { latitude: listing.latitude ?? null, longitude: listing.longitude ?? null, map_pin_confirmed: !!extra.map_pin_confirmed }
    ),
    checkResult(
      'pricing_checked',
      hasPrice ? 'pass' : 'fail',
      hasPrice ? 'Price is present.' : 'Price is missing or zero.',
      { price: listing.price ?? null, listing_type: listing.listing_type || null }
    ),
    checkResult(
      'otp_verified',
      listing.listed_via === 'website' ? 'pass' : 'warning',
      listing.listed_via === 'website' ? 'Website OTP token was required at submission.' : 'Listing was not submitted through the website OTP flow.',
      { listed_via: listing.listed_via || null },
      false
    ),
    checkResult(
      'terms_accepted',
      listing.verification_terms_accepted === true && boolFromExtra(extra, 'nin_match_confirmed') ? 'pass' : 'fail',
      listing.verification_terms_accepted === true && boolFromExtra(extra, 'nin_match_confirmed')
        ? 'Verification terms and ID-match declaration were accepted.'
        : 'Verification terms or ID-match declaration are missing.',
      { verification_terms_accepted: listing.verification_terms_accepted === true, nin_match_confirmed: boolFromExtra(extra, 'nin_match_confirmed') }
    ),
    checkResult(
      'external_duplicate_checked',
      externalScan.status,
      externalScan.message,
      externalScan.evidence,
      externalScan.blocking
    )
  ];

  const blockingFailures = checks.filter((item) => item.status === 'fail' && item.blocking);
  const warnings = checks.filter((item) => item.status === 'warning');
  const checklist = {};
  checks.forEach((item) => {
    checklist[item.key] = item.status !== 'fail';
  });

  return {
    status: blockingFailures.length ? 'fail' : (warnings.length ? 'warning' : 'pass'),
    can_approve: blockingFailures.length === 0,
    checks,
    checklist,
    blocking_failures: blockingFailures,
    warnings
  };
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
    const shareLinks = getSocialShareLinks(listing);
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
        `WhatsApp: ${shareLinks.whatsapp}`,
        `Facebook: ${shareLinks.facebook}`,
        `X/Twitter: ${shareLinks.x}`,
        `LinkedIn: ${shareLinks.linkedin}`,
        `Instagram/link-in-bio: ${publicUrl}`,
        `YouTube description/caption: ${shareLinks.youtube_caption}`,
        '',
        `If you need help, contact ${supportEmail}.`,
        'Thank you for using MakaUg.'
      ].join('\n'),
      whatsapp: [
        `MakaUg: your listing is approved and live.`,
        `Ref: ${reference}`,
        `Title: ${title}`,
        `View/share: ${publicUrl}`,
        `WhatsApp share: ${shareLinks.whatsapp}`,
        `Facebook: ${shareLinks.facebook}`,
        `Instagram/YouTube caption: ${shareLinks.youtube_caption}`
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
    email: { sent: false, reason: 'no_lister_email', subject: message.subject, message: message.text },
    whatsapp: { sent: false, reason: 'no_lister_phone', phone: listing.lister_phone || null, message: message.whatsapp }
  };

  if (listing.lister_email) {
    try {
      result.email = {
        ...await sendSupportEmail({
          to: listing.lister_email,
          subject: message.subject,
          text: message.text
        }),
        subject: message.subject,
        message: message.text
      };
    } catch (error) {
      result.email = {
        sent: false,
        reason: 'email_send_failed',
        error: error.message || 'send_failed',
        subject: message.subject,
        message: message.text
      };
    }
  }

  if (listing.lister_phone) {
    const manualUrl = getDirectWhatsAppUrl(listing.lister_phone, message.whatsapp);
    try {
      result.whatsapp = await sendWhatsAppText({
        to: listing.lister_phone,
        body: message.whatsapp
      });
    } catch (error) {
      result.whatsapp = {
        sent: false,
        reason: 'whatsapp_send_failed',
        error: error.message || 'send_failed'
      };
    }
    result.whatsapp.manual_url = manualUrl;
    result.whatsapp.phone = listing.lister_phone;
    result.whatsapp.message = message.whatsapp;
  }

  return result;
}

async function sendOwnerListingSubmissionNotifications({ listing = {}, token = '' }) {
  const message = buildOwnerSubmissionMessage({ listing, token });
  const result = {
    email: { sent: false, reason: 'no_lister_email', subject: message.subject, message: message.text },
    whatsapp: { sent: false, reason: 'no_lister_phone', phone: listing.lister_phone || null, message: message.whatsapp }
  };

  if (listing.lister_email) {
    try {
      result.email = {
        ...await sendSupportEmail({
          to: listing.lister_email,
          subject: message.subject,
          text: message.text
        }),
        subject: message.subject,
        message: message.text
      };
    } catch (error) {
      result.email = {
        sent: false,
        reason: 'email_send_failed',
        error: error.message || 'send_failed',
        subject: message.subject,
        message: message.text
      };
    }
  }

  if (listing.lister_phone) {
    const manualUrl = getDirectWhatsAppUrl(listing.lister_phone, message.whatsapp);
    try {
      result.whatsapp = await sendWhatsAppText({
        to: listing.lister_phone,
        body: message.whatsapp
      });
    } catch (error) {
      result.whatsapp = {
        sent: false,
        reason: 'whatsapp_send_failed',
        error: error.message || 'send_failed'
      };
    }
    result.whatsapp.manual_url = manualUrl;
    result.whatsapp.phone = listing.lister_phone;
    result.whatsapp.message = message.whatsapp;
  }

  return result;
}

module.exports = {
  REVIEW_CHECKS,
  REQUIRED_REVIEW_CHECK_KEYS,
  buildOwnerStatusMessage,
  buildAutomatedListingReview,
  createOwnerEditToken,
  getDirectWhatsAppUrl,
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
