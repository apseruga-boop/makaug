'use strict';

function cleanValue(value = '') {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'undefined' || raw.toLowerCase() === 'null') return '';
  return raw.replace(/\s+/g, ' ');
}

function normalizeWhatsAppRecipient(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('256') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `256${digits.slice(1)}`;
  return digits;
}

function listingCategory(listing = {}) {
  const raw = cleanValue(listing.listing_type || listing.type || listing.category).toLowerCase();
  if (raw.includes('rent')) return 'rent';
  if (raw.includes('student') || raw.includes('hostel')) return 'student';
  if (raw.includes('land')) return 'land';
  if (raw.includes('commercial')) return 'commercial';
  if (raw.includes('sale') || raw.includes('buy')) return 'sale';
  return raw || 'property';
}

function listingReference(listing = {}) {
  return cleanValue(listing.inquiry_reference || listing.reference || listing.listing_ref || listing.id || '');
}

function listingLocation(listing = {}) {
  return [
    listing.campus ? `near ${listing.campus}` : '',
    listing.area,
    listing.neighbourhood,
    listing.city,
    listing.district,
    listing.region
  ].map(cleanValue).filter(Boolean).filter((item, idx, arr) => arr.indexOf(item) === idx).join(', ');
}

function listingUrl(listing = {}, baseUrl = '') {
  const direct = cleanValue(listing.url || listing.public_url || listing.share_url);
  if (/^https?:\/\//i.test(direct)) return direct;
  const base = cleanValue(baseUrl || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
  const slug = cleanValue(listing.slug);
  if (slug) return `${base}/property/${encodeURIComponent(slug)}`;
  const id = cleanValue(listing.id);
  return id ? `${base}/?property=${encodeURIComponent(id)}` : base;
}

function priceText(listing = {}) {
  const value = cleanValue(listing.price_text || listing.formatted_price);
  if (value) return value;
  const price = cleanValue(listing.price);
  if (!price || price === '0') return '';
  const currency = cleanValue(listing.currency || 'USh');
  const period = cleanValue(listing.price_period || listing.period);
  return `${currency} ${price}${period ? `/${period}` : ''}`;
}

function buildListingWhatsappMessage(listing = {}, options = {}) {
  const title = cleanValue(listing.title) || 'this property';
  const category = listingCategory(listing);
  const location = listingLocation(listing) || 'the listed location';
  const ref = listingReference(listing);
  const url = listingUrl(listing, options.baseUrl);
  const price = priceText(listing);

  let message = '';
  if (category === 'rent') {
    message = `Hi, I'm contacting you about this rental property on MakaUg: ${title} in ${location}. Is it still available for rent?`;
  } else if (category === 'land') {
    message = `Hi, I'm contacting you about this land listing on MakaUg: ${title} in ${location}. Is it still available, and what is the title/tenure status?`;
  } else if (category === 'student') {
    message = `Hi, I'm contacting you about this student accommodation on MakaUg: ${title} near ${location}. Is it still available?`;
  } else if (category === 'commercial') {
    message = `Hi, I'm contacting you about this commercial property on MakaUg: ${title} in ${location}. Is it still available?`;
  } else {
    message = `Hi, I'm contacting you about this property for sale on MakaUg: ${title} in ${location}. Is it still available?`;
  }

  const parts = [message];
  if (price) parts.push(`Price: ${price}`);
  if (ref) parts.push(`Ref: ${ref}`);
  if (url) parts.push(url);
  return parts.filter(Boolean).join(' ');
}

function buildWhatsAppUrl(phone = '', message = '') {
  const recipient = normalizeWhatsAppRecipient(phone);
  if (!recipient) return '';
  return `https://wa.me/${recipient}?text=${encodeURIComponent(cleanValue(message))}`;
}

module.exports = {
  buildListingWhatsappMessage,
  buildWhatsAppUrl,
  cleanValue,
  listingCategory,
  listingLocation,
  listingReference,
  listingUrl,
  normalizeWhatsAppRecipient
};
