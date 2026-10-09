'use strict';

// Marketing's landing copy (makaug Marketing, landing_copy.md, 8 Oct 2026) for
// /for-sale, /land and /to-rent/kampala-kampala. Text is verbatim except:
//   - {tokens} are filled from the 5-minute inventory snapshot (no new query);
//   - a sentence whose token is missing (or whose median has < 5 prices) is
//     dropped, so the page never prints "UGX 0" or an example value;
//   - links use their final URLs (/for-sale/kampala → /for-sale/kampala-kampala,
//     /land/wakiso → /land/wakiso-wakiso, /land/mukono → /land/mukono-mukono);
//   - the Landlord and Tenant Act 2022 advance-rent wording is held back until
//     a Ugandan advocate confirms it (see the TODOs below).

const { compactUgx } = require('../utils/compactUgx');
const {
  locationForRouteSlug,
  snapshotMedian
} = require('./publicSeoService');

function escapeHtml(value = '') {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toLocaleString('en-US') : null;
}

function formatMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? compactUgx(number) : null;
}

// Count for an area page, the same way the page's own meta counts it.
function areaCount(snapshot, category, slug) {
  const location = locationForRouteSlug(slug);
  if (!location || !snapshot) return null;
  const map = location.level === 'district'
    ? snapshot.counts?.[category]
    : (snapshot.directCounts?.[category] || snapshot.counts?.[category]);
  return Number(map?.get(location.canonical_key) || 0);
}

function areaMedian(snapshot, category, slug) {
  const location = locationForRouteSlug(slug);
  if (!location || !snapshot) return null;
  const { median } = snapshotMedian(snapshot, category, location.canonical_key);
  return median > 0 ? median : null;
}

// Inline markup used by the copy: **bold**, [text](url). Text is escaped.
function inlineHtml(text = '') {
  const parts = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    parts.push(escapeHtml(text.slice(last, match.index)));
    if (match[1] !== undefined) parts.push(`<strong>${escapeHtml(match[1])}</strong>`);
    else parts.push(`<a href="${escapeHtml(match[3])}" class="font-semibold text-green-700 hover:underline">${escapeHtml(match[2])}</a>`);
    last = pattern.lastIndex;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join('');
}

function plainText(text = '') {
  return String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');
}

// Fill {tokens}; a sentence with any missing token becomes null.
function fill(template, tokens) {
  let missing = false;
  const out = String(template).replace(/\{([a-z0-9_]+)\}/g, (_, key) => {
    const value = tokens[key];
    if (value === null || value === undefined || value === '') {
      missing = true;
      return '';
    }
    return String(value);
  });
  return missing ? null : out;
}

function sentences(list = [], tokens = {}) {
  return list.map((sentence) => fill(sentence, tokens)).filter(Boolean).join(' ');
}

function renderBlocks(blocks = [], tokens = {}) {
  return blocks.map((block) => {
    const body = sentences(block.sentences, tokens);
    if (!body) return '';
    const heading = block.heading ? `<h2 class="text-xl font-black text-gray-900 mt-6">${escapeHtml(block.heading)}</h2>` : '';
    const lead = block.lead ? `<strong>${escapeHtml(block.lead)}</strong> ` : '';
    return `${heading}<p class="mt-2 text-gray-700">${lead}${inlineHtml(body)}</p>`;
  }).join('');
}

function renderFaq(faq = [], tokens = {}) {
  const items = faq
    .map((item) => ({ question: fill(item.q, tokens), answer: sentences(item.a, tokens) }))
    .filter((item) => item.question && item.answer);
  if (!items.length) return { html: '', items: [] };
  const html = `<h2 class="text-xl font-black text-gray-900 mt-8">Frequently asked questions</h2>${items.map((item) => (
    `<h3 class="mt-4 font-black text-gray-900">${inlineHtml(item.question)}</h3><p class="mt-1 text-gray-700">${inlineHtml(item.answer)}</p>`
  )).join('')}`;
  return { html, items: items.map((item) => ({ question: plainText(item.question), answer: plainText(item.answer) })) };
}

// ---- The three pages (verbatim copy) ---------------------------------------

function forSaleCopy(snapshot) {
  const najjera = areaCount(snapshot, 'sale', 'najjera-wakiso');
  const nansana = areaCount(snapshot, 'sale', 'nansana-wakiso');
  const tokens = {
    count: formatCount(snapshot?.categoryTotals?.sale),
    kira_count: formatCount(areaCount(snapshot, 'sale', 'kira-wakiso')),
    kyanja_count: formatCount(areaCount(snapshot, 'sale', 'kyanja-kampala')),
    entebbe_count: formatCount(areaCount(snapshot, 'sale', 'entebbe-wakiso')),
    najjera_count: formatCount(najjera),
    nansana_count: formatCount(nansana),
    kitende_count: formatCount(areaCount(snapshot, 'sale', 'kitende-wakiso')),
    median_sale: formatMoney(snapshotMedian(snapshot, 'sale').median),
    nansana_med: formatMoney(areaMedian(snapshot, 'sale', 'nansana-wakiso')),
    namugongo_med: formatMoney(areaMedian(snapshot, 'sale', 'namugongo-wakiso')),
    kira_med: formatMoney(areaMedian(snapshot, 'sale', 'kira-wakiso')),
    kyanja_med: formatMoney(areaMedian(snapshot, 'sale', 'kyanja-kampala')),
    munyonyo_med: formatMoney(areaMedian(snapshot, 'sale', 'munyonyo-kampala')),
    new_7d: formatCount(snapshot?.newLast7d)
  };
  // Marketing wrote "Najjera and Nansana ({najjera_count} each)" because the two
  // counts were equal on 8 Oct; when they differ, each gets its own count.
  const najjeraPhrase = najjera && najjera === nansana
    ? 'Najjera and Nansana (**{najjera_count}** each)'
    : 'Najjera (**{najjera_count}**), Nansana (**{nansana_count}**)';
  return {
    title: fill('Houses for Sale in Uganda: {count} Listings, One Search | makaug.com', tokens),
    description: fill('Houses for sale in Uganda: {count} homes from agents, owners and TikTok, YouTube & X posts in one search. Search free, contact the lister direct.', tokens),
    h1: 'Houses for sale in Uganda',
    intro: ["Instead of scrolling dozens of agents' pages, TikTok accounts and WhatsApp groups, search every house for sale in Uganda we can find online, in one place.", 'makaug.com brings together **{count}** homes for sale, from Kira and Kyanja to Entebbe and Mbarara, and checks each one before it goes live.'],
    body: [
      { heading: 'Every listing, one search', sentences: [
        'makaug finds property posted publicly on TikTok, YouTube, X and the web, and adds homes listed directly by owners and agents.',
        'Every listing found online links back to the original post, so you can see who posted it and when.',
        'Nothing is published automatically: our team reviews the details first.',
        'When you find a house you like, you contact the lister directly by call or WhatsApp.',
        "makaug doesn't sit in the middle."
      ] },
      { heading: 'Where the houses are', sentences: [
        'Most homes for sale are around Kampala and Wakiso.',
        `Kira has the most (**{kira_count}**), followed by Kyanja (**{kyanja_count}**), Entebbe (**{entebbe_count}**), ${najjeraPhrase} and Kitende (**{kitende_count}**).`,
        'Browse by area: [Kira](/for-sale/kira-wakiso) · [Kyanja](/for-sale/kyanja-kampala) · [Entebbe](/for-sale/entebbe-wakiso) · [Najjera](/for-sale/najjera-wakiso) · [Kitende](/for-sale/kitende-wakiso) · [Namugongo](/for-sale/namugongo-wakiso) · [Ntinda](/for-sale/ntinda-kampala) · [Munyonyo](/for-sale/munyonyo-kampala) · [All of Kampala](/for-sale/kampala-kampala) · [All of Wakiso](/for-sale/wakiso-wakiso) · [Mukono](/for-sale/mukono-mukono).'
      ] },
      { heading: 'What houses cost', sentences: [
        'The middle asking price of a house for sale on makaug is about **UGX {median_sale}**.',
        'It varies a lot by area: around UGX {nansana_med} in Nansana, {namugongo_med} in Namugongo, {kira_med} in Kira, {kyanja_med} in Kyanja and {munyonyo_med} in Munyonyo.',
        'These are asking prices from live listings, not valuations; try our [property value calculator](/valuation) or the [mortgage finder](/mortgage).'
      ] },
      { lead: 'Buying from abroad?', sentences: ['Switch prices to £, $ or € at the top of the page, read our [safety guide](/safety) and use an independent lawyer and an official title search before you pay.'] },
      { lead: 'Selling?', sentences: ['[List your house](/list-property): the first 7 days are free.'] }
    ],
    faq: [
      { q: 'How many houses are for sale in Uganda on makaug?', a: ['Right now **{count}**, updated as new listings are found and approved.', 'New listings arrive every day ({new_7d} across all categories in the last 7 days).'] },
      { q: 'Where do the listings come from?', a: ['Public property posts on TikTok, YouTube, X and the web, plus homes listed directly by owners and agents.', 'Each found-online listing shows the original source.'] },
      { q: 'Is makaug an estate agent?', a: ['No. makaug is a property search site.', 'You deal directly with the owner or agent who posted the listing.'] },
      { q: 'Are the listings checked?', a: ['Our team reviews every listing before it goes live and checks for duplicates and warning signs.', "That doesn't prove ownership, so always view the property, use a lawyer and do an official title search before paying."] },
      { q: 'What is the average price of a house for sale in Uganda?', a: ['The median asking price on makaug is about UGX {median_sale}, from roughly UGX 140M in Nansana to over UGX 2B in Munyonyo.'] },
      { q: 'Can I search in Luganda or Swahili?', a: ['Yes. The site works in 9 languages, and you can describe what you want in your own words, or WhatsApp **0780 863 394**.'] }
    ],
    tokens
  };
}

function landCopy(snapshot) {
  const landPrices = snapshot?.categoryValidPrices?.land || [];
  const tokens = {
    count: formatCount(snapshot?.categoryTotals?.land),
    districts: formatCount(snapshot?.categoryDistricts?.land?.size),
    median_land: formatMoney(snapshotMedian(snapshot, 'land').median),
    namayumba_med: formatMoney(areaMedian(snapshot, 'land', 'namayumba-wakiso')),
    kakiri_med: formatMoney(areaMedian(snapshot, 'land', 'kakiri-wakiso')),
    gayaza_med: formatMoney(areaMedian(snapshot, 'land', 'gayaza-wakiso')),
    namugongo_med: formatMoney(areaMedian(snapshot, 'land', 'namugongo-wakiso')),
    entebbe_med: formatMoney(areaMedian(snapshot, 'land', 'entebbe-wakiso')),
    kira_med: formatMoney(areaMedian(snapshot, 'land', 'kira-wakiso')),
    kyanja_med: formatMoney(areaMedian(snapshot, 'land', 'kyanja-kampala')),
    under50: formatCount(landPrices.filter((price) => price < 50_000_000).length)
  };
  return {
    title: fill('Land for Sale in Uganda: {count} Plots & Acres in One Search | makaug.com', tokens),
    description: fill('Land for sale in Uganda: {count} plots and acres from Wakiso to Mbarara. Compare prices by area, check titles, contact sellers direct.', tokens),
    h1: 'Land for sale in Uganda',
    intro: ['Every plot of land for sale in Uganda we can find online, in one search.', 'makaug.com gathers **{count}** land listings from agents, owners, estate developers and public TikTok, YouTube and X posts, so you can compare plots across **{districts}** districts without chasing each seller.'],
    body: [
      { heading: 'Compare plot prices by area', sentences: [
        'The middle asking price for land on makaug is about **UGX {median_land}**, but the spread is huge.',
        'Typical asking prices: Namayumba around UGX {namayumba_med}, Kakiri {kakiri_med}, Gayaza {gayaza_med}, Namugongo {namugongo_med}, Entebbe {entebbe_med}, Kira {kira_med} and Kyanja {kyanja_med}.',
        '**{under50}** priced plots are under UGX 50M.',
        'Browse by area: [Kira](/land/kira-wakiso) · [Gayaza](/land/gayaza-wakiso) · [Kakiri](/land/kakiri-wakiso) · [Entebbe](/land/entebbe-wakiso) · [Namugongo](/land/namugongo-wakiso) · [Kyanja](/land/kyanja-kampala) · [All of Wakiso](/land/wakiso-wakiso) · [Mukono](/land/mukono-mukono) · [Kampala](/land/kampala-kampala).'
      ] },
      { heading: 'Check the title before you pay', sentences: [
        'Use the title filter to see plots whose sellers say a title is available, then confirm it yourself: do an official search at the land registry (through a lawyer or the MLHUD system), visit the plot, meet the neighbours and the LC1, and pay only through a traceable channel.',
        'Our [safety guide](/safety) covers mailo, freehold, leasehold and kibanja questions to ask.'
      ] },
      { heading: 'Why search here', sentences: [
        'Land is sold everywhere: roadside signs, estate promos on TikTok, YouTube walk-throughs, WhatsApp groups.',
        'makaug puts it in one place, keeps a link to the original post, and has a person review every listing before it appears.',
        'You contact the seller directly.'
      ] },
      { lead: 'Selling land?', sentences: ['[List your plot](/list-property) (7 days free) or WhatsApp **0780 863 394**.'] }
    ],
    faq: [
      { q: 'How much does a plot cost in Uganda?', a: ['On makaug the median asking price is about UGX {median_land}.', 'Plots on the edge of Wakiso start around UGX 10–30M; Kira and Kyanja are typically UGX 120–300M.'] },
      { q: 'Where is the cheapest land near Kampala?', a: ['Among areas with many listings, Namayumba, Kakiri and Gayaza have the lowest typical asking prices right now.'] },
      { q: 'How do I know the land title is genuine?', a: ['Ask for a copy of the title, do an official search through a lawyer or the land registry, check the boundaries with a surveyor, and never pay cash to someone rushing you.'] },
      { q: 'Can I buy land in Uganda from abroad?', a: ['Yes. Many diaspora buyers do.', 'Use an independent lawyer in Uganda, ask for a live video viewing, and pay into a traceable account.', 'See [safety tips for diaspora buyers](/safety).'] },
      { q: 'Does makaug sell the land?', a: ['No. makaug lists land from many sellers in one place; you deal directly with the seller or agent.'] }
    ],
    tokens
  };
}

function kampalaRentCopy(snapshot) {
  const kampala = locationForRouteSlug('kampala-kampala');
  const kampalaMedian = kampala ? snapshotMedian(snapshot, 'rent', kampala.canonical_key).median : 0;
  const tokens = {
    count: formatCount(areaCount(snapshot, 'rent', 'kampala-kampala')),
    muyenga: formatCount(areaCount(snapshot, 'rent', 'muyenga-kampala')),
    munyonyo: formatCount(areaCount(snapshot, 'rent', 'munyonyo-kampala')),
    bunga: formatCount(areaCount(snapshot, 'rent', 'bunga-kampala')),
    kyanja: formatCount(areaCount(snapshot, 'rent', 'kyanja-kampala')),
    kololo: formatCount(areaCount(snapshot, 'rent', 'kololo-kampala')),
    ntinda: formatCount(areaCount(snapshot, 'rent', 'ntinda-kampala')),
    kisaasi: formatCount(areaCount(snapshot, 'rent', 'kisaasi-kampala')),
    median_rent: formatMoney(kampalaMedian),
    kisaasi_med: formatMoney(areaMedian(snapshot, 'rent', 'kisaasi-kampala')),
    kiwatule_med: formatMoney(areaMedian(snapshot, 'rent', 'kiwatule-kampala')),
    ntinda_med: formatMoney(areaMedian(snapshot, 'rent', 'ntinda-kampala')),
    kyanja_med: formatMoney(areaMedian(snapshot, 'rent', 'kyanja-kampala')),
    munyonyo_med: formatMoney(areaMedian(snapshot, 'rent', 'munyonyo-kampala')),
    muyenga_med: formatMoney(areaMedian(snapshot, 'rent', 'muyenga-kampala'))
  };
  return {
    title: fill('Houses for Rent in Kampala: {count} Rentals in One Search | makaug.com', tokens),
    description: fill('Houses for rent in Kampala: {count} houses and apartments from Muyenga to Ntinda. Filter by budget and bedrooms, contact landlords direct.', tokens),
    h1: 'Houses for rent in Kampala',
    intro: ["Stop jumping between TikTok tours, Facebook groups and agents' WhatsApp statuses.", 'makaug.com puts **{count}** houses and apartments for rent in Kampala in one place, found across the web and listed by landlords and agents, and checked before they go live.'],
    body: [
      { heading: 'Rentals by area', sentences: [
        'The most rentals are in Muyenga (**{muyenga}**), Munyonyo (**{munyonyo}**), Bunga (**{bunga}**), Kyanja (**{kyanja}**), Kololo (**{kololo}**), Ntinda (**{ntinda}**) and Kisaasi (**{kisaasi}**).',
        'Browse: [Muyenga](/to-rent/muyenga-kampala) · [Munyonyo](/to-rent/munyonyo-kampala) · [Kyanja](/to-rent/kyanja-kampala) · [Kololo](/to-rent/kololo-kampala) · [Ntinda](/to-rent/ntinda-kampala) · [Kisaasi](/to-rent/kisaasi-kampala) · [Bugolobi](/to-rent/bugolobi-kampala).',
        'Looking just outside the city? [Kira](/to-rent/kira-wakiso) has the most rentals of anywhere in Uganda. Also browse [Entebbe](/to-rent/entebbe-wakiso) · [All of Wakiso](/to-rent/wakiso-wakiso) · [Mukono](/to-rent/mukono-mukono).'
      ] },
      { heading: 'What rent costs in Kampala', sentences: [
        'The middle asking rent in Kampala is about **UGX {median_rent}** a month.',
        'Typical asking rents: Kisaasi around UGX {kisaasi_med}, Kiwatule {kiwatule_med}, Ntinda {ntinda_med}, Kyanja {kyanja_med}, Munyonyo {munyonyo_med} and Muyenga {muyenga_med}.',
        'Kololo and Bugolobi are the most expensive.',
        'Use the budget and bedroom filters to see what fits, or switch to $ if your rent is quoted in dollars.'
      ] },
      { heading: 'Rent safely', sentences: [
        // TODO(Arthur): Marketing's sentence continues "…and receipts, and remember
        // the Landlord and Tenant Act 2022 limits advance rent to three months
        // unless you both agree otherwise." Held back until a Ugandan advocate
        // confirms the wording.
        "View the house in person before paying anything, ask to see the landlord's or agent's authority, get a written tenancy agreement and receipts.",
        'Report anything suspicious from the listing page.'
      ] },
      { lead: 'Landlords:', sentences: ['tenants search one place. [List your rental](/list-property) (first 7 days free) or WhatsApp **0780 863 394**.'] }
    ],
    faq: [
      { q: 'How many houses are for rent in Kampala?', a: ['**{count}** right now on makaug, across Kampala district.', 'There are hundreds more in Wakiso (Kira, Najjera, Namugongo).'] },
      { q: 'What is the average rent in Kampala?', a: ['About UGX {median_rent} a month asking rent across all sizes.', '1–2 bedroom homes in Kisaasi, Kiwatule and Ntinda are often UGX 0.8–1.5M.'] },
      // TODO(Arthur): FAQ "How much advance rent can a landlord ask for?" (Landlord
      // and Tenant Act 2022, three months) is held back until a Ugandan advocate
      // confirms the wording.
      { q: 'Do I pay makaug a fee to rent?', a: ['No. Searching is free and you contact the landlord or agent directly.', 'Agree any agent fee with them in writing.'] },
      { q: 'Can I find a rental on WhatsApp?', a: ['Yes. WhatsApp **0780 863 394**, share your area and budget, and the makaug assistant sends matching listings in your language.'] }
    ],
    tokens
  };
}

function landingCopyForPage(categoryKey, location) {
  if (categoryKey === 'sale' && !location) return forSaleCopy;
  if (categoryKey === 'land' && !location) return landCopy;
  if (categoryKey === 'rent' && location?.canonical_key === 'kampala:kampala') return kampalaRentCopy;
  return null;
}

// Returns null for pages without Marketing copy.
function buildLandingCopy(categoryKey, location, snapshot, options = {}) {
  const builder = landingCopyForPage(categoryKey, location);
  if (!builder) return null;
  const copy = builder(snapshot);
  const introText = sentences(copy.intro, copy.tokens);
  const bodyHtml = renderBlocks(copy.body, copy.tokens);
  const faq = renderFaq(copy.faq, copy.tokens);
  const firstPage = !(Number(options.page) > 1);
  return {
    title: copy.title,
    description: copy.description,
    h1: copy.h1,
    introHtml: introText ? `<p class="mb-4 text-gray-700" data-ssr-category-summary="1" data-landing-intro="1">${inlineHtml(introText)}</p>` : '',
    // Body + FAQ render on page 1 only, below the grid, outside it.
    bodyHtml: firstPage && (bodyHtml || faq.html)
      ? `<section class="mt-10 rounded-2xl border border-gray-200 bg-white p-6" data-landing-copy="1">${bodyHtml}${faq.html}</section>`
      : '',
    faqStructuredData: firstPage && faq.items.length ? {
      '@type': 'FAQPage',
      mainEntity: faq.items.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer }
      }))
    } : null
  };
}

module.exports = {
  buildLandingCopy,
  landingCopyForPage,
  fill
};
