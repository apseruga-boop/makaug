const crypto = require('crypto');

const { sendSupportEmail, getSupportEmail, getSupportPhone } = require('./emailService');
const { normalizeUgPhoneForWhatsApp, sendWhatsAppText } = require('./whatsappNotificationService');

const REVIEW_CHECKS = [
  { key: 'required_listing_fields', label: 'Required listing fields complete' },
  { key: 'contact_details_verified', label: 'Phone/email details verified' },
  { key: 'identity_number_supplied', label: 'ID number supplied' },
  { key: 'identity_number_format', label: 'ID number format looks valid' },
  { key: 'identity_document_available', label: 'National ID photo preview available' },
  { key: 'identity_number_not_reused', label: 'ID number not reused by another contact', overrideable: true },
  { key: 'previous_lister_checked', label: 'Previous lister history checked', overrideable: true },
  { key: 'makaug_duplicate_checked', label: 'Not duplicated on makaug', overrideable: true },
  { key: 'image_count_checked', label: 'Required property photos present' },
  { key: 'image_quality_checked', label: 'Photo manifest and URLs look usable' },
  { key: 'location_verified', label: 'Location details and map pin present' },
  { key: 'pricing_checked', label: 'Price present for listing type' },
  { key: 'otp_verified', label: 'OTP verification completed' },
  { key: 'terms_accepted', label: 'Verification declarations accepted' },
  { key: 'external_duplicate_checked', label: 'External duplicate scan status', overrideable: true }
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
      || process.env.PUBLIC_BASE_URL
      || process.env.APP_BASE_URL
      || process.env.BASE_URL
      || 'https://makaug.com'
  ).replace(/\/+$/, '');
}

function getListingReference(listing = {}) {
  return listing.inquiry_reference || listing.reference || listing.id || '-';
}

function getPublicListingUrl(listing = {}) {
  return `${getSiteBaseUrl()}/property/${encodeURIComponent(listing.id || '')}`;
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
    `${listing.title || 'makaug property listing'}`,
    getPublicListingUrl(listing)
  ].filter(Boolean).join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function getSocialShareLinks(listing = {}) {
  const publicUrl = getPublicListingUrl(listing);
  const title = listing.title || 'makaug property listing';
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function listingLocationLabel(listing = {}) {
  return [listing.area, listing.district].map((item) => String(item || '').trim()).filter(Boolean).join(', ');
}

function formatUgandaDateTime(value) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-UG', {
    timeZone: 'Africa/Kampala',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).formatToParts(safeDate).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod || '').toUpperCase()}`.trim();
}

function formatListingPrice(listing = {}) {
  const rawPrice = Number(listing.price || 0);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 'Price on application';
  const currencyRaw = String(listing.currency || listing.price_currency || 'UGX').trim().toUpperCase();
  const currencyLabel = ['UGX', 'USH', 'UG SHS', 'UGANDA SHILLINGS'].includes(currencyRaw) ? 'USh' : (listing.currency || 'USh');
  const amount = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(rawPrice));
  const period = String(listing.price_period || '').trim();
  return `${currencyLabel} ${amount}${period && period !== 'once' ? `/${period}` : ''}`;
}

function emailWordmarkHtml() {
  return `
    <div style="font-size:28px;font-weight:900;letter-spacing:.2px;line-height:1;">
      <span style="color:#ffffff;">makaug</span><span style="color:#d9a441;">.com</span>
    </div>
    <div style="margin-top:7px;color:#cde7d0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Uganda Property</div>`;
}

function emailFooterHtml() {
  const supportEmail = getSupportEmail();
  const supportPhone = getSupportPhone();
  const whatsappUrl = `https://wa.me/${String(supportPhone).replace(/\D/g, '') || '256760112587'}`;
  return `
    <tr>
      <td style="background:#f8faf7;border-top:1px solid #e5efe2;padding:18px 28px;color:#6b7280;font-size:12px;line-height:1.6;">
        <div style="font-size:18px;font-weight:900;letter-spacing:.2px;line-height:1;margin-bottom:5px;"><span style="color:#0f3d2e;">makaug</span><span style="color:#d9a441;">.com</span></div>
        Uganda Property<br>
        WhatsApp <a href="${escapeHtml(whatsappUrl)}" style="color:#166534;font-weight:700;text-decoration:none;">${escapeHtml(supportPhone)}</a> &middot;
        <a href="mailto:${escapeHtml(supportEmail)}" style="color:#166534;font-weight:700;text-decoration:none;">${escapeHtml(supportEmail)}</a><br>
        You're receiving this because you submitted a listing on makaug.com.
      </td>
    </tr>`;
}

function emailShellHtml({ title, preheader, bodyHtml }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="display:none;max-height:0;overflow:hidden;color:#f4f7f2;">${escapeHtml(preheader || title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f2;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe7d7;box-shadow:0 12px 30px rgba(15,23,42,0.08);">
            <tr>
              <td style="background:#0f3d2e;padding:24px 28px;">
                ${emailWordmarkHtml()}
              </td>
            </tr>
            ${bodyHtml}
            ${emailFooterHtml()}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function emailButtonHtml(url, label, options = {}) {
  const bg = options.bg || '#166534';
  const color = options.color || '#ffffff';
  const border = options.border || bg;
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${bg};color:${color};border:1px solid ${border};text-decoration:none;border-radius:12px;padding:13px 16px;font-size:14px;font-weight:900;margin:4px 6px 4px 0;">${escapeHtml(label)}</a>`;
}

function buildListingSubmittedEmailHtml({ listing = {}, submittedAt, liveCount }) {
  const name = String(listing.lister_name || '').trim() || 'there';
  const title = listing.title || 'Your property listing';
  const reference = getListingReference(listing);
  const submittedLabel = formatUgandaDateTime(submittedAt || listing.created_at);
  const liveCountText = Number.isFinite(Number(liveCount)) && Number(liveCount) > 0
    ? `${new Intl.NumberFormat('en-UG').format(Number(liveCount))} live listings`
    : 'live listings';
  const browseUrl = `${getSiteBaseUrl()}/for-sale`;

  return emailShellHtml({
    title: "We've received your listing",
    preheader: `Your listing ${reference} is pending makaug review.`,
    bodyHtml: `
      <tr>
        <td style="padding:28px;">
          <div style="width:52px;height:52px;border-radius:999px;background:#dcfce7;color:#166534;text-align:center;line-height:52px;font-size:26px;font-weight:900;">&#10003;</div>
          <h1 style="margin:18px 0 12px;color:#111827;font-size:26px;line-height:1.22;font-weight:900;">We've received your listing</h1>
          <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.65;">Hi ${escapeHtml(name)}, thanks for listing with makaug. Your property is with our team for review - we'll email and WhatsApp you the moment it's live, with a link to share.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f4;border:1px solid #dbe7d7;border-radius:16px;margin:18px 0;border-collapse:separate;">
            <tr><td style="padding:16px;">
              <span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;margin-bottom:12px;">Pending review</span>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:120px;">Property</td><td style="padding:7px 0;color:#111827;font-size:14px;font-weight:800;">${escapeHtml(title)}</td></tr>
                <tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:120px;">Reference</td><td style="padding:7px 0;color:#111827;font-family:Consolas,Menlo,monospace;font-size:14px;font-weight:800;">${escapeHtml(reference)}</td></tr>
                <tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:120px;">Submitted</td><td style="padding:7px 0;color:#111827;font-size:14px;font-weight:800;">${escapeHtml(submittedLabel)}</td></tr>
              </table>
            </td></tr>
          </table>
          <h2 style="margin:22px 0 12px;color:#111827;font-size:18px;line-height:1.3;font-weight:900;">What happens next</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${[
              'We verify your details, photos, location, and ID.',
              'We message you if anything needs updating.',
              'Once approved, it goes live and we send your share link.'
            ].map((item, index) => `
              <tr>
                <td valign="top" style="padding:7px 0;width:34px;"><span style="display:inline-block;width:24px;height:24px;border-radius:999px;background:#166534;color:#ffffff;text-align:center;line-height:24px;font-size:12px;font-weight:900;">${index + 1}</span></td>
                <td style="padding:7px 0;color:#374151;font-size:14px;line-height:1.55;">${escapeHtml(item)}</td>
              </tr>`).join('')}
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f3d2e;border-radius:16px;margin-top:24px;border-collapse:separate;">
            <tr><td style="padding:18px;">
              <div style="color:#ffffff;font-size:16px;font-weight:900;line-height:1.4;">While you wait, explore makaug</div>
              <div style="margin-top:6px;color:#dff7e4;font-size:14px;line-height:1.55;">${escapeHtml(liveCountText)} across Uganda, updated daily.</div>
              <div style="margin-top:14px;">${emailButtonHtml(browseUrl, 'Browse listings', { bg: '#d9a441', color: '#111827', border: '#d9a441' })}</div>
            </td></tr>
          </table>
        </td>
      </tr>`
  });
}

function buildListingLiveEmailHtml({ listing = {} }) {
  const name = String(listing.lister_name || '').trim() || 'there';
  const title = listing.title || 'Your property listing';
  const publicUrl = getPublicListingUrl(listing);
  const shareLinks = getSocialShareLinks(listing);
  const location = listingLocationLabel(listing) || 'Uganda';
  const price = formatListingPrice(listing);
  const imageUrl = String(listing.primary_image_url || listing.image_url || '').trim();
  const imageBlock = /^https?:\/\//i.test(imageUrl)
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border-radius:14px 14px 0 0;border:0;">`
    : `<div style="height:190px;background:#ecfdf3;border-radius:14px 14px 0 0;text-align:center;color:#166534;font-size:18px;font-weight:900;line-height:190px;">makaug property</div>`;

  return emailShellHtml({
    title: 'Your listing is live',
    preheader: `${title} is now live on makaug.`,
    bodyHtml: `
      <tr>
        <td style="padding:28px;">
          <div style="width:52px;height:52px;border-radius:999px;background:#dcfce7;color:#166534;text-align:center;line-height:52px;font-size:24px;font-weight:900;">LIVE</div>
          <h1 style="margin:18px 0 12px;color:#111827;font-size:26px;line-height:1.22;font-weight:900;">Your listing is live</h1>
          <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.65;">Hi ${escapeHtml(name)}, your property is now live on makaug and visible to buyers across Uganda. Share it to reach even more people.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7d7;border-radius:16px;border-collapse:separate;overflow:hidden;">
            <tr><td>${imageBlock}</td></tr>
            <tr><td style="padding:16px;">
              <span style="display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;margin-bottom:10px;">Live</span>
              <div style="color:#111827;font-size:20px;line-height:1.3;font-weight:900;">${escapeHtml(title)}</div>
              <div style="margin-top:8px;color:#4b5563;font-size:14px;line-height:1.5;">Location: ${escapeHtml(location)}</div>
              <div style="margin-top:8px;color:#166534;font-size:17px;font-weight:900;">${escapeHtml(price)}</div>
              <div style="margin-top:8px;color:#6b7280;font-size:12px;line-height:1.4;word-break:break-all;">${escapeHtml(publicUrl)}</div>
            </td></tr>
          </table>
          <div style="margin-top:22px;">
            ${emailButtonHtml(shareLinks.whatsapp, 'Share on WhatsApp', { bg: '#16a34a', border: '#16a34a' })}
            ${emailButtonHtml(shareLinks.facebook, 'Share on Facebook', { bg: '#ffffff', color: '#166534', border: '#bbf7d0' })}
            ${emailButtonHtml(publicUrl, 'View listing', { bg: '#0f3d2e', border: '#0f3d2e' })}
          </div>
          <p style="margin:18px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">We'll let you know when people view or save your listing. Need a change? Just reply to this email.</p>
        </td>
      </tr>`
  });
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
  if (/^s3:\/\//i.test(url)) return true;
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
    blocking: blocking === true,
    overrideable: meta.overrideable === true
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
  const priceUponApplication = !!(extra.price_upon_application || /price\s+upon\s+application/i.test(String(extra.price_label || extra.source_price_label || '')));
  const hasPrice = String(listing.listing_type || '').toLowerCase() === 'student'
    ? (listing.price != null || priceUponApplication)
    : (Number(listing.price || 0) > 0 || priceUponApplication);
  const minRequiredImages = String(listing.listing_type || '').toLowerCase() === 'land' ? 3 : 5;
  const idDocumentUrl = listing.id_document_url || extra?.verify?.id_document_url || '';
  const idDocumentName = listing.id_document_name || extra?.verify?.id_document_name || '';
  const hasViewableIdDocument = isUsableMediaUrl(idDocumentUrl, { allowPdf: false }) && !/\.pdf$/i.test(idDocumentName);
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
      hasViewableIdDocument ? 'National ID photo can be opened for review.' : (idDocumentName ? 'National ID file is stored, but it is not a supported photo. Ask for a clear photo; PDFs are not accepted.' : 'National ID photo is missing.'),
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
      likelyDuplicates.length ? 'Possible duplicate listing found on makaug.' : 'No likely makaug duplicate found.',
      { count: likelyDuplicates.length, rows: likelyDuplicates.slice(0, 5) }
    ),
    checkResult(
      'image_count_checked',
      usableImageUrls.length >= minRequiredImages ? 'pass' : 'fail',
      usableImageUrls.length >= minRequiredImages ? `At least ${minRequiredImages} viewable property photos are attached.` : `Fewer than ${minRequiredImages} viewable property photos are attached.`,
      { image_count: images.length, usable_image_count: usableImageUrls.length, minimum_required: minRequiredImages }
    ),
    checkResult(
      'image_quality_checked',
      usableImageUrls.length >= minRequiredImages && uniqueUsableImageUrls.size === usableImageUrls.length && !reusedImages.length ? 'pass' : 'fail',
      reusedImages.length
        ? 'One or more image URLs are reused by another listing.'
        : (usableImageUrls.length >= minRequiredImages && uniqueUsableImageUrls.size === usableImageUrls.length ? 'Image URLs are present, viewable, and unique.' : 'Image URLs are missing, duplicated, or not viewable.'),
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
      hasPrice
        ? (priceUponApplication ? 'Price is marked as Price upon application.' : 'Price is present.')
        : 'Price is missing or zero.',
      { price: listing.price ?? null, listing_type: listing.listing_type || null, price_upon_application: priceUponApplication }
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

  const blockingFailures = checks.filter((item) => item.status === 'fail' && item.blocking && item.overrideable !== true);
  const warnings = checks.filter((item) => {
    const status = String(item.status || '').toLowerCase();
    return status === 'warning' || ((status === 'fail' || status === 'error') && item.overrideable === true);
  });
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
    const location = listingLocationLabel(listing) || 'Uganda';
    const price = formatListingPrice(listing);
    return {
      subject: `Your listing is live - ${title}`,
      text: [
        `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
        '',
        'Your property is now live on makaug and visible to buyers across Uganda.',
        `Reference: ${reference}`,
        `Property: ${title}`,
        `Location: ${location}`,
        `Price: ${price}`,
        `View listing: ${publicUrl}`,
        '',
        `WhatsApp: ${shareLinks.whatsapp}`,
        `Facebook: ${shareLinks.facebook}`,
        '',
        'We will let you know when people view or save your listing. Need a change? Just reply to this email.',
        `Need help? ${supportEmail}`
      ].join('\n'),
      html: buildListingLiveEmailHtml({ listing }),
      whatsapp: [
        `Great news ${listing?.lister_name || 'there'} - your listing is *live* on makaug \u{1F389}`,
        `${title} - ${location} - ${price}`,
        `View & share: ${publicUrl}`
      ].join('\n')
    };
  }

  if (String(status || '').toLowerCase() === 'rejected') {
    return {
      subject: `[makaug] Listing rejected • ${title}`,
      text: [
        `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
        '',
        'Thank you for submitting your makaug listing.',
        `Listing reference: ${reference}`,
        `Title: ${title}`,
        'The listing has been rejected during review.',
        reason ? `Reason: ${reason}` : 'Reason: It did not pass our current quality checks.',
        '',
        `Please resend the correct information or contact ${supportEmail} for help.`,
        'Thank you for using makaug.'
      ].filter(Boolean).join('\n'),
      whatsapp: [
        `makaug: your listing was rejected during review.`,
        `Ref: ${reference}`,
        `Title: ${title}`,
        reason ? `Reason: ${reason}` : 'Reason: It did not pass our current quality checks.',
        `Contact ${supportEmail} for help.`
      ].filter(Boolean).join('\n')
    };
  }

  return {
    subject: `[makaug] Listing ${label} • ${title}`,
    text: [
      `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
      '',
      `Your makaug listing status is now: ${label}.`,
      `Listing reference: ${reference}`,
      `Title: ${title}`,
      reason ? `Reason: ${reason}` : '',
      '',
      `If you need help, contact ${supportEmail}.`
    ].filter(Boolean).join('\n'),
    whatsapp: [
      `makaug listing update: ${label}`,
      `Ref: ${reference}`,
      `Title: ${title}`,
      reason ? `Reason: ${reason}` : ''
    ].filter(Boolean).join('\n')
  };
}

function buildOwnerSubmissionMessage({ listing = {}, token = '' }) {
  const reference = getListingReference(listing);
  const title = listing.title || 'Your property listing';
  const siteUrl = getSiteBaseUrl();
  const submittedAt = listing.submitted_at || listing.created_at || new Date();
  const submittedLabel = formatUgandaDateTime(submittedAt);

  return {
    subject: "We've received your makaug listing",
    text: [
      `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
      '',
      'Thanks for listing with makaug. Your property is with our team for review.',
      `Property: ${title}`,
      `Reference: ${reference}`,
      `Submitted: ${submittedLabel}`,
      '',
      'What happens next:',
      '1. We verify your details, photos, location, and ID.',
      '2. We message you if anything needs updating.',
      '3. Once approved, it goes live and we send your share link.',
      '',
      `Browse listings while you wait: ${siteUrl}/for-sale`
    ].join('\n'),
    html: buildListingSubmittedEmailHtml({ listing, submittedAt, liveCount: listing.live_count }),
    whatsapp: [
      `Hi ${listing?.lister_name || 'there'}, your makaug listing is *submitted* and under review.`,
      `Ref: ${reference}`,
      `Property: ${title}`,
      `We'll message you the moment it's live with a link to share. Browse makaug meanwhile: ${siteUrl}`
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
          text: message.text,
          html: message.html
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
          text: message.text,
          html: message.html
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
  buildOwnerSubmissionMessage,
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
