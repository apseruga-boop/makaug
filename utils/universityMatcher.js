const { UNIVERSITIES } = require('./constants');

const UNIVERSITY_ALIAS_GROUPS = [
  { name: 'Makerere University', aliases: ['makerere', 'makerere university', 'muk', 'kikoni', 'wandegeya', 'mulago'] },
  { name: 'Makerere University Business School (MUBS)', aliases: ['mubs', 'makerere university business school', 'nakawa campus', 'nakawa'] },
  { name: 'Kyambogo University', aliases: ['kyambogo', 'kyambogo university', 'banda', 'ntinda'] },
  { name: 'Uganda Christian University (UCU)', aliases: ['ucu', 'uganda christian university', 'bishop tucker', 'mukono campus', 'mukono town', 'mukono'] },
  { name: 'Kampala International University (KIU)', aliases: ['kiu', 'kampala international university', 'kansanga', 'kabalagala'] },
  { name: 'Nkumba University', aliases: ['nkumba', 'nkumba university', 'entebbe'] },
  { name: 'Ndejje University', aliases: ['ndejje', 'ndejje university'] },
  { name: 'Uganda Martyrs University (UMU)', aliases: ['umu', 'uganda martyrs university', 'nkozi'] },
  { name: 'Mbarara University of Science and Technology (MUST)', aliases: ['must', 'mbarara university', 'mbarara university of science and technology', 'mbarara'] },
  { name: 'Gulu University', aliases: ['gulu university', 'gulu'] },
  { name: 'Kabale University', aliases: ['kabale university', 'kabale'] },
  { name: 'Lira University', aliases: ['lira university', 'lira'] },
  { name: 'Busitema University', aliases: ['busitema', 'busitema university'] },
  { name: 'Soroti University', aliases: ['soroti university', 'soroti'] },
  { name: 'Islamic University in Uganda (IUIU)', aliases: ['iuiu', 'islamic university in uganda', 'mbale campus'] }
];

const CANONICAL_UNIVERSITIES = Array.from(new Set([
  ...UNIVERSITIES,
  ...UNIVERSITY_ALIAS_GROUPS.map((group) => group.name)
]));

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function simplify(value = '') {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasPattern(alias = '') {
  const simplified = simplify(alias);
  if (!simplified) return null;
  return simplified
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

function normalizeUniversityName(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  const rawKey = simplify(raw);
  if (!rawKey || ['other', 'not listed', 'other not listed', 'near campus', 'campus', 'university'].includes(rawKey)) return '';

  const canonical = CANONICAL_UNIVERSITIES.find((name) => {
    const key = simplify(name);
    return key === rawKey || rawKey === key.replace(/\s+university$/, '') || key.includes(rawKey);
  });
  if (canonical) return canonical;

  const aliasMatch = UNIVERSITY_ALIAS_GROUPS.find((group) => group.aliases.some((alias) => simplify(alias) === rawKey));
  return aliasMatch ? aliasMatch.name : '';
}

function normalizeUniversityList(values = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const normalized = normalizeUniversityName(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function inferNearestUniversityFromText(...values) {
  const text = simplify(values.flat(Infinity).filter(Boolean).join(' '));
  if (!text) return '';

  const explicit = normalizeUniversityName(text);
  if (explicit) return explicit;

  const aliases = UNIVERSITY_ALIAS_GROUPS
    .flatMap((group) => group.aliases.map((alias) => ({ name: group.name, alias })))
    .sort((a, b) => simplify(b.alias).length - simplify(a.alias).length);

  for (const item of aliases) {
    const pattern = aliasPattern(item.alias);
    if (!pattern) continue;
    if (new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(text)) return item.name;
  }
  return '';
}

function inferNearestUniversityFromListing(listing = {}) {
  const extra = listing.extra_fields && typeof listing.extra_fields === 'object' ? listing.extra_fields : {};
  const explicit = normalizeUniversityName(
    listing.nearest_university
    || listing.nearestUniversity
    || listing.nearest_uni
    || listing.university
    || listing.campus
    || extra.nearest_university
    || extra.nearestUniversity
    || extra.nearest_uni
    || extra.student_campus
    || extra.student_university
    || extra.university
    || extra.campus
  );
  if (explicit) return explicit;

  return inferNearestUniversityFromText(
    listing.title,
    listing.description,
    listing.sourceText,
    listing.source_text,
    listing.sourceTitle,
    listing.source_title,
    listing.sourceVisualText,
    listing.source_visual_text,
    listing.area,
    listing.address,
    listing.location,
    listing.location_label,
    listing.district,
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.source_visual_text,
    extra.resolved_location_label,
    extra.map_pin_label
  );
}

module.exports = {
  normalizeUniversityName,
  normalizeUniversityList,
  inferNearestUniversityFromText,
  inferNearestUniversityFromListing
};
