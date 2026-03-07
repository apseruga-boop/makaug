const express = require('express');
const db = require('../config/database');
const smsService = require('../models/smsService');
const logger = require('../config/logger');
const { DISTRICTS } = require('../utils/constants');

const router = express.Router();
const HOME_URL = (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');

// Language Translations
const T = {
  en: {
    welcome: "🏠 Welcome to *MakayUg* - Uganda's free property platform!\n\nWhat would you like to do?\n1️⃣ List my property\n2️⃣ Search for a property\n3️⃣ Find an agent\n\nReply with 1, 2, or 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    askListingType: '🏠 What are you listing?\n1️⃣ House/Property for SALE\n2️⃣ House/Property for RENT\n3️⃣ Land/Plot\n4️⃣ Student accommodation\n5️⃣ Commercial property',
    askOwnership: '✅ Are you the owner of this property, or an agent listing on behalf of an owner?\n1️⃣ I am the owner\n2️⃣ I am a registered agent',
    askTitle: '✏️ Give your property a short title (e.g. "3-bedroom house in Ntinda Kampala"):',
    askDistrict: '📍 Which district is the property in? (e.g. Kampala, Wakiso, Mukono, Jinja...)',
    askArea: '🗺️ What area or neighbourhood? (e.g. Kololo, Ntinda, Bugolobi...)',
    askPrice: '💰 What is your asking price in Uganda Shillings? (numbers only, e.g. 250000000)',
    askBedrooms: '🛏 How many bedrooms does the property have? (Enter a number, or 0 if N/A)',
    askDescription: '📝 Describe your property in a few sentences (location, features, condition...)',
    askPhotos: '📸 Please send your property photos one by one. When done, type *DONE*\n\n📌 Include: front of building, sitting room, bedroom(s), kitchen, bathroom',
    askIDNumber: '🪪 For security, we need your National ID Number (NIN). This is required to prevent fraud and will not be publicly shown.\n\nPlease type your NIN:',
    askSelfie: '🤳 Please take a clear selfie (photo of yourself) holding your National ID card and send it here. This verifies you are real and reduces fraud.',
    askPhone: '📱 What is your mobile phone number (for verification)?\nFormat: +256 7XX XXX XXX',
    otpSent: "📲 We've sent a 6-digit code to your phone via SMS. Please type that code here to verify:",
    listingSubmitted: "🎉 *Your listing has been submitted!*\n\nOur team will review it and make it live within 24 hours.\n\n🔗 You'll receive a link to your listing once approved.\n\nReference: #{ref}\n\nThank you for using MakayUg! 🏠🇺🇬",
    invalidInput: "❓ Sorry, I didn't understand that. Please reply with one of the options above.",
    verifyOTP: 'Please type the 6-digit code we sent via SMS:',
    otpSuccess: '✅ Phone verified!',
    otpFailed: '❌ Incorrect code. Please try again or type RESEND for a new code.',
    askDeposit: '💵 What is the deposit amount required? (in UGX, numbers only)',
    askContract: '📅 What is the minimum contract length in months? (e.g. 6, 12, 24)',
    askUniversity: '🎓 Which is the nearest university? (e.g. Makerere, Kyambogo, UCU...)',
    askDistance: '🚶 How far is the property from the university (in km)? (e.g. 0.5, 1, 2)',
    askSearchType: '🔎 Onoonya ki?\n1️⃣ Ebitundibwa\n2️⃣ Ezikodizibwa\n3️⃣ Ttaka\n4️⃣ Obutuuze bw\'abayiizi\n5️⃣ Ebyobusuubuzi\n6️⃣ Byonna',
    askSearchArea: '📍 Wandiika ekitundu oba district gy\'onoonya (nga Ntinda, Kampala, Wakiso):',
    searchNoResults: 'Tewali listings ezikkiriziddwa ezifaanana n\'onoonyezza wo kati.',
    askAgentArea: '👔 Weetaaga agent mu district oba kitundu ki? (nga Kampala, Wakiso, Mbarara)',
    noAgentsFound: 'Tefunye ba agent abakakasiddwa mu kitundu ekyo kati.',
    menuHint: 'Wandiika MENU buli kiseera okudda ku menu enkulu.',
    languageUpdated: '✅ Lugha imebadilishwa.',
    restarted: '🔄 Session imeanza upya.',
    searchHeader: 'Eby\'ennyumba ebisinga okukwatagana',
    agentHeader: 'Ba agent abakakasiddwa',
    titleTooShort: 'Title is too short. Please give a descriptive title.',
    invalidPrice: '❌ Please enter a valid price in UGX (numbers only, e.g. 250000000)',
    descriptionTooShort: 'Please write a longer description (at least 10 characters).',
    needAtLeastOnePhoto: '❌ Please send at least 1 photo before typing DONE.',
    photosUploaded: "📸 You've uploaded {count} photos. Type *DONE* to continue.",
    photoReceived: '✅ Photo {count} received! Send more photos or type *DONE* when finished.',
    invalidNin: '❌ Please enter a valid National ID Number (NIN).',
    sendSelfiePhotoOnly: '❌ Please send a photo (selfie) - not text.',
    invalidPhone: '❌ Invalid phone format. Try: +256 770 646 879',
    visitMoreListings: 'Visit {url} for more listings.',
    seeAllAgents: 'See all agents: {url}',
    replySearchAgain: 'Reply 2 to search again.',
    replyAgentAgain: 'Reply 3 to find another agent.',
    areasLabel: 'Areas',
    ratingLabel: 'Rating',
    callLabel: 'Call',
    whatsappLabel: 'WhatsApp',
    profileLabel: 'Profile',
    typeSale: 'For Sale',
    typeRent: 'To Rent',
    typeLand: 'Land',
    typeStudent: 'Student',
    typeCommercial: 'Commercial',
    typeAny: 'Any',
    genericSaveError: '❌ Something went wrong saving your listing. Please try again or visit {url}',
    genericWebhookError: 'Sorry, something went wrong. Please try again or visit {url}'
  },
  lg: {
    welcome: "🏠 Tukusuubiza ku *MakayUg* - eyitwa wangu ya property mu Uganda!\n\nOyagala kukola ki?\n1️⃣ Okwetayirira eby'ensi byange\n2️⃣ Okunoonyereza ensi\n3️⃣ Okunoonya musomesa\n\nSuula 1, 2 oba 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    askListingType: "🏠 Kyoyetaagadde okutereka kya ki?\n1️⃣ Enju/Ensi okutunda\n2️⃣ Enju okusasula\n3️⃣ Ttaka\n4️⃣ Eby'okulala by'abayizi\n5️⃣ Ensi ez'ebikolwa",
    askOwnership: "✅ Ggwe nnyini ensi ono oba agent?\n1️⃣ Nze nnyini\n2️⃣ Nze agent",
    askTitle: '✏️ Nyumba yoyo ejjiire etya? (e.g. "Enyumba esatu Ntinda Kampala"):',
    askDistrict: '📍 Ensi eno eri mu kitundu ki? (e.g. Kampala, Wakiso, Mukono...)',
    askArea: '🗺️ Ekitundu ekitonotono ki? (e.g. Kololo, Ntinda, Bugolobi...)',
    askPrice: '💰 Ebbeeyi yayo mu Shillingi za Uganda bwoba nyo? (ennamba zokka)',
    askBedrooms: "🛏 Eddiini ezingaana? (Okwandika ennamba, oba 0 bw'etaba)",
    askDescription: '📝 Teeka ennukuta ntono ku ensi eno (otuutu, ebintu, embeera...)',
    askPhotos: "📸 Tuma amawanika go buli kimu buli kimu. Bw'osaaze, wandika *DONE*",
    askIDNumber: '🪪 Kwa nteekateeka, tukeetaaga NIN yo (National ID Number). Ejja kutuzikirira bukyamu.',
    askSelfie: "🤳 Weereza selfie (ekifaananyi kyo) ng'oyita NIN yo.",
    askPhone: '📱 Enamba yaffe ya simu (okukakasa)?\nFomati: +256 7XX XXX XXX',
    otpSent: '📲 Tukusindise koodi ku simu yo nga SMS. Wandika koodi eyo eri wano:',
    listingSubmitted: "🎉 *Ensi yo eterekedwa!*\n\nTeemu yaffe eya kulabirira era ejja kuterekedwa mu saawa 24.\n\nReference: #{ref}\n\nWebale okozesa MakayUg! 🏠🇺🇬",
    invalidInput: "❓ Simanyi. Ddamu n'okusooka okwandika.",
    otpSuccess: '✅ Simu kakasibwa!',
    otpFailed: '❌ Koodi si yo. Gezaayo oba wandika RESEND.',
    askDeposit: '💵 Obuwanguzi bwengaana mu UGX?',
    askContract: "📅 Edda ly'endagaano ntono bwengaana (mu myezi)?",
    askUniversity: '🎓 Yunivasite eyegenderako gye?',
    askDistance: '🚶 Mulenda gwa emiita mingaana ukola nga oyebase? (km)',
    askSearchType: '🔎 Onoonya ki?\n1️⃣ Ebitundibwa\n2️⃣ Ezikodizibwa\n3️⃣ Ttaka\n4️⃣ Obutuuze bw\'abayiizi\n5️⃣ Ebyobusuubuzi\n6️⃣ Byonna',
    askSearchArea: '📍 Wandiika ekitundu oba district gy\'onoonya (nga Ntinda, Kampala, Wakiso):',
    searchNoResults: 'Tewali listings ezikkiriziddwa ezifaanana n\'onoonyezza wo kati.',
    askAgentArea: '👔 Weetaaga agent mu district oba kitundu ki? (nga Kampala, Wakiso, Mbarara)',
    noAgentsFound: 'Tefunye ba agent abakakasiddwa mu kitundu ekyo kati.',
    menuHint: 'Wandiika MENU buli kiseera okudda ku menu enkulu.',
    languageUpdated: '✅ Olulimi luhinduddwa.',
    restarted: '🔄 Session etandise bupya.',
    searchHeader: 'Eby\'ennyumba ebisinga okukwatagana',
    agentHeader: 'Ba agent abakakasiddwa',
    titleTooShort: 'Omutwe mumpi nnyo. Wandiika omutwe ogutegeerekeka bulungi.',
    invalidPrice: '❌ Teeka ebbeeyi entuufu mu UGX (ennamba zokka, ex: 250000000).',
    descriptionTooShort: 'Wandiika ennyinyonnyola empanvu katono (waakiri ennukuta 10).',
    needAtLeastOnePhoto: '❌ Weereza waakiri ekifaananyi kimu nga tonnawandiika DONE.',
    photosUploaded: '📸 Ofunye ebifaananyi {count}. Wandiika *DONE* okweyongerayo.',
    photoReceived: '✅ Ekifaananyi {count} kifuniddwa! Weereza ebirala oba wandiike *DONE*.',
    invalidNin: '❌ NIN gyotadde si ntuufu. Gezaako nate.',
    sendSelfiePhotoOnly: '❌ Weereza ekifaananyi (selfie), si bubaka bwa nnukuta.',
    invalidPhone: '❌ Namba ya ssimu si ntuufu. Geza: +256 770 646 879',
    visitMoreListings: 'Laba ebisingawo ku {url}.',
    seeAllAgents: 'Laba ba agent bonna: {url}',
    replySearchAgain: 'Ddamu 2 okunoonya nate.',
    replyAgentAgain: 'Ddamu 3 okunoonya agent omulala.',
    areasLabel: 'Bitundu',
    ratingLabel: 'Okuteesa',
    callLabel: 'Kuba essimu',
    whatsappLabel: 'WhatsApp',
    profileLabel: 'Profile',
    typeSale: 'Kutunda',
    typeRent: 'Kukodisa',
    typeLand: 'Ttaka',
    typeStudent: 'Abayizi',
    typeCommercial: 'Byobusuubuzi',
    typeAny: 'Byonna',
    genericSaveError: '❌ Wabaddewo ensobi mu kutereka listing yo. Gezaako nate oba genda ku {url}',
    genericWebhookError: 'Wabaddewo ensobi. Gezaako nate oba genda ku {url}'
  },
  sw: {
    welcome: '🏠 Karibu *MakayUg* - Jukwaa la bure la mali Uganda!\n\nUnataka kufanya nini?\n1️⃣ Orodhesha mali yangu\n2️⃣ Tafuta mali\n3️⃣ Pata wakala\n\nJibu 1, 2 au 3',
    askListingType: '🏠 Unaorodhesha nini?\n1️⃣ Nyumba/Mali ya KUUZA\n2️⃣ Nyumba/Mali ya KUKODISHA\n3️⃣ Ardhi/Kiwanja\n4️⃣ Malazi ya wanafunzi\n5️⃣ Mali ya biashara',
    askTitle: '✏️ Toa kichwa kifupi cha mali yako:',
    askDistrict: '📍 Wilaya ipi? (mf. Kampala, Wakiso, Mukono...)',
    askArea: '🗺️ Mtaa au eneo gani?',
    askPrice: '💰 Bei gani kwa Shilingi za Uganda? (nambari tu)',
    askPhotos: '📸 Tuma picha za mali yako moja moja. Ukimaliza, andika *DONE*',
    listingSubmitted: '🎉 *Mali yako imewasilishwa!*\n\nRef: #{ref}\n\nAsante kwa kutumia MakayUg! 🏠🇺🇬',
    invalidInput: '❓ Sijaelewa. Tafadhali jibu kwa mojawapo ya chaguo.',
    otpSent: '📲 Tumetuma nambari ya siri kwa SMS yako. Andika hapa:',
    otpSuccess: '✅ Nambari ya simu imethibitishwa!',
    otpFailed: '❌ Nambari si sahihi. Jaribu tena.',
    askSearchType: '🔎 Unatafuta nini?\n1️⃣ Ya kuuza\n2️⃣ Ya kupangisha\n3️⃣ Ardhi\n4️⃣ Makazi ya wanafunzi\n5️⃣ Biashara\n6️⃣ Mali yoyote',
    askSearchArea: '📍 Andika eneo, wilaya au mahali unapotafuta (mf. Ntinda, Kampala, Wakiso):',
    searchNoResults: 'Hakuna mali iliyoidhinishwa inayolingana na utafutaji wako sasa.',
    askAgentArea: '👔 Unahitaji wakala katika wilaya/eneo gani? (mf. Kampala, Wakiso, Mbarara)',
    noAgentsFound: 'Hakuna mawakala waliothibitishwa waliopatikana eneo hilo kwa sasa.',
    menuHint: 'Andika MENU wakati wowote kurudi kwenye menyu kuu.',
    languageUpdated: '✅ Language updated.',
    restarted: '🔄 Session restarted.',
    searchHeader: 'Mali zinazolingana zaidi',
    agentHeader: 'Mawakala waliothibitishwa',
    titleTooShort: 'Kichwa ni kifupi sana. Tafadhali andika kichwa kinachoeleweka.',
    invalidPrice: '❌ Tafadhali weka bei sahihi ya UGX (nambari pekee, mfano 250000000).',
    descriptionTooShort: 'Tafadhali andika maelezo marefu kidogo (angalau herufi 10).',
    needAtLeastOnePhoto: '❌ Tafadhali tuma angalau picha 1 kabla ya kuandika DONE.',
    photosUploaded: '📸 Umepakia picha {count}. Andika *DONE* kuendelea.',
    photoReceived: '✅ Picha {count} imepokelewa! Tuma nyingine au andika *DONE*.',
    invalidNin: '❌ Tafadhali andika NIN sahihi.',
    sendSelfiePhotoOnly: '❌ Tafadhali tuma picha (selfie), si maandishi.',
    invalidPhone: '❌ Namba ya simu si sahihi. Jaribu: +256 770 646 879',
    visitMoreListings: 'Tembelea {url} kuona mali zaidi.',
    seeAllAgents: 'Tazama mawakala wote: {url}',
    replySearchAgain: 'Jibu 2 kutafuta tena.',
    replyAgentAgain: 'Jibu 3 kutafuta wakala mwingine.',
    areasLabel: 'Maeneo',
    ratingLabel: 'Ukadiriaji',
    callLabel: 'Piga simu',
    whatsappLabel: 'WhatsApp',
    profileLabel: 'Wasifu',
    typeSale: 'Ya kuuza',
    typeRent: 'Ya kupangisha',
    typeLand: 'Ardhi',
    typeStudent: 'Wanafunzi',
    typeCommercial: 'Biashara',
    typeAny: 'Yoyote',
    genericSaveError: '❌ Hitilafu imetokea wakati wa kuhifadhi tangazo lako. Jaribu tena au tembelea {url}',
    genericWebhookError: 'Samahani, hitilafu imetokea. Jaribu tena au tembelea {url}'
  },
  ac: {
    welcome: "🏠 Itye ber i *MakayUg* — kabedo me free property i Uganda!\n\nIn mito timo ngo?\n1️⃣ Keto ot megi\n2️⃣ Yeny ot\n3️⃣ Nong agent\n\nDwog 1, 2 onyo 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    invalidInput: '❓ Pe atamo. Tim ber idwog ki namba me ayero.',
    languageUpdated: '✅ Dhok ma idiyo olokke.',
    restarted: '🔄 Session ocake manyen.'
  },
  ny: {
    welcome: "🏠 Kaza omu *MakayUg* — ahari free property platform ya Uganda!\n\nNoyenda kukora ki?\n1️⃣ Kuteeka property yangye\n2️⃣ Kushangisa property\n3️⃣ Kushanga agent\n\nGarukamu 1, 2 nari 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    invalidInput: '❓ Tinkyetegire. Garukamu namba emwe omu zirikurondorwa.',
    languageUpdated: '✅ Orurimi ruhindukire.',
    restarted: '🔄 Session etandikire bupya.'
  },
  rn: {
    welcome: "🏠 Kaze kuri *MakayUg* — urubuga rw'ubuntu rw'imitungo muri Uganda!\n\nUshaka gukora iki?\n1️⃣ Kwandikisha umutungo\n2️⃣ Gushaka umutungo\n3️⃣ Gushaka agent\n\nSubiza 1, 2 canke 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    invalidInput: '❓ Sinabitahura. Subiza nimero iri hejuru.',
    languageUpdated: '✅ Ururimi rwahinduwe.',
    restarted: '🔄 Session yatanguye bundi bushya.'
  },
  sm: {
    welcome: "🏠 Mirembe ku *MakayUg* — urubuga rwa property olwa bwerere mu Uganda!\n\nOyagala okukola ki?\n1️⃣ Okuteeka property yange\n2️⃣ Okunoonya property\n3️⃣ Okunoonya agent\n\nDdamu 1, 2 oba 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    invalidInput: '❓ Tebinnyonnyodde bulungi. Ddamu namba emu ku ziri waggulu.',
    languageUpdated: '✅ Olulimi luhinduddwa.',
    restarted: '🔄 Session etandise bupya.'
  },
};

// Get translation (fallback to English)
function t(lang, key) {
  return (T[lang] && T[lang][key]) || T.en[key] || key;
}

function tt(lang, key, vars = {}) {
  let msg = t(lang, key);
  Object.entries(vars).forEach(([k, v]) => {
    msg = msg.replaceAll(`{${k}}`, String(v));
  });
  return msg;
}

function normalizeInput(value) {
  return String(value || '').trim();
}

function normUpper(value) {
  return normalizeInput(value).toUpperCase();
}

function mapListingTypeInput(input) {
  const key = normalizeInput(input).toLowerCase();
  const map = {
    '1': 'sale',
    '2': 'rent',
    '3': 'land',
    '4': 'student',
    '5': 'commercial',
    sale: 'sale',
    rent: 'rent',
    land: 'land',
    student: 'student',
    students: 'student',
    commercial: 'commercial'
  };
  return map[key] || null;
}

function mapSearchTypeInput(input) {
  const key = normalizeInput(input).toLowerCase();
  const map = {
    '1': 'sale',
    '2': 'rent',
    '3': 'land',
    '4': 'student',
    '5': 'commercial',
    '6': 'any',
    any: 'any',
    all: 'any',
    sale: 'sale',
    rent: 'rent',
    land: 'land',
    student: 'student',
    students: 'student',
    commercial: 'commercial'
  };
  return map[key] || null;
}

function typeLabel(type, lang) {
  const map = {
    sale: 'typeSale',
    rent: 'typeRent',
    land: 'typeLand',
    student: 'typeStudent',
    commercial: 'typeCommercial',
    any: 'typeAny'
  };
  return t(lang, map[type] || type);
}

function formatPrice(price, period) {
  if (!price || Number.isNaN(Number(price))) return 'Price on request';
  const v = Number(price);
  if (v >= 1_000_000_000) {
    return `USh ${(v / 1_000_000_000).toFixed(1)}B${period ? `/${period}` : ''}`;
  }
  if (v >= 1_000_000) {
    return `USh ${(v / 1_000_000).toFixed(0)}M${period ? `/${period}` : ''}`;
  }
  return `USh ${v.toLocaleString()}${period ? `/${period}` : ''}`;
}

async function issueOtp(phone) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  await db.query(
    "UPDATE otps SET used = TRUE WHERE phone = $1 AND purpose = 'verify' AND used = FALSE",
    [phone]
  );

  await db.query(
    "INSERT INTO otps (phone, code, purpose, expires_at) VALUES ($1, $2, 'verify', NOW() + INTERVAL '10 minutes')",
    [phone, otp]
  );

  try {
    await smsService.sendSMS(phone, `MakayUg listing verification: ${otp}. Valid 10 mins. Do not share.`);
  } catch (e) {
    logger.error('OTP SMS failed:', e.message);
  }
}

// Session helpers
async function getSession(phone) {
  const r = await db.query('SELECT * FROM whatsapp_sessions WHERE phone = $1', [phone]);
  if (r.rows.length) return r.rows[0];

  const newSession = await db.query(
    `INSERT INTO whatsapp_sessions (phone, current_step, language, listing_draft, session_data)
     VALUES ($1, 'greeting', 'en', '{}', '{}') RETURNING *`,
    [phone]
  );
  return newSession.rows[0];
}

async function updateSession(phone, updates) {
  if (!updates || !Object.keys(updates).length) return;

  const fields = Object.entries(updates).map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values = Object.values(updates);
  await db.query(
    `UPDATE whatsapp_sessions SET ${fields}, last_message_at = NOW() WHERE phone = $1`,
    [phone, ...values]
  );
}

async function patchDraft(phone, draftUpdate) {
  await db.query(
    `UPDATE whatsapp_sessions
     SET listing_draft = listing_draft || $1::jsonb, last_message_at = NOW()
     WHERE phone = $2`,
    [JSON.stringify(draftUpdate), phone]
  );
}

async function patchSessionData(phone, dataUpdate) {
  await db.query(
    `UPDATE whatsapp_sessions
     SET session_data = session_data || $1::jsonb, last_message_at = NOW()
     WHERE phone = $2`,
    [JSON.stringify(dataUpdate), phone]
  );
}

async function clearSessionData(phone) {
  await db.query(
    `UPDATE whatsapp_sessions
     SET listing_draft = '{}'::jsonb, session_data = '{}'::jsonb, last_message_at = NOW()
     WHERE phone = $1`,
    [phone]
  );
}

async function findPropertiesForWhatsapp(searchType, location) {
  const values = ['approved'];
  let where = 'WHERE status = $1';

  if (searchType && searchType !== 'any') {
    values.push(searchType);
    where += ` AND listing_type = $${values.length}`;
  }

  values.push(`%${location}%`);
  const likeIdx = values.length;
  where += ` AND (district ILIKE $${likeIdx} OR area ILIKE $${likeIdx} OR title ILIKE $${likeIdx})`;

  const result = await db.query(
    `SELECT id, title, listing_type, district, area, price, price_period
     FROM properties
     ${where}
     ORDER BY created_at DESC
     LIMIT 5`,
    values
  );

  return result.rows;
}

async function findAgentsForWhatsapp(location) {
  const q = `%${location}%`;
  const result = await db.query(
    `SELECT id, full_name, company_name, phone, whatsapp, rating, districts_covered
     FROM agents
     WHERE status = 'approved'
       AND (
         full_name ILIKE $1
         OR COALESCE(company_name, '') ILIKE $1
         OR EXISTS (
           SELECT 1 FROM unnest(districts_covered) d WHERE d ILIKE $1
         )
       )
     ORDER BY rating DESC NULLS LAST, created_at DESC
     LIMIT 5`,
    [q]
  );

  return result.rows;
}

function formatPropertySearchMessage(lang, rows, location, searchType) {
  const lines = [];
  lines.push(`🔎 *${t(lang, 'searchHeader')}* (${typeLabel(searchType, lang)} • ${location})`);
  lines.push('');
  rows.forEach((r, idx) => {
    lines.push(`${idx + 1}. *${r.title}*`);
    lines.push(`   ${typeLabel(r.listing_type, lang)} • ${r.area}, ${r.district}`);
    lines.push(`   ${formatPrice(r.price, r.price_period)}`);
    lines.push(`   ${HOME_URL}/property/${r.id}`);
    lines.push('');
  });
  lines.push(t(lang, 'menuHint'));
  lines.push(t(lang, 'replySearchAgain'));
  return lines.join('\n');
}

function formatAgentSearchMessage(lang, rows, location) {
  const lines = [];
  lines.push(`👔 *${t(lang, 'agentHeader')}* (${location})`);
  lines.push('');
  rows.forEach((r, idx) => {
    const areas = Array.isArray(r.districts_covered) ? r.districts_covered.join(', ') : '';
    lines.push(`${idx + 1}. *${r.full_name}*${r.company_name ? ` - ${r.company_name}` : ''}`);
    if (areas) lines.push(`   ${t(lang, 'areasLabel')}: ${areas}`);
    if (r.rating != null) lines.push(`   ${t(lang, 'ratingLabel')}: ⭐ ${Number(r.rating).toFixed(1)}`);
    if (r.phone) lines.push(`   ${t(lang, 'callLabel')}: ${r.phone}`);
    if (r.whatsapp) lines.push(`   ${t(lang, 'whatsappLabel')}: https://wa.me/${String(r.whatsapp).replace(/\D/g, '')}`);
    lines.push(`   ${t(lang, 'profileLabel')}: ${HOME_URL}/agents/${r.id}`);
    lines.push('');
  });
  lines.push(t(lang, 'menuHint'));
  lines.push(t(lang, 'replyAgentAgain'));
  return lines.join('\n');
}

// Step machine
const STEPS = [
  'greeting', 'choose_language', 'main_menu', 'listing_type', 'ownership', 'title', 'district',
  'area', 'price', 'bedrooms', 'description', 'photos', 'ask_deposit', 'ask_contract',
  'ask_university', 'ask_distance', 'ask_id_number', 'ask_selfie', 'ask_phone', 'search_type',
  'search_area', 'agent_area',
  'verify_otp', 'submitted'
];

async function processMessage(phone, body, mediaUrl) {
  const session = await getSession(phone);
  const lang = session.language || 'en';
  const step = session.current_step;
  const draft = session.listing_draft || {};
  const sessionData = session.session_data || {};
  const cleanBody = normalizeInput(body);
  const bodyUpper = normUpper(body);

  const respond = (msg, nextStep) => ({ message: msg, nextStep });

  if (!STEPS.includes(step)) {
    await updateSession(phone, { current_step: 'greeting' });
    return respond(t(lang, 'chooseLanguage'), 'choose_language');
  }

  if (bodyUpper === 'RESET' || bodyUpper === 'START') {
    await clearSessionData(phone);
    return respond(`${t(lang, 'restarted')}\n\n${t(lang, 'chooseLanguage')}`, 'choose_language');
  }

  if (bodyUpper === 'LANG' || bodyUpper === 'LANGUAGE') {
    return respond(`${t(lang, 'languageUpdated')}\n\n${t(lang, 'chooseLanguage')}`, 'choose_language');
  }

  if (bodyUpper === 'MENU' || bodyUpper === 'HOME') {
    return respond(t(lang, 'welcome'), 'main_menu');
  }

  // GREETING
  if (step === 'greeting') {
    return respond(t(lang, 'chooseLanguage'), 'choose_language');
  }

  // CHOOSE LANGUAGE
  if (step === 'choose_language') {
    const langMap = { '1': 'en', '2': 'lg', '3': 'sw', '4': 'ac', '5': 'ny', '6': 'rn', '7': 'sm' };
    const chosen = langMap[cleanBody] || 'en';
    await updateSession(phone, { language: chosen });
    await clearSessionData(phone);
    return respond(t(chosen, 'welcome'), 'main_menu');
  }

  // MAIN MENU
  if (step === 'main_menu') {
    if (cleanBody === '1') return respond(t(lang, 'askListingType'), 'listing_type');
    if (cleanBody === '2') return respond(t(lang, 'askSearchType'), 'search_type');
    if (cleanBody === '3') return respond(t(lang, 'askAgentArea'), 'agent_area');
    if (cleanBody === '9') return respond(t(lang, 'chooseLanguage'), 'choose_language');
    return respond(t(lang, 'invalidInput') + '\n\n' + t(lang, 'welcome'), 'main_menu');
  }

  // SEARCH TYPE
  if (step === 'search_type') {
    const searchType = mapSearchTypeInput(cleanBody);
    if (!searchType) return respond(`${t(lang, 'invalidInput')}\n\n${t(lang, 'askSearchType')}`, 'search_type');
    await patchSessionData(phone, { search_type: searchType });
    return respond(t(lang, 'askSearchArea'), 'search_area');
  }

  // SEARCH AREA
  if (step === 'search_area') {
    if (cleanBody.length < 2) return respond(t(lang, 'askSearchArea'), 'search_area');

    const searchType = sessionData.search_type || 'any';
    const rows = await findPropertiesForWhatsapp(searchType, cleanBody);

    if (!rows.length) {
      return respond(
        `${t(lang, 'searchNoResults')}\n\n${tt(lang, 'visitMoreListings', { url: HOME_URL })}\n${t(lang, 'menuHint')}`,
        'main_menu'
      );
    }

    return respond(formatPropertySearchMessage(lang, rows, cleanBody, searchType), 'main_menu');
  }

  // AGENT AREA SEARCH
  if (step === 'agent_area') {
    if (cleanBody.length < 2) return respond(t(lang, 'askAgentArea'), 'agent_area');

    const rows = await findAgentsForWhatsapp(cleanBody);
    if (!rows.length) {
      return respond(
        `${t(lang, 'noAgentsFound')}\n\n${tt(lang, 'seeAllAgents', { url: `${HOME_URL}/#page-brokers` })}\n${t(lang, 'menuHint')}`,
        'main_menu'
      );
    }

    return respond(formatAgentSearchMessage(lang, rows, cleanBody), 'main_menu');
  }

  // LISTING TYPE
  if (step === 'listing_type') {
    const chosen = mapListingTypeInput(cleanBody);
    if (!chosen) return respond(t(lang, 'invalidInput') + '\n\n' + t(lang, 'askListingType'), 'listing_type');
    await patchDraft(phone, { listing_type: chosen });
    return respond(t(lang, 'askOwnership'), 'ownership');
  }

  // OWNERSHIP
  if (step === 'ownership') {
    const ownerMap = { '1': 'owner', '2': 'agent', owner: 'owner', agent: 'agent' };
    const chosen = ownerMap[cleanBody.toLowerCase()];
    if (!chosen) return respond(t(lang, 'invalidInput') + '\n\n' + t(lang, 'askOwnership'), 'ownership');
    await patchDraft(phone, { lister_type: chosen });
    return respond(t(lang, 'askTitle'), 'title');
  }

  // TITLE
  if (step === 'title') {
    if (cleanBody.length < 5) return respond(t(lang, 'titleTooShort'), 'title');
    await patchDraft(phone, { title: cleanBody });
    return respond(t(lang, 'askDistrict'), 'district');
  }

  // DISTRICT
  if (step === 'district') {
    const districtCandidate = DISTRICTS.find((d) => d.toLowerCase() === cleanBody.toLowerCase());
    await patchDraft(phone, { district: districtCandidate || cleanBody });
    return respond(t(lang, 'askArea'), 'area');
  }

  // AREA
  if (step === 'area') {
    await patchDraft(phone, { area: cleanBody });
    return respond(t(lang, 'askPrice'), 'price');
  }

  // PRICE
  if (step === 'price') {
    const price = parseInt(cleanBody.replace(/[^0-9]/g, ''), 10);
    if (!price || price < 10000) return respond(t(lang, 'invalidPrice'), 'price');
    await patchDraft(phone, { price });

    if (draft.listing_type === 'rent') return respond(t(lang, 'askDeposit'), 'ask_deposit');
    if (draft.listing_type === 'student') return respond(t(lang, 'askUniversity'), 'ask_university');
    return respond(t(lang, 'askBedrooms'), 'bedrooms');
  }

  // DEPOSIT (rent)
  if (step === 'ask_deposit') {
    const deposit = parseInt(cleanBody.replace(/[^0-9]/g, ''), 10);
    if (!deposit || deposit < 0) return respond(t(lang, 'askDeposit'), 'ask_deposit');
    await patchDraft(phone, { deposit_amount: deposit });
    return respond(t(lang, 'askContract'), 'ask_contract');
  }

  // CONTRACT
  if (step === 'ask_contract') {
    await patchDraft(phone, { contract_months: parseInt(cleanBody, 10) || 12 });
    return respond(t(lang, 'askBedrooms'), 'bedrooms');
  }

  // UNIVERSITY
  if (step === 'ask_university') {
    await patchDraft(phone, { nearest_university: cleanBody });
    return respond(t(lang, 'askDistance'), 'ask_distance');
  }

  // DISTANCE
  if (step === 'ask_distance') {
    await patchDraft(phone, { distance_to_uni_km: parseFloat(cleanBody) || 1 });
    return respond(t(lang, 'askBedrooms'), 'bedrooms');
  }

  // BEDROOMS
  if (step === 'bedrooms') {
    const bedrooms = parseInt(cleanBody, 10) || 0;
    await patchDraft(phone, { bedrooms });
    return respond(t(lang, 'askDescription'), 'description');
  }

  // DESCRIPTION
  if (step === 'description') {
    if (cleanBody.length < 10) return respond(t(lang, 'descriptionTooShort'), 'description');
    await patchDraft(phone, { description: cleanBody });
    return respond(t(lang, 'askPhotos'), 'photos');
  }

  // PHOTOS
  if (step === 'photos') {
    if (bodyUpper === 'DONE' && !mediaUrl) {
      const currentPhotos = draft.photos || [];
      if (!currentPhotos.length) return respond(t(lang, 'needAtLeastOnePhoto'), 'photos');
      return respond(t(lang, 'askIDNumber'), 'ask_id_number');
    }
    if (mediaUrl) {
      const photos = draft.photos || [];
      photos.push(mediaUrl);
      await patchDraft(phone, { photos });
      const count = photos.length;
      if (count >= 20) return respond(tt(lang, 'photosUploaded', { count }), 'photos');
      return respond(tt(lang, 'photoReceived', { count }), 'photos');
    }
    return respond(t(lang, 'invalidInput') + '\n\n' + t(lang, 'askPhotos'), 'photos');
  }

  // NATIONAL ID
  if (step === 'ask_id_number') {
    if (cleanBody.length < 6) return respond(t(lang, 'invalidNin'), 'ask_id_number');
    await patchDraft(phone, { national_id_number: cleanBody });
    return respond(t(lang, 'askSelfie'), 'ask_selfie');
  }

  // SELFIE
  if (step === 'ask_selfie') {
    if (!mediaUrl) return respond(t(lang, 'sendSelfiePhotoOnly'), 'ask_selfie');
    await patchDraft(phone, { selfie_url: mediaUrl });
    return respond(t(lang, 'askPhone'), 'ask_phone');
  }

  // PHONE
  if (step === 'ask_phone') {
    const cleanPhone = cleanBody.replace(/\s/g, '');
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) return respond(t(lang, 'invalidPhone'), 'ask_phone');
    await patchDraft(phone, { owner_phone: cleanPhone });

    await issueOtp(cleanPhone);

    return respond(t(lang, 'otpSent'), 'verify_otp');
  }

  // VERIFY OTP
  if (step === 'verify_otp') {
    if (bodyUpper === 'RESEND') {
      const ownerPhone = draft.owner_phone || phone;
      await issueOtp(ownerPhone);
      return respond(t(lang, 'otpSent'), 'verify_otp');
    }

    const ownerPhone = draft.owner_phone || phone;
    const otpResult = await db.query(
      "SELECT * FROM otps WHERE phone = $1 AND code = $2 AND purpose = 'verify' AND used = FALSE AND expires_at > NOW() LIMIT 1",
      [ownerPhone, cleanBody]
    );

    if (!otpResult.rows.length) return respond(t(lang, 'otpFailed'), 'verify_otp');

    await db.query('UPDATE otps SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);

    // SUBMIT LISTING
    try {
      const d = draft;
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      const result = await db.query(
        `INSERT INTO properties (
          listing_type, title, description, district, area, price,
          deposit_amount, contract_months, bedrooms,
          nearest_university, distance_to_uni_km,
          lister_phone, lister_type,
          status, listed_via, source, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending','whatsapp','whatsapp',$14)
        RETURNING id`,
        [
          d.listing_type, d.title, d.description, d.district, d.area, d.price,
          d.deposit_amount || null, d.contract_months || null, d.bedrooms || null,
          d.nearest_university || null, d.distance_to_uni_km || null,
          d.owner_phone || null, d.lister_type || 'owner',
          expiresAt
        ]
      );

      const propertyId = result.rows[0].id;
      const refCode = String(propertyId).substring(0, 8).toUpperCase();

      if (d.photos && d.photos.length) {
        for (let i = 0; i < d.photos.length; i += 1) {
          await db.query(
            'INSERT INTO property_images (property_id, url, is_primary, sort_order) VALUES ($1, $2, $3, $4)',
            [propertyId, d.photos[i], i === 0, i]
          );
        }
      }

      await db.query(
        "UPDATE whatsapp_sessions SET current_step = 'submitted', listing_draft = '{}', session_data = '{}' WHERE phone = $1",
        [phone]
      );

      const msg = t(lang, 'listingSubmitted').replace('#{ref}', refCode);
      return respond(`${msg}\n\n🔗 Once approved: ${HOME_URL}/property/${propertyId}`, 'submitted');
    } catch (err) {
      logger.error('WhatsApp listing save error:', err);
      return respond(tt(lang, 'genericSaveError', { url: HOME_URL }), 'submitted');
    }
  }

  // SUBMITTED (restart)
  if (step === 'submitted') {
    await clearSessionData(phone);
    return respond(t(lang, 'welcome'), 'main_menu');
  }

  return respond(t(lang, 'invalidInput'), step);
}

// POST /api/whatsapp/webhook
// Twilio WhatsApp webhook
router.post('/webhook', async (req, res) => {
  const { From, Body, MediaUrl0, NumMedia } = req.body;

  if (!From) return res.status(400).send('Missing From');

  const phone = From.replace('whatsapp:', '');
  const body = (Body || '').trim();
  const mediaUrl = NumMedia && parseInt(NumMedia, 10) > 0 ? MediaUrl0 : null;

  logger.info(`WhatsApp message from ${phone}: "${body.substring(0, 50)}"${mediaUrl ? ' [media]' : ''}`);

  try {
    await getSession(phone);
    const { message, nextStep } = await processMessage(phone, body, mediaUrl);

    await updateSession(phone, { current_step: nextStep });

    const MessagingResponse = require('twilio').twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    twiml.message(message);

    res.type('text/xml');
    return res.send(twiml.toString());
  } catch (err) {
    logger.error('WhatsApp webhook error:', err);
    const MessagingResponse = require('twilio').twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    twiml.message(tt('en', 'genericWebhookError', { url: HOME_URL }));
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

// POST /api/whatsapp/test
// For testing in development
router.post('/test', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });

  const { phone = '+256770646879', body = '1', mediaUrl } = req.body;

  await getSession(phone);
  const result = await processMessage(phone, body, mediaUrl);
  await updateSession(phone, { current_step: result.nextStep });
  const session = await db.query('SELECT * FROM whatsapp_sessions WHERE phone = $1', [phone]);

  return res.json({
    botResponse: result.message,
    nextStep: result.nextStep,
    session: session.rows[0]
  });
});

// DELETE /api/whatsapp/reset
router.delete('/reset/:phone', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });
  await db.query('DELETE FROM whatsapp_sessions WHERE phone = $1', [req.params.phone]);
  return res.json({ reset: true });
});

module.exports = router;
