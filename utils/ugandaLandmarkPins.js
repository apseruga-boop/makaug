'use strict';

/**
 * Landmarks that settle which district an ambiguous place name is in.
 *
 * Some Uganda place names are genuinely in more than one district. Nakasajja is
 * in Wakiso (on Gayaza Road) and also in Kyampisi, Mukono; Gobero, Busika and
 * Lugogo are the same story. Asked on its own, "which district is Nakasajja in"
 * is a fair question — but agents rarely write the name on its own. They place
 * it with something everybody local knows:
 *
 *   "Nakasajja 11 decimals plot near Orevine international school"
 *
 * The school settles it. This file is that knowledge, written down.
 *
 * Safety rule, and the reason this cannot send a listing to the wrong district:
 * a pin may only CHOOSE BETWEEN districts the location registry already offered
 * as candidates for the name in the caption. It can never introduce a district
 * of its own. If a pin names a district that is not on the shortlist, it is
 * ignored. The worst a wrong entry here can do is leave the question being
 * asked, which is exactly what happens today.
 *
 * Adding an entry: only from a verified source (the institution's own site, or
 * its district listing). Put the verification in the comment, so the next person
 * does not have to redo it. Spellings should include how agents actually type
 * it, misspellings and all — the caption above says "Orevine", the school spells
 * itself "Orel-Vine".
 */

const LANDMARK_PINS = [
  {
    // orelvine.com lists its Primary and Secondary campuses at "Nakasajja,
    // Gayaza Road" (the Pre-School is in Najjera). Gayaza Road and Gayaza are
    // Wakiso, which settles the Nakasajja on that road as the Wakiso one.
    // Agents write it "Orevine" at least as often as "Orel-Vine".
    label: 'Orel-Vine International Academy, Nakasajja',
    district: 'Wakiso',
    aliases: [
      'orel vine',
      'orel-vine',
      'orelvine',
      'orevine',
      'ore vine',
      'orelvine international',
      'orevine international'
    ]
  }
];

/** Letters and digits only, so spacing and punctuation stop mattering. */
function flatten(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Districts pinned by landmarks named in the text.
 *
 * Returns a de-duplicated array of district names. An empty array means no
 * landmark we know about was named — the ordinary question still gets asked.
 * More than one district means the text named landmarks that disagree, which is
 * not something to guess at, so callers should treat that as no answer too.
 */
function landmarkDistrictsInText(text = '') {
  const haystack = flatten(text);
  if (!haystack) return [];
  const districts = new Set();
  for (const pin of LANDMARK_PINS) {
    const hit = pin.aliases.some((alias) => {
      const needle = flatten(alias);
      return needle.length >= 5 && haystack.includes(needle);
    });
    if (hit && pin.district) districts.add(pin.district);
  }
  return [...districts];
}

module.exports = { LANDMARK_PINS, landmarkDistrictsInText };
