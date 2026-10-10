'use strict';

// C18 (10 Oct 2026): makaug no longer uses Google's paid Maps/Places APIs and
// the billing account is being closed. Every server-side Google Places call
// is refused unless GOOGLE_PLACES_ALLOWED=true is set on purpose (default off).
// Existing marketplace rows stay as they are and are shown without calling
// Google.
function googlePlacesAllowed() {
  return String(process.env.GOOGLE_PLACES_ALLOWED || '').trim().toLowerCase() === 'true';
}

function googlePlacesApiKey() {
  if (!googlePlacesAllowed()) return '';
  return String(process.env.GOOGLE_MAPS_API_KEY || process.env.PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
}

module.exports = { googlePlacesAllowed, googlePlacesApiKey };
