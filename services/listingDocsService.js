'use strict';

// The two documents makaug sends on WhatsApp:
//  - Terms for private (non-agent) listers, which they must AGREE to before
//    their property is submitted.
//  - The agent guide, sent once an agent is approved.
// Both are generated as PDFs (pdfkit) and served publicly from /legal/...,
// with a PNG cover card that goes out as the WhatsApp image (the bridge can
// send images, not files) and carries the link to the PDF.

const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const LISTER_TERMS_VERSION = '2026-10-v2'; // C21: per listing, VAT incl.
const AGENT_GUIDE_VERSION = '2026-10-v2';
const AGENT_TERMS_VERSION = '2026-10-v2'; // C21: VAT incl., Admin trial days

const INK = '#15213A';
const ORANGE = '#E8662A';
const MUTED = '#5B6478';

function siteUrl() {
  return String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function ugx(n) {
  return `UGX ${Number(n || 0).toLocaleString('en-US')}`;
}

function helpContact() {
  const name = String(process.env.AGENT_HELP_CONTACT_NAME || 'Ronald').trim();
  const digits = String(process.env.AGENT_HELP_CONTACT_PHONE || '+256709402189').replace(/\D+/g, '');
  const pretty = digits.length === 12 && digits.startsWith('256') ? `+256 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}` : `+${digits}`;
  return { name, digits, pretty };
}

function docUrls(kind) {
  const base = siteUrl();
  if (kind === 'agent_guide') {
    return { pdf: `${base}/legal/makaug-agent-guide.pdf?v=${AGENT_GUIDE_VERSION}`, cover: `${base}/legal/makaug-agent-guide-cover.png?v=${AGENT_GUIDE_VERSION}` };
  }
  if (kind === 'agent_terms') {
    return { pdf: `${base}/legal/makaug-agent-terms.pdf?v=${AGENT_TERMS_VERSION}`, cover: `${base}/legal/makaug-agent-terms-cover.png?v=${AGENT_TERMS_VERSION}` };
  }
  return { pdf: `${base}/legal/makaug-private-lister-terms.pdf?v=${LISTER_TERMS_VERSION}`, cover: `${base}/legal/makaug-private-lister-terms-cover.png?v=${LISTER_TERMS_VERSION}` };
}

function settingsDefaults(settings = {}) {
  // C21: the fees and free days are Admin's (billing_settings), never env.
  const fees = require('./billingOpsService').feesFromSettings(settings);
  const agent = settings.agent_fee || {};
  return {
    freeDays: fees.lister.free_days,
    listerMonthly: fees.lister.monthly_ugx,
    agentMonthly: fees.agent.monthly_ugx,
    finalAfter: Number(agent.final_after_days_overdue ?? 7),
    agentFreeDays: fees.agent.trial_days,
    payTo: settings.pay_to || {}
  };
}

// ---------------------------------------------------------------------------
// PDF building helpers
function newDoc(title) {
  const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 56, bottom: 56, left: 60, right: 60 }, info: { Title: title, Author: 'makaug', Creator: 'makaug.com' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 8).fill(ORANGE);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('makaug.com', 60, 30);
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(title);
  if (subtitle) doc.moveDown(0.3).font('Helvetica').fontSize(10.5).fillColor(MUTED).text(subtitle);
  doc.moveDown(0.8);
}

function section(doc, heading) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12.5).fillColor(INK).text(heading);
  doc.moveDown(0.25);
}

function para(doc, text) {
  doc.font('Helvetica').fontSize(10.5).fillColor('#222').text(text, { lineGap: 2.2 });
  doc.moveDown(0.35);
}

function bullets(doc, items) {
  items.forEach((item) => {
    doc.font('Helvetica').fontSize(10.5).fillColor('#222').text(`•  ${item}`, { indent: 6, lineGap: 2.2 });
    doc.moveDown(0.2);
  });
  doc.moveDown(0.2);
}

function footer(doc, line) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(`${line}  ·  Page ${i + 1} of ${range.count}`, 60, doc.page.height - 40, { width: doc.page.width - 120, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

// ---------------------------------------------------------------------------
async function buildListerTermsPdf(settings = {}) {
  const s = settingsDefaults(settings);
  const help = helpContact();
  const { doc, done } = newDoc('makaug — Terms for private listers');
  header(doc, 'Terms for listing your property on makaug', `For owners and private landlords listing directly (not agents). Version ${LISTER_TERMS_VERSION}.`);

  doc.roundedRect(60, doc.y, doc.page.width - 120, 74, 8).fill('#FFF3E8');
  const boxTop = doc.y + 12;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('In short', 76, boxTop);
  doc.font('Helvetica').fontSize(10).fillColor('#222').text(
    `Your first ${s.freeDays} days are free. To stay live after that it is ${ugx(s.listerMonthly)} per listing, per month (VAT incl.). makaug advertises your property; we are not part of any sale or rent, and you remain responsible for your listing and your deal. Reply AGREE on WhatsApp to accept these terms.`,
    76, boxTop + 16, { width: doc.page.width - 152, lineGap: 1.5 }
  );
  doc.x = 60;
  doc.y = boxTop + 74;
  doc.moveDown(0.6);

  section(doc, '1. Who we are and what we do');
  para(doc, 'makaug ("makaug", "we", "us") runs makaug.com and its WhatsApp assistant, an online platform where property in Uganda is advertised. We publish listings and pass enquiries to the person who listed. We are not an estate agent, broker, valuer, lawyer or bank, and we do not act for either side of any transaction.');

  section(doc, '2. Your listing — what you promise');
  bullets(doc, [
    'You own the property, or you have the owner\'s permission to advertise it, and you are allowed to sell or let it.',
    'Everything you send us — photos, price, size, location, title details and description — is true, current and not misleading, and the photos are of this property.',
    'You will tell us straight away (reply on WhatsApp) if the property is sold, let, or the details change, so the listing can be updated or removed.',
    'You will not list anything illegal, anything you have no right to advertise, or anything that copies someone else\'s photos or listing.'
  ]);

  section(doc, '3. Checking your identity');
  para(doc, 'Before a listing goes live we ask for your National ID. It is used only to confirm you are a real person connected to the property and to protect buyers and tenants from fraud. Your ID is never shown on makaug or given to anyone who enquires. It is stored securely, seen only by the makaug review team, and handled under the Data Protection and Privacy Act, 2019. Checking your ID is not a guarantee by makaug that you own the property.');

  section(doc, '4. Fees');
  bullets(doc, [
    `Free period: your listing is free for the first ${s.freeDays} days after it goes live.`,
    `After that: ${ugx(s.listerMonthly)} per listing, per month (VAT incl.), paid in advance to the makaug number we give you on WhatsApp. Send us the transaction ID after paying so we can match it.`,
    'Payments are confirmed by a member of the makaug team before they are recorded. Keep your MoMo / bank message as proof.',
    'If a month is not paid, we will remind you. If it is still not paid, the listing is hidden from the website. Nothing is deleted: when you pay, it goes back live exactly as it was.',
    'Fees are for advertising time and are not refundable once the month has started, including if the property is sold or let early.',
    'We will tell you on WhatsApp at least 14 days before any change to the fee.'
  ]);

  section(doc, '5. Our role — no liability for deals');
  bullets(doc, [
    'makaug is an advertising platform only. Any sale, lease, deposit, viewing or payment is between you and the buyer or tenant. We are not a party to it and do not hold money for either side.',
    'We do not check title, boundaries, planning permission, building quality or who is entitled to the property, and we do not guarantee that any enquirer is genuine, able to pay or will complete.',
    'You should do your own checks on anyone you deal with, meet in safe places, never hand over original title documents, and use a lawyer for sales and long leases. Buyers are advised to do a search at the Ministry of Lands.',
    'To the fullest extent the law allows, makaug, its staff and partners are not liable for any loss, damage, cost or claim arising from your listing, from any enquiry, or from any transaction or dealing between you and anyone you meet through makaug. Where liability cannot be excluded, it is limited to the fees you paid us for that listing in the previous three months.',
    'We aim to keep the website and WhatsApp service running, but we do not promise it will always be available, error-free, or that your listing will receive a set number of views or enquiries.'
  ]);

  section(doc, '6. Your responsibility to us');
  para(doc, 'You agree to cover makaug for any claim, loss or cost (including reasonable legal costs) that arises because something in your listing was false or misleading, because you had no right to advertise the property, or because of your own dealings with a buyer or tenant.');

  section(doc, '7. What we can do with your listing');
  bullets(doc, [
    'We may edit your listing for clarity, spelling, format or translation, choose which photo appears first, and add makaug branding.',
    'You allow makaug to show your photos and details on makaug.com, in our WhatsApp replies, and in makaug posts on social media to promote the property, while it is listed.',
    'We may decline, pause or remove a listing at any time, for example if details cannot be confirmed, we receive a credible complaint, or these terms are broken.',
    'View and enquiry numbers we send you come from makaug\'s own records and are a guide, not an audited figure.'
  ]);

  section(doc, '8. Messages and your data');
  para(doc, 'By listing you agree that makaug may contact you on WhatsApp, by phone or SMS about your listing, enquiries and payments. Your name and contact number are shared with people who enquire about your property so they can reach you. We keep your information only as long as needed for these purposes and for our records. You can ask us to see, correct or delete your information by messaging us on WhatsApp.');

  section(doc, '9. Ending your listing');
  para(doc, 'You can remove your listing at any time by replying REMOVE followed by your listing reference on WhatsApp. We may end this arrangement by giving you notice on WhatsApp.');

  section(doc, '10. General');
  bullets(doc, [
    'These terms are governed by the laws of the Republic of Uganda, and the courts of Uganda have jurisdiction.',
    'We may update these terms. The version in force is the one at the link we send you; we will message you about important changes. Continuing to list after a change means you accept it.',
    'If any part of these terms cannot be enforced, the rest still applies.',
    `Questions: WhatsApp or call ${help.name} on ${help.pretty}, or visit ${siteUrl().replace(/^https?:\/\//, '')}.`
  ]);

  section(doc, 'How you accept');
  para(doc, 'When you reply AGREE on WhatsApp, we record the date, time and the number you replied from as your acceptance of this version of the terms.');

  footer(doc, `makaug — Terms for private listers — ${LISTER_TERMS_VERSION}`);
  doc.end();
  return done;
}

async function buildAgentGuidePdf(settings = {}) {
  const s = settingsDefaults(settings);
  const help = helpContact();
  const payLine = s.payTo.number && s.payTo.name ? `${s.payTo.method || 'MTN Mobile Money'} ${s.payTo.number} (${s.payTo.name})` : 'the makaug number we send you on WhatsApp';
  const { doc, done } = newDoc('makaug — Agent guide');
  header(doc, 'Welcome to makaug — your agent guide', `Everything you need to post properties and get enquiries. Version ${AGENT_GUIDE_VERSION}.`);

  section(doc, '1. Posting a property — just send it on WhatsApp');
  bullets(doc, [
    'Send the photos of ONE property to the makaug WhatsApp number (send them together — up to 10).',
    'In the same message or just after, type the details: for sale or rent, price, area (e.g. "Naalya, Wakiso"), bedrooms and bathrooms, and anything special (title, parking, size of plot).',
    'makaug writes the listing for you and replies with a summary. Check it — if something is wrong, just reply with the correction in your own words.',
    'Next property? Send its photos as a new message. Don\'t mix two properties in one batch.',
    'Videos and voice notes are welcome; you can write in English, Luganda or Swahili.'
  ]);

  section(doc, '2. Useful words to reply with');
  bullets(doc, [
    'HELP — talk to a person at makaug.',
    'REMOVE <reference> — take a listing down when it is sold or let.',
    'MENU — see your options.'
  ]);

  section(doc, '3. Enquiries');
  para(doc, 'When a buyer or tenant enquires about your property on makaug.com or WhatsApp, we send you their name, number and message on WhatsApp straight away. Reply to them quickly — fast replies win clients. You also get a weekly report with your views and enquiries, and a share card for your WhatsApp status.');

  section(doc, '4. Good photos sell');
  bullets(doc, [
    'Start with the front of the property in daylight, then the sitting room, bedrooms, kitchen and bathrooms.',
    'Hold the phone level, turn on the lights, and avoid photos with people or other agents\' watermarks.',
    'Give the exact area — listings with a clear location get far more enquiries.'
  ]);

  section(doc, '5. Your subscription');
  bullets(doc, [
    `New agents start with ${s.agentFreeDays} days free. We tell you the date it ends and remind you before it does, so there are no surprises.`,
    `After the free days, the makaug agent plan is ${ugx(s.agentMonthly)} per month (VAT incl.).`,
    `Pay to ${payLine}, then send the transaction ID (or a screenshot of the payment message) here on WhatsApp. We match it and confirm it — you will get a thank-you message when it is recorded.`,
    'We remind you 3 days before your renewal date and on the day.',
    `If the month is not paid, we send reminders; after ${s.finalAfter} days overdue a final reminder, and then your listings may be paused. Nothing is deleted — as soon as you pay, everything goes back live exactly as it was.`
  ]);

  section(doc, '6. The rules');
  bullets(doc, [
    'Only list properties you are instructed to market, with true prices and real photos of that property.',
    'Tell us when a property is sold or let so it comes down.',
    'makaug is an advertising platform. Deals, commissions and payments between you, the owner and the client are your responsibility; makaug is not a party to them and is not liable for them.',
    'We may edit listings for clarity and remove listings that are misleading or break these rules.'
  ]);

  section(doc, '7. Need help?');
  para(doc, `Call or WhatsApp ${help.name} on ${help.pretty}, or reply HELP on the makaug WhatsApp.`);

  footer(doc, `makaug — Agent guide — ${AGENT_GUIDE_VERSION}`);
  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// Cover card PNG (what WhatsApp shows) — 1080x1350
async function buildAgentTermsPdf(settings = {}) {
  const s = settingsDefaults(settings);
  const help = helpContact();
  const { doc, done } = newDoc('makaug — Agent terms');
  header(doc, 'Terms for agents on makaug', `For estate agents and brokers listing properties on makaug.com. Version ${AGENT_TERMS_VERSION}.`);

  doc.roundedRect(60, doc.y, doc.page.width - 120, 74, 8).fill('#FFF3E8');
  const boxTop = doc.y + 12;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('In short', 76, boxTop);
  doc.font('Helvetica').fontSize(10).fillColor('#222').text(
    `Your first ${s.agentFreeDays} days are free. After that the agent plan is ${ugx(s.agentMonthly)} per month (VAT incl.). makaug advertises your properties; we take no commission and are not part of any deal. Reply AGREE on WhatsApp to accept these terms.`,
    76, boxTop + 16, { width: doc.page.width - 152, lineGap: 1.5 }
  );
  doc.x = 60;
  doc.y = boxTop + 74;
  doc.moveDown(0.6);

  section(doc, '1. Who we are');
  para(doc, 'makaug.com is an online property marketplace for Uganda, operated by Makaug Online Real Estate Ltd ("makaug", "we"). These terms are between makaug and you, the agent or broker named in your makaug agent account ("you").');

  section(doc, '2. The free period and the agent plan');
  bullets(doc, [
    `Your first ${s.agentFreeDays} days on makaug are free, counted from the day your agent account is switched on. We tell you the date it ends.`,
    `After that, the agent plan is ${ugx(s.agentMonthly)} per month (VAT incl.), for as long as you want your agent page and listings live.`,
    'Nothing is charged automatically. We send you a payment link before the free period ends and before each renewal; you pay by Mobile Money (or card where offered).',
    `If a payment is not made, we send reminders, and after ${s.finalAfter} days overdue your listings may be paused. Nothing is deleted: when you pay, everything goes back live exactly as it was.`,
    'You can stop at any time by telling us on WhatsApp (reply HELP). You will not be charged for a period you did not use after you have told us to stop.',
    'We may change the price with at least 30 days\' notice by WhatsApp; the new price applies from your next renewal after that.'
  ]);

  section(doc, '3. What you get');
  bullets(doc, [
    'Your own agent page on makaug.com and an agent ID, showing your listings.',
    'Posting by WhatsApp: send photos and details, we write the listing, our team checks it, and you get the link when it is live.',
    'Enquiries sent straight to your WhatsApp number with the enquirer\'s name, number and message, and a weekly report of views and enquiries.',
    'Exposure to buyers and tenants in Uganda and Ugandans abroad. We do not promise a particular number of views, enquiries or sales.'
  ]);

  section(doc, '4. Your listings');
  bullets(doc, [
    'List only properties you are instructed to market, with true prices, true descriptions and real photos of that property.',
    'Do not post another agent\'s or owner\'s property without permission, and do not use photos with other agents\' watermarks.',
    'Tell us when a property is sold or let so that it comes down (reply REMOVE).',
    'You give makaug permission to display, edit for clarity, share and promote your listings, photos and videos on makaug.com and on our social channels.',
    'We may decline, pause or remove a listing, or suspend an account, if details cannot be confirmed, we receive a credible complaint, or these terms are broken.'
  ]);

  section(doc, '5. Deals and commissions');
  para(doc, 'makaug is an advertising platform. Any deal, commission, deposit or payment between you, the owner and the client is your responsibility. makaug takes no commission, is not a party to those deals, and is not liable for them. Never ask a client to pay a deposit to makaug.');

  section(doc, '6. Your information');
  bullets(doc, [
    'We keep your identity details only to confirm who you are. They are never shown to buyers.',
    'Your name, agent ID, agent number, photo and listings are shown publicly on your agent page. Your phone number is shown on your listings so buyers can call you.',
    'We message you on WhatsApp about enquiries, reports, payments and important changes.'
  ]);

  section(doc, '7. General');
  bullets(doc, [
    'These terms are governed by the laws of the Republic of Uganda, and the courts of Uganda have jurisdiction.',
    'We may update these terms. The version in force is the one at the link we send you; we will message you about important changes. Continuing to list after a change means you accept it.',
    'If any part of these terms cannot be enforced, the rest still applies.'
  ]);

  section(doc, '8. Accepting these terms');
  para(doc, 'When you reply AGREE on WhatsApp, we record the date, time and the number you replied from as your acceptance of this version of the terms.');
  para(doc, `Questions? Call or WhatsApp ${help.name} on ${help.pretty}.`);

  footer(doc, `makaug — Agent terms — ${AGENT_TERMS_VERSION}`);
  doc.end();
  return done;
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function buildCoverPng(kind, settings = {}) {
  const s = settingsDefaults(settings);
  const isTerms = kind === 'agent_terms';
  const isAgent = kind === 'agent_guide' || isTerms;
  const title = isTerms ? ['Agent terms', 'for makaug'] : isAgent ? ['Your makaug', 'agent guide'] : ['Terms for listing', 'your property'];
  const lines = isTerms
    ? [`First ${s.agentFreeDays} days free`, `Then ${ugx(s.agentMonthly)}/month (VAT incl.)`, 'No commission. Your deal is yours', 'Reply AGREE to accept']
    : isAgent
    ? ['Post by sending photos on WhatsApp', 'Enquiries come straight to you', `${ugx(s.agentMonthly)}/month (VAT incl.)`, 'Help: reply HELP any time']
    : [`First ${s.freeDays} days free`, `Then ${ugx(s.listerMonthly)} / month per property`, 'Your ID stays private — never shown', 'makaug advertises; your deal is yours'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
  <rect width="1080" height="1350" fill="#FBF6EE"/>
  <circle cx="980" cy="120" r="360" fill="#FFE7D3"/>
  <circle cx="60" cy="1300" r="300" fill="#E3F2E6"/>
  <rect x="0" y="0" width="1080" height="16" fill="${ORANGE}"/>
  <text x="80" y="140" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="46" font-weight="800" fill="${INK}">makaug.com</text>
  <rect x="80" y="210" rx="34" ry="34" width="330" height="68" fill="${ORANGE}"/>
  <text x="245" y="256" text-anchor="middle" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="32" font-weight="800" fill="#fff">${isTerms ? 'PDF · TERMS' : isAgent ? 'PDF · GUIDE' : 'PDF · TERMS'}</text>
  <text x="80" y="410" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="96" font-weight="900" fill="${INK}">${esc(title[0])}</text>
  <text x="80" y="520" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="96" font-weight="900" fill="${ORANGE}">${esc(title[1])}</text>
  ${lines.map((l, i) => `<rect x="80" y="${620 + i * 130}" rx="28" ry="28" width="920" height="104" fill="#fff"/>
  <circle cx="140" cy="${672 + i * 130}" r="22" fill="#1F9D63"/>
  <text x="190" y="${686 + i * 130}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="34" font-weight="700" fill="${INK}">${esc(l)}</text>`).join('\n')}
  <text x="80" y="1250" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="34" font-weight="600" fill="${MUTED}">${isTerms ? 'Tap the link to read · reply AGREE to accept' : isAgent ? 'Tap the link below to open the full guide' : 'Tap the link to read · reply AGREE to accept'}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ---------------------------------------------------------------------------
// Cached document store (settings change → new cache key)
const cache = new Map();
async function getDocument(name, settings = {}) {
  const key = `${name}:${JSON.stringify([settings.lister_fee, settings.agent_fee, settings.pay_to])}`;
  if (cache.has(key)) return cache.get(key);
  let out;
  if (name === 'lister_terms_pdf') out = { type: 'application/pdf', body: await buildListerTermsPdf(settings) };
  else if (name === 'agent_guide_pdf') out = { type: 'application/pdf', body: await buildAgentGuidePdf(settings) };
  else if (name === 'agent_terms_pdf') out = { type: 'application/pdf', body: await buildAgentTermsPdf(settings) };
  else if (name === 'agent_terms_cover') out = { type: 'image/png', body: await buildCoverPng('agent_terms', settings) };
  else if (name === 'lister_terms_cover') out = { type: 'image/png', body: await buildCoverPng('lister_terms', settings) };
  else if (name === 'agent_guide_cover') out = { type: 'image/png', body: await buildCoverPng('agent_guide', settings) };
  else return null;
  if (cache.size > 20) cache.clear();
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// WhatsApp wording
function listerTermsMessage(settings = {}, { name = '' } = {}) {
  const s = settingsDefaults(settings);
  const urls = docUrls('lister_terms');
  return [
    `📄 *One last step${name ? `, ${name}` : ''} — our terms*`,
    '',
    `• Your first *${s.freeDays} days are free*.`,
    `• After that it is *${ugx(s.listerMonthly)} per listing, per month (VAT incl.)* to stay live. We'll remind you before the free week ends — nothing is charged automatically.`,
    '• Your ID is only for checking — it is *never shown* to anyone.',
    '• makaug advertises your property; the deal itself is between you and the buyer or tenant.',
    '',
    `Read the full terms (PDF): ${urls.pdf}`,
    '',
    'Reply *AGREE* to accept and send your property for review, or *NO* if you don\'t want to continue.'
  ].join('\n');
}

function agentTermsCaption({ name = '' } = {}) {
  const urls = docUrls('agent_terms');
  return [
    `📄 *One last step${name ? `, ${name}` : ''} — your agent terms*`,
    '',
    '• It covers how makaug works for agents, the plan and your listings.',
    '• makaug takes no commission and is never part of your deal.',
    '• Your ID is only for checking — it is never shown to anyone.',
    '',
    `Read the full terms (PDF): ${urls.pdf}`,
    '',
    'Reply *AGREE* to accept them.'
  ].join('\n');
}

function agentGuideCaption({ name = '' } = {}) {
  const urls = docUrls('agent_guide');
  return [
    `📘 *Your makaug agent guide${name ? `, ${name}` : ''}*`,
    'How to post, how enquiries reach you, and how your subscription works — all on 2 pages.',
    '',
    `Open the PDF: ${urls.pdf}`
  ].join('\n');
}

module.exports = {
  LISTER_TERMS_VERSION,
  AGENT_GUIDE_VERSION,
  AGENT_TERMS_VERSION,
  agentTermsCaption,
  docUrls,
  getDocument,
  buildListerTermsPdf,
  buildAgentGuidePdf,
  buildAgentTermsPdf,
  buildCoverPng,
  listerTermsMessage,
  agentGuideCaption
};
