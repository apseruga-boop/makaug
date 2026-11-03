'use strict';

/**
 * Curated, editable list of Uganda property hashtags and search terms used by
 * the Uganda source rotation (step 2 of the 30,000-listing plan).
 *
 * - `hashtags` are fetched as public TikTok tag pages (no login) and as
 *   YouTube searches.
 * - `searchTerms` (English and Luganda) are YouTube API v3 searches only;
 *   TikTok has no free public search endpoint.
 * - Every place in `places` is combined with every word in `placeKinds`
 *   ("Ntinda land for sale", "Mukono house for sale", "Kira rent"...).
 *
 * Add or remove entries here; new entries join the rotation on the next run.
 */

const hashtags = Object.freeze([
  'ugandarealestate',
  'landforsaleinuganda',
  'housesforsaleinkampala',
  'kampalarentals',
  'kampalarealestate',
  'landforsaleinkampala',
  'housesforsaleinuganda',
  'housesforrentinkampala',
  'houseforrentkampala',
  'ugandaproperty',
  'ugandahomes',
  'kampalahomes',
  'plotsforsaleuganda',
  'landforsalemukono',
  'landforsalewakiso',
  'entebbeproperty',
  'ugandarentals',
  'apartmentsinkampala',
  'kampalaapartments',
  'propertyuganda',
  'ettakaliguzibwa',
  'ennyumbaeguzibwa',
  'ennyumbazapangisa',
]);

const searchTerms = Object.freeze([
  'land for sale in Uganda',
  'house for sale in Kampala',
  'house for rent in Kampala',
  'apartment for rent Kampala',
  'plots for sale Wakiso',
  'commercial property for sale Kampala',
  'rental units for sale Uganda',
  'land with title for sale Uganda',
  // Luganda
  'ettaka eritundibwa',
  'ettaka litundibwa Wakiso',
  'ennyumba etundibwa Kampala',
  'ennyumba ezipangisibwa Kampala',
  'amayumba agapangisibwa',
  'poloti etundibwa',
]);

const places = Object.freeze([
  'Kampala', 'Wakiso', 'Mukono', 'Entebbe', 'Kira', 'Nansana', 'Namugongo',
  'Ntinda', 'Kyanja', 'Najjera', 'Kisaasi', 'Bukoto', 'Muyenga', 'Munyonyo',
  'Kansanga', 'Kololo', 'Naguru', 'Bweyogerere', 'Seeta', 'Gayaza', 'Matugga',
  'Kasangati', 'Buloba', 'Kajjansi', 'Garuga', 'Lubowa', 'Mpigi', 'Mityana',
  'Jinja', 'Mbarara', 'Gulu', 'Masaka', 'Mbale', 'Fort Portal', 'Hoima',
  'Lira', 'Arua', 'Luweero', 'Busiika', 'Buikwe', 'Lugazi', 'Kayunga',
]);

const placeKinds = Object.freeze(['land for sale', 'house for sale', 'rent']);

module.exports = { hashtags, searchTerms, places, placeKinds };
