const express = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const smsService = require('../models/smsService');
const logger = require('../config/logger');
const { DISTRICTS } = require('../utils/constants');
const {
  classifyWhatsappIntent,
  suggestWhatsappAssistantReply,
  transcribeAudioFromUrl,
  extractNaturalPropertyQuery
} = require('../services/aiService');
const {
  getWhatsappConversationControl,
  syncWhatsappConversationState
} = require('../services/whatsappConversationService');
const {
  claimWhatsappWebBridgeMessages,
  getWhatsappWebBridgeToken,
  markWhatsappWebBridgeMessageFailed,
  markWhatsappWebBridgeMessageSent,
  queueWhatsappWebBridgeMessage,
  upsertWhatsappWebBridgeClient
} = require('../services/whatsappWebBridgeService');
const { isLlmEnabled } = require('../services/llmProvider');

const router = express.Router();
const HOME_URL = (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
const WHATSAPP_API_VERSION = (process.env.WHATSAPP_API_VERSION || 'v20.0').trim();
const WHATSAPP_ACCESS_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const WHATSAPP_PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const WHATSAPP_VERIFY_TOKEN = (process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
const WHATSAPP_WEB_BRIDGE_TOKEN = getWhatsappWebBridgeToken();

// Language Translations
const T = {
  en: {
    welcome: "🏠 Welcome to *MakaUg* - Uganda's free property platform!\n\nWhat would you like to do?\n1️⃣ List my property\n2️⃣ Search for a property\n3️⃣ Find an agent\n\nReply with 1, 2, or 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    askListingType: '🏠 What are you listing?\n1️⃣ House/Property for SALE\n2️⃣ House/Property for RENT\n3️⃣ Land/Plot\n4️⃣ Student accommodation\n5️⃣ Commercial property',
    askOwnership: '✅ Are you the owner of this property, or an agent listing on behalf of an owner?\n1️⃣ I am the owner\n2️⃣ I am a registered agent',
    askTitle: '✏️ Give your property a short title (e.g. "3-bedroom house in Ntinda Kampala"):',
    askDistrict: '📍 Which district is the property in? (e.g. Kampala, Wakiso, Mukono, Jinja...)',
    askArea: '🗺️ What area or neighbourhood? (e.g. Kololo, Ntinda, Bugolobi...)',
    askPrice: '💰 What is your asking price in Uganda Shillings? (numbers only, e.g. 250000000)',
    askBedrooms: '🛏 How many bedrooms does the property have? (Enter a number, or 0 if N/A)',
    askDescription: '📝 Describe your property in a few sentences (location, features, condition...)',
    askPhotos: '📸 Please send exactly *5* photos, one by one. When done, type *DONE*\n\n📌 Required: front of building, sitting room, bedroom, kitchen, bathroom',
    askIDNumber: '🪪 For security, we need your National ID Number (NIN). This is required to prevent fraud and will not be publicly shown.\n\nPlease type your NIN:',
    askSelfie: '🤳 Please take a clear selfie (photo of yourself) holding your National ID card and send it here. This verifies you are real and reduces fraud.',
    askPhone: '📱 What is your mobile phone number (for verification)?\nFormat: +256 7XX XXX XXX',
    otpSent: "📲 We've sent a 6-digit code to your phone via SMS. Please type that code here to verify:",
    listingSubmitted: "🎉 *Your listing has been submitted!*\n\nOur team will review it and make it live within 24 hours.\n\n🔗 You'll receive a link to your listing once approved.\n\nReference: #{ref}\n\n✅ Next step: set up your profile to track listing views, saves, and enquiries.\n\nThank you for using MakaUg! 🏠🇺🇬",
    invalidInput: "❓ Sorry, I didn't understand that. Please reply with one of the options above.",
    verifyOTP: 'Please type the 6-digit code we sent via SMS:',
    otpSuccess: '✅ Phone verified!',
    otpFailed: '❌ Incorrect code. Please try again or type RESEND for a new code.',
    askDeposit: '💵 What is the deposit amount required? (in UGX, numbers only)',
    askContract: '📅 What is the minimum contract length in months? (e.g. 6, 12, 24)',
    askUniversity: '🎓 Which is the nearest university? (e.g. Makerere, Kyambogo, UCU...)',
    askDistance: '🚶 How far is the property from the university (in km)? (e.g. 0.5, 1, 2)',
    askSearchType: '🔎 Onoonya ki?\n1️⃣ Ebitundibwa\n2️⃣ Ezikodizibwa\n3️⃣ Ttaka\n4️⃣ Obutuuze bw\'abayiizi\n5️⃣ Ebyobusuubuzi\n6️⃣ Byonna',
    askSearchArea: '📍 Wandiika ekitundu oba district gy\'onoonya (nga Ntinda, Kampala, Wakiso), oba share location yo ku WhatsApp:',
    locationSharedReceived: '📍 Location received. Searching nearby properties...',
    searchNoNearbyResults: 'No approved listings found within 5 miles. Showing the nearest available options.',
    kmAway: 'km away',
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
    needAtLeastOnePhoto: '❌ Please send all 5 required photos before typing DONE.',
    needExactlyFivePhotos: '❌ Please upload exactly 5 photos: front, sitting room, bedroom, kitchen, bathroom.',
    photosUploaded: "📸 You've uploaded {count}/5 photos. Type *DONE* to continue once you reach 5.",
    photoReceived: '✅ Photo {count}/5 received! Send the next required photo.',
    invalidNin: '❌ Please enter a valid National ID Number (NIN).',
    sendSelfiePhotoOnly: '❌ Please send a photo (selfie) - not text.',
    invalidPhone: '❌ Invalid phone format. Try: 0760112587',
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
    welcome: "🏠 Tukusuubiza ku *MakaUg* - eyitwa wangu ya property mu Uganda!\n\nOyagala kukola ki?\n1️⃣ Okwetayirira eby'ensi byange\n2️⃣ Okunoonyereza ensi\n3️⃣ Okunoonya musomesa\n\nSuula 1, 2 oba 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    askListingType: "🏠 Kyoyetaagadde okutereka kya ki?\n1️⃣ Enju/Ensi okutunda\n2️⃣ Enju okusasula\n3️⃣ Ttaka\n4️⃣ Eby'okulala by'abayizi\n5️⃣ Ensi ez'ebikolwa",
    askOwnership: "✅ Ggwe nnyini ensi ono oba agent?\n1️⃣ Nze nnyini\n2️⃣ Nze agent",
    askTitle: '✏️ Nyumba yoyo ejjiire etya? (e.g. "Enyumba esatu Ntinda Kampala"):',
    askDistrict: '📍 Ensi eno eri mu kitundu ki? (e.g. Kampala, Wakiso, Mukono...)',
    askArea: '🗺️ Ekitundu ekitonotono ki? (e.g. Kololo, Ntinda, Bugolobi...)',
    askPrice: '💰 Ebbeeyi yayo mu Shillingi za Uganda bwoba nyo? (ennamba zokka)',
    askBedrooms: "🛏 Eddiini ezingaana? (Okwandika ennamba, oba 0 bw'etaba)",
    askDescription: '📝 Teeka ennukuta ntono ku ensi eno (otuutu, ebintu, embeera...)',
    askPhotos: "📸 Weereza ebifaananyi 5 byokka, ekimu ku kimu. Bw'omala, wandiike *DONE*\n\n📌 Ebyetaagisa: front, sitting room, bedroom, kitchen, bathroom",
    askIDNumber: '🪪 Kwa nteekateeka, tukeetaaga NIN yo (National ID Number). Ejja kutuzikirira bukyamu.',
    askSelfie: "🤳 Weereza selfie (ekifaananyi kyo) ng'oyita NIN yo.",
    askPhone: '📱 Enamba yaffe ya simu (okukakasa)?\nFomati: +256 7XX XXX XXX',
    otpSent: '📲 Tukusindise koodi ku simu yo nga SMS. Wandika koodi eyo eri wano:',
    listingSubmitted: "🎉 *Ensi yo eterekedwa!*\n\nTeemu yaffe eya kulabirira era ejja kuterekebwa mu saawa 24.\n\nReference: #{ref}\n\n✅ Edirirra: teekawo profile yo olabe views, saves n'ebibuuza ku listing yo.\n\nWebale okozesa MakaUg! 🏠🇺🇬",
    invalidInput: "❓ Simanyi. Ddamu n'okusooka okwandika.",
    otpSuccess: '✅ Simu kakasibwa!',
    otpFailed: '❌ Koodi si yo. Gezaayo oba wandika RESEND.',
    askDeposit: '💵 Obuwanguzi bwengaana mu UGX?',
    askContract: "📅 Edda ly'endagaano ntono bwengaana (mu myezi)?",
    askUniversity: '🎓 Yunivasite eyegenderako gye?',
    askDistance: '🚶 Mulenda gwa emiita mingaana ukola nga oyebase? (km)',
    askSearchType: '🔎 Onoonya ki?\n1️⃣ Ebitundibwa\n2️⃣ Ezikodizibwa\n3️⃣ Ttaka\n4️⃣ Obutuuze bw\'abayiizi\n5️⃣ Ebyobusuubuzi\n6️⃣ Byonna',
    askSearchArea: '📍 Wandiika ekitundu oba district gy\'onoonya (nga Ntinda, Kampala, Wakiso), oba share location yo ku WhatsApp:',
    locationSharedReceived: '📍 Location yo efuniddwa. Tunoonya listings eziri okumpi naawe...',
    searchNoNearbyResults: 'Tewali listings ezikkiriziddwa munda wa miles 5. Tukulaga eziri okumpi eziriwo.',
    kmAway: 'km okuva awo',
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
    needAtLeastOnePhoto: '❌ Weereza ebifaananyi 5 byonna ebyetaagisa nga tonnawandiika DONE.',
    needExactlyFivePhotos: '❌ Teeka ebifaananyi 5 byokka: front, sitting room, bedroom, kitchen, bathroom.',
    photosUploaded: '📸 Ofunye ebifaananyi {count}/5. Wandiika *DONE* nga omaze okutuusa ku 5.',
    photoReceived: '✅ Ekifaananyi {count}/5 kifuniddwa! Weereza ekiddako.',
    invalidNin: '❌ NIN gyotadde si ntuufu. Gezaako nate.',
    sendSelfiePhotoOnly: '❌ Weereza ekifaananyi (selfie), si bubaka bwa nnukuta.',
    invalidPhone: '❌ Namba ya ssimu si ntuufu. Geza: 0760112587',
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
    welcome: '🏠 Karibu *MakaUg* - Jukwaa la bure la mali Uganda!\n\nUnataka kufanya nini?\n1️⃣ Orodhesha mali yangu\n2️⃣ Tafuta mali\n3️⃣ Pata wakala\n\nJibu 1, 2 au 3',
    askListingType: '🏠 Unaorodhesha nini?\n1️⃣ Nyumba/Mali ya KUUZA\n2️⃣ Nyumba/Mali ya KUKODISHA\n3️⃣ Ardhi/Kiwanja\n4️⃣ Malazi ya wanafunzi\n5️⃣ Mali ya biashara',
    askTitle: '✏️ Toa kichwa kifupi cha mali yako:',
    askDistrict: '📍 Wilaya ipi? (mf. Kampala, Wakiso, Mukono...)',
    askArea: '🗺️ Mtaa au eneo gani?',
    askPrice: '💰 Bei gani kwa Shilingi za Uganda? (nambari tu)',
    askPhotos: '📸 Tuma picha 5 kamili, moja baada ya nyingine. Ukimaliza andika *DONE*\n\n📌 Inahitajika: mbele ya jengo, sebuleni, chumba cha kulala, jikoni, bafu',
    listingSubmitted: '🎉 *Mali yako imewasilishwa!*\n\nRef: #{ref}\n\n✅ Hatua inayofuata: weka profile yako ili kufuatilia views, saves na enquiries za tangazo lako.\n\nAsante kwa kutumia MakaUg! 🏠🇺🇬',
    invalidInput: '❓ Sijaelewa. Tafadhali jibu kwa mojawapo ya chaguo.',
    otpSent: '📲 Tumetuma nambari ya siri kwa SMS yako. Andika hapa:',
    otpSuccess: '✅ Nambari ya simu imethibitishwa!',
    otpFailed: '❌ Nambari si sahihi. Jaribu tena.',
    askSearchType: '🔎 Unatafuta nini?\n1️⃣ Ya kuuza\n2️⃣ Ya kupangisha\n3️⃣ Ardhi\n4️⃣ Makazi ya wanafunzi\n5️⃣ Biashara\n6️⃣ Mali yoyote',
    askSearchArea: '📍 Andika eneo, wilaya au mahali unapotafuta (mf. Ntinda, Kampala, Wakiso), au tuma location yako kwenye WhatsApp:',
    locationSharedReceived: '📍 Location yako imepokelewa. Tunatafuta mali zilizo karibu nawe...',
    searchNoNearbyResults: 'Hakuna mali zilizoidhinishwa ndani ya maili 5. Tunaonyesha chaguo za karibu zilizopo.',
    kmAway: 'km kutoka hapo',
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
    needAtLeastOnePhoto: '❌ Tafadhali tuma picha 5 zote zinazohitajika kabla ya kuandika DONE.',
    needExactlyFivePhotos: '❌ Tafadhali pakia picha 5 kamili: mbele, sebuleni, chumba cha kulala, jikoni, bafu.',
    photosUploaded: '📸 Umepakia picha {count}/5. Andika *DONE* ukifika 5.',
    photoReceived: '✅ Picha {count}/5 imepokelewa! Tuma picha inayofuata.',
    invalidNin: '❌ Tafadhali andika NIN sahihi.',
    sendSelfiePhotoOnly: '❌ Tafadhali tuma picha (selfie), si maandishi.',
    invalidPhone: '❌ Namba ya simu si sahihi. Jaribu: 0760112587',
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
    welcome: "🏠 Itye ber i *MakaUg* — kabedo me free property i Uganda!\n\nIn mito timo ngo?\n1️⃣ Keto ot megi\n2️⃣ Yeny ot\n3️⃣ Nong agent\n\nDwog 1, 2 onyo 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    invalidInput: '❓ Pe atamo. Tim ber idwog ki namba me ayero.',
    languageUpdated: '✅ Dhok ma idiyo olokke.',
    restarted: '🔄 Session ocake manyen.'
  },
  ny: {
    welcome: "🏠 Kaza omu *MakaUg* — ahari free property platform ya Uganda!\n\nNoyenda kukora ki?\n1️⃣ Kuteeka property yangye\n2️⃣ Kushangisa property\n3️⃣ Kushanga agent\n\nGarukamu 1, 2 nari 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    invalidInput: '❓ Tinkyetegire. Garukamu namba emwe omu zirikurondorwa.',
    languageUpdated: '✅ Orurimi ruhindukire.',
    restarted: '🔄 Session etandikire bupya.'
  },
  rn: {
    welcome: "🏠 Kaze kuri *MakaUg* — urubuga rw'ubuntu rw'imitungo muri Uganda!\n\nUshaka gukora iki?\n1️⃣ Kwandikisha umutungo\n2️⃣ Gushaka umutungo\n3️⃣ Gushaka agent\n\nSubiza 1, 2 canke 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    invalidInput: '❓ Sinabitahura. Subiza nimero iri hejuru.',
    languageUpdated: '✅ Ururimi rwahinduwe.',
    restarted: '🔄 Session yatanguye bundi bushya.'
  },
  sm: {
    welcome: "🏠 Mirembe ku *MakaUg* — urubuga rwa property olwa bwerere mu Uganda!\n\nOyagala okukola ki?\n1️⃣ Okuteeka property yange\n2️⃣ Okunoonya property\n3️⃣ Okunoonya agent\n\nDdamu 1, 2 oba 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    invalidInput: '❓ Tebinnyonnyodde bulungi. Ddamu namba emu ku ziri waggulu.',
    languageUpdated: '✅ Olulimi luhinduddwa.',
    restarted: '🔄 Session etandise bupya.'
  },
};

// Get translation (fallback to English)
function resolveLangCode(lang) {
  const raw = normalizeInput(lang).toLowerCase();
  if (!raw) return 'en';
  if (T[raw]) return raw;

  const normalized = raw.replace(/_/g, '-');
  if (T[normalized]) return normalized;

  const base = normalized.split('-')[0];
  if (T[base]) return base;
  return 'en';
}

function t(lang, key) {
  const code = resolveLangCode(lang);
  return (T[code] && T[code][key]) || T.en[key] || key;
}

function tt(lang, key, vars = {}) {
  let msg = t(lang, key);
  Object.entries(vars).forEach(([k, v]) => {
    msg = msg.replaceAll(`{${k}}`, String(v));
  });
  return msg;
}

function getUgandaDayPart(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kampala',
    hour: 'numeric',
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function timeGreeting(lang, date = new Date()) {
  const code = resolveLangCode(lang);
  const part = getUgandaDayPart(date);
  const greetings = {
    en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    lg: { morning: 'Wasuze otya', afternoon: 'Osiibye otya', evening: 'Osiibye otya' },
    sw: { morning: 'Habari za asubuhi', afternoon: 'Habari za mchana', evening: 'Habari za jioni' },
    ac: { morning: 'Itye nining i odiko', afternoon: 'Itye nining i dye ceng', evening: 'Itye nining i otyeno' },
    ny: { morning: 'Oraire ota', afternoon: 'Osiibire ota', evening: 'Osiibire ota' },
    rn: { morning: 'Mwaramutse', afternoon: 'Mwiriwe', evening: 'Mwiriwe' },
    sm: { morning: 'Wasuze otya', afternoon: 'Osiibye otya', evening: 'Osiibye otya' }
  };
  return (greetings[code] || greetings.en)[part] || greetings.en[part];
}

function assistantIntro(lang) {
  const code = resolveLangCode(lang);
  const intros = {
    en: "I'm your MakaUg property assistant in your pocket.",
    lg: 'Nze MakaUg assistant wo ow\'eby\'amaka ku WhatsApp.',
    sw: 'Mimi ni msaidizi wako wa MakaUg wa mali kwenye WhatsApp.',
    ac: 'An aye MakaUg property assistant mamegi i WhatsApp.',
    ny: 'Ndi MakaUg property assistant yaawe aha WhatsApp.',
    rn: 'Ndi assistant wawe wa MakaUg kuri WhatsApp.',
    sm: 'Nze MakaUg assistant wo ow\'eby\'amaka ku WhatsApp.'
  };
  return intros[code] || intros.en;
}

function welcomeMessage(lang) {
  const code = resolveLangCode(lang);
  return `${timeGreeting(code)} 👋 ${assistantIntro(code)}\n\n${t(code, 'welcome')}\n\nBrowse MakaUg anytime: ${HOME_URL}`;
}

function detectLanguageFromText(text) {
  const clean = normalizeInput(text).toLowerCase();
  if (!clean) return { code: '', confidence: 0 };

  const rules = [
    { code: 'sw', confidence: 0.92, re: /\b(habari|mambo|niaje|tafuta|nyumba|kupangisha|kuuza|bei|asante|karibu)\b/ },
    { code: 'lg', confidence: 0.9, re: /\b(oli otya|wasuze|osiibye|webale|noonya|nfunira|nyumba|enju|ttaka|okupangisa)\b/ },
    { code: 'sm', confidence: 0.86, re: /\b(mirembe|noonia|amaka|ebifa|lusoga)\b/ },
    { code: 'ac', confidence: 0.88, re: /\b(itye|apwoyo|yeny|nongo|gang|ot|acholi)\b/ },
    { code: 'ny', confidence: 0.86, re: /\b(oraire|osiibire|webare|shaka|nyowe|runyankole)\b/ },
    { code: 'rn', confidence: 0.84, re: /\b(mwaramutse|mwiriwe|murakoze|shaka|rukiga)\b/ },
    { code: 'en', confidence: 0.7, re: /\b(hello|hi|good morning|good afternoon|good evening|rent|buy|house|property|agent|broker|land)\b/ }
  ];

  for (const rule of rules) {
    if (rule.re.test(clean)) return { code: rule.code, confidence: rule.confidence };
  }

  return { code: '', confidence: 0 };
}

function resolveDetectedLanguage({ text, sessionLang = 'en', intentResult = null }) {
  const entityLang = resolveLangCode(intentResult?.entities?.language || '');
  if (intentResult?.entities?.language && entityLang) {
    return { code: entityLang, confidence: 0.95, source: 'intent_entity' };
  }

  const heuristic = detectLanguageFromText(text);
  if (heuristic.code && heuristic.confidence >= 0.84) {
    return { ...heuristic, source: 'heuristic' };
  }

  return { code: resolveLangCode(sessionLang), confidence: 0.5, source: 'session' };
}

function appendSiteNudge(lang, message, url = HOME_URL) {
  const code = resolveLangCode(lang);
  if (!message || String(message).includes('http')) return message;
  const nudges = {
    en: `\n\nOpen MakaUg: ${url}`,
    lg: `\n\nGgulawo MakaUg: ${url}`,
    sw: `\n\nFungua MakaUg: ${url}`,
    ac: `\n\nYab MakaUg: ${url}`,
    ny: `\n\nGuraho MakaUg: ${url}`,
    rn: `\n\nFungura MakaUg: ${url}`,
    sm: `\n\nGgulawo MakaUg: ${url}`
  };
  return `${message}${nudges[code] || nudges.en}`;
}

function isGreetingText(text) {
  const clean = normalizeInput(text).toLowerCase().replace(/[!?.]+$/g, '').trim();
  if (!clean) return false;
  const compact = clean.replace(/\s+/g, ' ');
  if (compact.length > 80) return false;
  return [
    /^(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening|morning|afternoon|evening)$/,
    /^(habari|mambo|niaje|jambo|sasa|salama)$/,
    /^(oli otya|wasuze otya|osiibye otya|gyebale|mulembe|mirembe)$/,
    /^(itye nining|apwoyo|kopango)$/,
    /^(oraire ota|osiibire ota|agandi|webare)$/,
    /^(mwaramutse|mwiriwe|amakuru|muraho)$/
  ].some((rule) => rule.test(compact));
}

function friendlyGreetingReply(lang) {
  const code = resolveLangCode(lang);
  const messages = {
    en: `${timeGreeting(code)} 👋 ${assistantIntro(code)}\n\nHow can I help today?\n1️⃣ List my property\n2️⃣ Search for a property\n3️⃣ Find an agent\n\nYou can also type naturally, like "2 bedroom house in Kampala" or share your location.`,
    lg: `${timeGreeting(code)} 👋 ${assistantIntro(code)}\n\nNnyinza kukuyamba ntya leero?\n1️⃣ Listing y'ennyumba yo\n2️⃣ Noonya ennyumba\n3️⃣ Funa agent\n\nOsobola n'okuwandika nga "ennyumba e Ntinda" oba okusindika location yo.`,
    sw: `${timeGreeting(code)} 👋 ${assistantIntro(code)}\n\nNinaweza kukusaidiaje leo?\n1️⃣ Orodhesha mali yangu\n2️⃣ Tafuta nyumba/mali\n3️⃣ Tafuta agent\n\nUnaweza pia kuandika kawaida, kama "nyumba ya vyumba 2 Kampala" au kushare location yako.`,
    ac: `${timeGreeting(code)} 👋 ${assistantIntro(code)}\n\nAromo konyi nining tin?\n1️⃣ Ket property mamegi\n2️⃣ Yeny property\n3️⃣ Nong agent\n\nI romo coc ki leb ma yot onyo share location mamegi.`,
    ny: `${timeGreeting(code)} 👋 ${assistantIntro(code)}\n\nNinkuyamba nta eriizooba?\n1️⃣ Handiika property yaawe\n2️⃣ Shaka property\n3️⃣ Shaka agent\n\nNoobaasa kuhandiika nk'omuntu arikugamba, ninga share location yaawe.`,
    rn: `${timeGreeting(code)} 👋 ${assistantIntro(code)}\n\nNinkuyamba nteeri hati?\n1️⃣ Shyira property yaaweho\n2️⃣ Shaka property\n3️⃣ Shaka agent\n\nNimushobora kwandika bisanzwe cyangwa mugasangiza location.`,
    sm: `${timeGreeting(code)} 👋 ${assistantIntro(code)}\n\nNnyinza kukuyamba ntya leero?\n1️⃣ Listing y'ennyumba yo\n2️⃣ Noonya ennyumba\n3️⃣ Funa agent\n\nOsobola n'okuwandika nga "ennyumba e Ntinda" oba okusindika location yo.`
  };
  return `${messages[code] || messages.en}\n\n${t(code, 'menuHint')}`;
}

function stepReminderMessage(lang, step) {
  const code = resolveLangCode(lang);
  const prompts = {
    choose_language: t(code, 'chooseLanguage'),
    listing_type: t(code, 'askListingType'),
    ownership: t(code, 'askOwnership'),
    title: t(code, 'askTitle'),
    district: t(code, 'askDistrict'),
    area: t(code, 'askArea'),
    price: t(code, 'askPrice'),
    bedrooms: t(code, 'askBedrooms'),
    description: t(code, 'askDescription'),
    photos: t(code, 'askPhotos'),
    ask_deposit: t(code, 'askDeposit'),
    ask_contract: t(code, 'askContract'),
    ask_university: t(code, 'askUniversity'),
    ask_distance: t(code, 'askDistance'),
    ask_id_number: t(code, 'askIDNumber'),
    ask_selfie: t(code, 'askSelfie'),
    ask_phone: t(code, 'askPhone'),
    search_type: t(code, 'askSearchType'),
    search_area: t(code, 'askSearchArea'),
    agent_area: t(code, 'askAgentArea'),
    verify_otp: t(code, 'verifyOTP')
  };
  const prompt = prompts[step] || t(code, 'menuHint');
  const lead = {
    en: 'I am here with you. We were at this step:',
    lg: 'Ndi wano naawe. Tubadde ku mutendera guno:',
    sw: 'Niko hapa na wewe. Tulikuwa kwenye hatua hii:',
    ac: 'An atye kany kwedi. Onongo watye i kabedo man:',
    ny: 'Ndi hano naiwe. Tukaba turi aha ntambwe egi:',
    rn: 'Ndi hano namwe. Twari tugeze aha ntambwe eyi:',
    sm: 'Ndi wano naawe. Tubadde ku mutendera guno:'
  };
  return `${timeGreeting(code)} 👋 ${lead[code] || lead.en}\n\n${prompt}\n\n${t(code, 'menuHint')}`;
}

function friendlyUnknownReply(lang) {
  const code = resolveLangCode(lang);
  const messages = {
    en: `I can help with that. Tell me what you need in one sentence, or pick:\n1️⃣ List a property\n2️⃣ Search properties\n3️⃣ Find an agent\n\nExample: "rent in Muyenga under 2m"`,
    lg: `Nsobola okukuyamba. Mpandiikira ky'oyagala mu sentence emu, oba londa:\n1️⃣ Listing y'ennyumba\n2️⃣ Noonya ennyumba\n3️⃣ Funa agent`,
    sw: `Naweza kusaidia. Niambie unahitaji nini kwa sentensi moja, au chagua:\n1️⃣ Orodhesha mali\n2️⃣ Tafuta mali\n3️⃣ Tafuta agent`,
    ac: `Aromo konyi. Waca gin ma imito i lok acel, onyo yer:\n1️⃣ Ket property\n2️⃣ Yeny property\n3️⃣ Nong agent`,
    ny: `Ninkubaasa kukuyamba. Ngambira eki orikwenda omu sentence emwe, ninga toorana:\n1️⃣ Handiika property\n2️⃣ Shaka property\n3️⃣ Shaka agent`,
    rn: `Ninkubaasa kubafasha. Mumbwire icyo mushaka mu nteruro imwe, cyangwa muhitemo:\n1️⃣ Shyira propertyho\n2️⃣ Shaka property\n3️⃣ Shaka agent`,
    sm: `Nsobola okukuyamba. Mpandiikira ky'oyagala mu sentence emu, oba londa:\n1️⃣ Listing y'ennyumba\n2️⃣ Noonya ennyumba\n3️⃣ Funa agent`
  };
  return `${messages[code] || messages.en}\n\n${HOME_URL}`;
}

async function conversationalAssistantFallback({ phone, body, lang, step, intentResult, sessionData }) {
  if (!isLlmEnabled()) {
    return friendlyUnknownReply(lang);
  }

  const inferredRoute = intentMenuRoute(intentResult?.intent);
  const linkByRoute = {
    listing_type: `${HOME_URL}/#page-list-property`,
    search_type: `${HOME_URL}/#page-search`,
    agent_area: `${HOME_URL}/#page-brokers`,
    agent_registration: `${HOME_URL}/#page-brokers`,
    mortgage_help: `${HOME_URL}/#page-mortgage`,
    account_help: `${HOME_URL}/#page-account`,
    report_listing: `${HOME_URL}/#page-report`,
    support: `${HOME_URL}/#page-contact`
  };

  try {
    const reply = await suggestWhatsappAssistantReply({
      userMessage: body,
      intent: intentResult?.intent || 'unknown',
      language: lang,
      source: 'whatsapp_conversation_fallback',
      context: {
        phone,
        step,
        confidence: intentResult?.confidence || 0,
        entities: intentResult?.entities || {},
        currentFlow: sessionData?.pending_intent_confirmation ? 'confirming_intent' : 'main_menu',
        assistantRole: 'friendly property assistant in the user pocket',
        supportedActions: [
          'search approved MakaUg listings',
          'start a property listing',
          'find a verified agent',
          'accept shared location for nearby property search',
          'save no-match property requests for follow-up'
        ],
        preferredLink: linkByRoute[inferredRoute] || HOME_URL
      }
    });

    if (reply?.text && reply.model && !reply.model.startsWith('template')) {
      return reply.text;
    }
  } catch (error) {
    logger.warn('WhatsApp conversational fallback failed:', error.message);
  }

  return friendlyUnknownReply(lang);
}

function humanHandoffAck(lang) {
  const code = resolveLangCode(lang);
  const messages = {
    en: 'Thanks. Your message is now in the MakaUg support inbox and a team member will reply here shortly.',
    lg: 'Webale. Obubaka bwo butuuse mu support inbox ya MakaUg era omu ku team ajja kuddamu wano mu bbanga ttono.',
    sw: 'Asante. Ujumbe wako sasa uko kwenye kisanduku cha msaada cha MakaUg na mshiriki wa timu atakujibu hapa karibuni.',
    ac: 'Apwoyo. Ngec mamegi dong odonyo i MakaUg support inbox, ci dano me tim wa bino dwogo kany cok.',
    ny: 'Webare. Obutumwa bwawe bwashika omu support inbox ya MakaUg kandi omu ahari team naija kukugarukamu hano ahonaaho.',
    rn: 'Murakoze. Ubutumwa bwanyu bwinjiye omu support inbox ya MakaUg kandi omuntu wo omu team aragarukamu aha mu bwangu.',
    sm: 'Webale. Obubaka bwo butuuse mu support inbox ya MakaUg era omu ku team ajja kukuddamu wano mu bbanga ttono.'
  };
  return `${messages[code] || messages.en}\n\n${t(code, 'menuHint')}`;
}

function isWhatsappWebBridgeAuthorized(req) {
  const token = String(
    req.headers['x-whatsapp-web-bridge-token']
      || req.query?.token
      || req.body?.token
      || ''
  ).trim();
  return !!WHATSAPP_WEB_BRIDGE_TOKEN && token === WHATSAPP_WEB_BRIDGE_TOKEN;
}

function bridgeUnauthorized(res) {
  return res.status(401).json({ ok: false, error: 'Invalid WhatsApp Web bridge token' });
}

function normalizeBridgeInboundKey(value) {
  const raw = normalizeInput(value);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 9) return digits;
  return raw.slice(0, 160);
}

function createBridgeMessageId({ phone, body, createdAt, providerMessageId, mediaType }) {
  if (providerMessageId) return String(providerMessageId).trim();
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify({
      phone: normalizeBridgeInboundKey(phone),
      body: String(body || '').trim(),
      createdAt: String(createdAt || ''),
      mediaType: String(mediaType || '').trim().toLowerCase()
    }))
    .digest('hex');
  return `webbridge:${hash}`;
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
    buy: 'sale',
    buying: 'sale',
    sale: 'sale',
    selling: 'sale',
    'for sale': 'sale',
    rent: 'rent',
    rental: 'rent',
    renting: 'rent',
    'to rent': 'rent',
    sale: 'sale',
    land: 'land',
    plot: 'land',
    plots: 'land',
    student: 'student',
    students: 'student',
    hostel: 'student',
    hostels: 'student',
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

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseInboundLocation(payload = {}) {
  const lat = toNum(payload.Latitude ?? payload.latitude ?? payload.lat);
  const lng = toNum(payload.Longitude ?? payload.longitude ?? payload.lng ?? payload.lon);
  if (lat == null || lng == null) return null;
  const label = normalizeInput(payload.Label ?? payload.label);
  const address = normalizeInput(payload.Address ?? payload.address);
  return {
    lat,
    lng,
    label: label || null,
    address: address || null
  };
}

function isMetaWebhookPayload(payload = {}) {
  return payload
    && payload.object === 'whatsapp_business_account'
    && Array.isArray(payload.entry);
}

function normalizePhoneForMeta(value) {
  return String(value || '').replace(/\D/g, '');
}

async function fetchMetaMediaUrl(mediaId) {
  if (!mediaId || !WHATSAPP_ACCESS_TOKEN) return null;
  try {
    const resp = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`
      }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.url || null;
  } catch (_error) {
    return null;
  }
}

function extractMetaTextBody(message = {}) {
  const type = String(message.type || '').toLowerCase();
  if (type === 'text') return normalizeInput(message.text?.body);
  if (type === 'button') return normalizeInput(message.button?.text || message.button?.payload);

  if (type === 'interactive') {
    const interactive = message.interactive || {};
    const iType = String(interactive.type || '').toLowerCase();
    if (iType === 'button_reply') {
      return normalizeInput(interactive.button_reply?.title || interactive.button_reply?.id);
    }
    if (iType === 'list_reply') {
      return normalizeInput(interactive.list_reply?.title || interactive.list_reply?.id);
    }
  }

  if (type === 'image' || type === 'document' || type === 'video') {
    return normalizeInput(message[type]?.caption);
  }

  return '';
}

async function parseMetaInboundMessages(payload = {}) {
  const collected = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change?.value || {};
      for (const message of value.messages || []) {
        const msgType = String(message.type || '').toLowerCase();
        const phone = normalizeInput(message.from);
        if (!phone) continue;

        let mediaUrl = null;
        let mediaType = '';
        let sharedLocation = null;

        if (msgType === 'location' && message.location) {
          sharedLocation = parseInboundLocation({
            latitude: message.location.latitude,
            longitude: message.location.longitude,
            label: message.location.name,
            address: message.location.address
          });
        }

        if (['image', 'audio', 'video', 'document', 'sticker'].includes(msgType)) {
          const mediaObj = message[msgType] || {};
          mediaType = String(mediaObj.mime_type || '');
          if (mediaObj.id) {
            mediaUrl = await fetchMetaMediaUrl(mediaObj.id);
          }
        }

        collected.push({
          provider: 'meta',
          phone,
          inboundMessageId: normalizeInput(message.id) || null,
          body: extractMetaTextBody(message),
          mediaUrl,
          mediaType,
          sharedLocation,
          messageType: msgType || 'text'
        });
      }
    }
  }

  return collected;
}

function splitMetaText(text, maxLen = 3600) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const chunks = [];
  let remaining = clean;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < 0 || cut < maxLen * 0.5) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendMetaTextMessage(phone, message) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('Meta WhatsApp Cloud API env is missing');
  }

  const to = normalizePhoneForMeta(phone);
  if (!to) throw new Error('Invalid destination phone');

  const chunks = splitMetaText(message);
  if (!chunks.length) return { sent: false, reason: 'empty_message' };

  let sentCount = 0;
  for (const chunk of chunks) {
    const resp = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            preview_url: false,
            body: chunk
          }
        })
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Meta send failed (${resp.status}): ${body}`);
    }
    sentCount += 1;
  }

  return { sent: true, chunks: sentCount };
}

const SEARCH_TYPE_KEYWORDS = [
  { type: 'rent', re: /\b(rent|rental|to rent|monthly|per month|a month|\/month|lease)\b/i },
  { type: 'sale', re: /\b(buy|buying|sale|for sale|purchase|own)\b/i },
  { type: 'student', re: /\b(student|students|hostel|dorm|dormitory|campus|university)\b/i },
  { type: 'commercial', re: /\b(commercial|office|retail|warehouse|shop|business premises)\b/i },
  { type: 'land', re: /\b(land|plot|acre|acres|farm land|agricultural)\b/i }
];

const PROPERTY_TYPE_KEYWORDS = [
  { value: 'house', re: /\b(house|home)\b/i },
  { value: 'villa', re: /\b(villa)\b/i },
  { value: 'apartment', re: /\b(apartment|flat)\b/i },
  { value: 'townhouse', re: /\b(townhouse)\b/i },
  { value: 'bungalow', re: /\b(bungalow)\b/i },
  { value: 'studio', re: /\b(studio)\b/i },
  { value: 'duplex', re: /\b(duplex)\b/i },
  { value: 'hostel', re: /\b(hostel|dorm|dormitory)\b/i },
  { value: 'office', re: /\b(office)\b/i },
  { value: 'warehouse', re: /\b(warehouse)\b/i },
  { value: 'retail shop', re: /\b(retail|shop|storefront)\b/i }
];

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

const AREA_ALIASES = {
  kampala: 'Kampala',
  wakiso: 'Wakiso',
  mukono: 'Mukono',
  kisaasi: 'Kisaasi',
  kololo: 'Kololo',
  ntinda: 'Ntinda',
  bugolobi: 'Bugolobi',
  nakasero: 'Nakasero',
  naalya: 'Naalya',
  kira: 'Kira',
  kyaliwajjala: 'Kyaliwajjala',
  kyanja: 'Kyanja',
  najjera: 'Najjera',
  bukoto: 'Bukoto',
  kyambogo: 'Kyambogo',
  makerere: 'Makerere',
  muyenga: 'Muyenga',
  uyenga: 'Muyenga',
  mbarara: 'Mbarara',
  mbale: 'Mbale',
  gulu: 'Gulu',
  lira: 'Lira',
  arua: 'Arua',
  jinja: 'Jinja',
  entebbe: 'Entebbe',
  'fort portal': 'Fort Portal',
  'nansana': 'Nansana',
  'bweyogerere': 'Bweyogerere',
  'namugongo': 'Namugongo',
  rubaga: 'Rubaga',
  rubagaa: 'Rubaga',
  lubaga: 'Rubaga'
};

const NEAR_ME_PATTERNS = [
  /\bnear\s+me\b/i,
  /\baround\s+me\b/i,
  /\bnearby\b/i,
  /\bmy\s+location\b/i,
  /\bclose\s+to\s+me\b/i,
  /\bwithin\s+\d+(?:\.\d+)?\s*(?:km|kms|kilomet(?:er|re)s?|mi|mile|miles)\b/i
];

function parseNumberToken(rawNumber, suffix) {
  let amount = Number(String(rawNumber || '').replace(/[, ]+/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const tail = String(suffix || '').toLowerCase();
  if (tail === 'k') amount *= 1_000;
  if (tail === 'm') amount *= 1_000_000;
  if (tail === 'b') amount *= 1_000_000_000;
  return amount;
}

function isNearMeQuery(text) {
  const clean = normalizeInput(text);
  if (!clean) return false;
  return NEAR_ME_PATTERNS.some((rule) => rule.test(clean));
}

function normalizeListingType(value) {
  const mapped = mapSearchTypeInput(value);
  return mapped || 'any';
}

function parseBedCount(text) {
  const clean = normalizeInput(text).toLowerCase();
  let m = clean.match(/\b(\d+)\s*[- ]?(?:bed|beds|bedroom|bedrooms|br)\b/i);
  if (m) return Number(m[1]);
  m = clean.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?(?:bed|beds|bedroom|bedrooms|br)\b/i);
  if (m) return WORD_NUMBERS[m[1]] || null;
  m = clean.match(/\b(?:bed|beds|bedroom|bedrooms)\s*(\d+)\b/i);
  if (m) return Number(m[1]);
  return null;
}

function parseBudget(text) {
  const raw = normalizeInput(text);
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/us dollars?/g, 'usd');
  const rx = /(?:(usd|\$|ugx|ush|shs)\s*)?(\d[\d,\s]*(?:\.\d+)?)\s*([kmb])?\s*(usd|ugx|ush|shs)?/gi;
  const candidates = [];

  let m;
  while ((m = rx.exec(lower)) !== null) {
    const curA = (m[1] || '').toLowerCase();
    const curB = (m[4] || '').toLowerCase();
    const suffix = (m[3] || '').toLowerCase();
    const amount = parseNumberToken(m[2], suffix);
    if (!amount) continue;

    const currency = curA || curB || (m[0].includes('$') ? 'usd' : 'ugx');
    const start = Math.max(0, (m.index || 0) - 28);
    const end = Math.min(lower.length, (m.index || 0) + m[0].length + 28);
    const context = lower.slice(start, end);
    const before = lower.slice(Math.max(0, (m.index || 0) - 24), m.index || 0);

    let score = 0;
    if (/\b(for|under|max(?:imum)?|budget(?:\s+of)?|up to|around|about|at)\b/i.test(before)) score += 4;
    if (/\b(per\s*month|a month|monthly|\/month|pm|per\s*week|weekly|\/week|per\s*year|yearly|annually|\/year|semester|\/sem)\b/i.test(context)) score += 2;
    if (curA || curB || m[0].includes('$')) score += 2;
    if (suffix) score += 1;
    if (amount >= 100_000) score += 1;
    if (amount < 10_000 && !(curA || curB || m[0].includes('$'))) score -= 3;
    if (/\b(bed|beds|bedroom|bedrooms|bath|bathroom|toilet|room)\b/i.test(context)) score -= 6;
    if (/\b(acre|acres|sq\s?m|sqm|sqft|hectare|plot|plots)\b/i.test(context)) score -= 3;
    if (/\b(year built|built in|built)\b/i.test(context)) score -= 4;

    candidates.push({ amount, currency, score, context });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score < -1) return null;

  const rate = Number(process.env.USD_TO_UGX_RATE || 3800);
  const ugxAmount = best.currency === 'usd' || best.currency === '$'
    ? Math.round(best.amount * (Number.isFinite(rate) && rate > 0 ? rate : 3800))
    : Math.round(best.amount);

  let period = null;
  if (/\b(per\s*month|a month|monthly|\/month|pm)\b/i.test(lower)) period = 'month';
  else if (/\b(per\s*week|weekly|\/week)\b/i.test(lower)) period = 'week';
  else if (/\b(per\s*year|yearly|annually|\/year)\b/i.test(lower)) period = 'year';
  else if (/\b(semester|\/sem|per\s*semester)\b/i.test(lower)) period = 'semester';

  return {
    originalAmount: best.amount,
    currency: best.currency === '$' ? 'usd' : best.currency,
    maxBudgetUgx: ugxAmount,
    period,
    convertedFromUsd: best.currency === 'usd' || best.currency === '$'
  };
}

function parsePropertyType(text) {
  const clean = normalizeInput(text);
  for (const rule of PROPERTY_TYPE_KEYWORDS) {
    if (rule.re.test(clean)) return rule.value;
  }
  return null;
}

function parseSearchType(text) {
  const clean = normalizeInput(text);
  const mapped = mapSearchTypeInput(clean);
  if (mapped) return mapped;
  for (const rule of SEARCH_TYPE_KEYWORDS) {
    if (rule.re.test(clean)) return rule.type;
  }
  return null;
}

function getDynamicAreaAliases(sessionData = {}) {
  const aliases = {};
  const source = sessionData && typeof sessionData === 'object'
    ? sessionData.area_aliases
    : null;

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    Object.entries(source).forEach(([alias, canonical]) => {
      const a = normalizeInput(alias).toLowerCase();
      const c = normalizeInput(canonical);
      if (a && c) aliases[a] = c;
    });
    return aliases;
  }

  if (Array.isArray(source)) {
    source.forEach((row) => {
      const alias = normalizeInput(row?.alias || row?.key).toLowerCase();
      const canonical = normalizeInput(row?.canonical || row?.name || row?.value);
      if (alias && canonical) aliases[alias] = canonical;
    });
  }

  return aliases;
}

function parseAreaFromText(text, sessionData = {}) {
  const clean = normalizeInput(text);
  if (!clean) return null;
  const lower = clean.toLowerCase();
  const cleanedLower = lower.replace(/[^\w\s'-]/g, ' ');
  const aliasMap = {
    ...AREA_ALIASES,
    ...getDynamicAreaAliases(sessionData)
  };

  const directAlias = aliasMap[cleanedLower.trim()];
  if (directAlias) return directAlias;

  const districtHit = DISTRICTS.find((d) => cleanedLower.includes(d.toLowerCase()));
  if (districtHit) return districtHit;

  const areaRe = /\b(?:in|at|around|near|within|from)\s+([a-z][a-z\s'-]{2,})/i;
  const areaMatch = cleanedLower.match(areaRe);
  if (areaMatch && areaMatch[1]) {
    let candidate = areaMatch[1]
      .split(/\b(for|under|max|with|within|around|budget|monthly|per|a month|near me|my location|phone|call|rent|sale|buy)\b/i)[0]
      .trim();
    candidate = candidate.replace(/[^a-z\s'-]/gi, '').replace(/\s+/g, ' ').trim();
    if (candidate && candidate !== 'uganda') {
      const alias = aliasMap[candidate];
      if (alias) return alias;
      return candidate
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }

  return null;
}

function extractNaturalSearchFilters(text, entities = {}, fallbackType = 'any', sessionData = {}) {
  const clean = normalizeInput(text);
  const e = entities && typeof entities === 'object' ? entities : {};

  const searchType = normalizeListingType(
    e.listing_type || e.listingType || parseSearchType(clean) || fallbackType || 'any'
  );
  const area = normalizeInput(e.area || e.location || e.district || parseAreaFromText(clean, sessionData)) || null;
  const bedsMin = Number(e.bedrooms || e.beds || parseBedCount(clean) || 0) || 0;
  const propertyType = normalizeInput(e.property_type || e.propertyType || parsePropertyType(clean)) || null;
  const budgetParsed = parseBudget(clean);
  const maxBudgetUgx = Number(e.budget_max || e.budget || budgetParsed?.maxBudgetUgx || 0) || 0;
  const budgetPeriod = normalizeInput(e.period || budgetParsed?.period) || null;
  const useSharedLocation = Boolean(
    e.near_me === true
    || e.nearMe === true
    || e.use_shared_location === true
    || isNearMeQuery(clean)
  );

  const hasSignal = Boolean(
    area
    || bedsMin > 0
    || propertyType
    || maxBudgetUgx > 0
    || useSharedLocation
    || (searchType && searchType !== 'any')
  );

  return {
    hasSignal,
    searchType,
    area,
    bedsMin,
    propertyType,
    maxBudgetUgx,
    budgetPeriod,
    useSharedLocation,
    convertedFromUsd: Boolean(budgetParsed?.convertedFromUsd),
    sourceText: clean
  };
}

function mergeNaturalSearchFilters(primary = {}, secondary = {}) {
  const p = primary && typeof primary === 'object' ? primary : {};
  const s = secondary && typeof secondary === 'object' ? secondary : {};

  const merged = {
    searchType: normalizeListingType(p.searchType || s.searchType || 'any'),
    area: normalizeInput(p.area || s.area) || null,
    district: normalizeInput(p.district || s.district) || null,
    bedsMin: Number(p.bedsMin ?? s.bedsMin ?? 0) || 0,
    propertyType: normalizeInput(p.propertyType || s.propertyType) || null,
    maxBudgetUgx: Number(p.maxBudgetUgx ?? s.maxBudgetUgx ?? 0) || 0,
    budgetPeriod: normalizeInput(p.budgetPeriod || s.budgetPeriod) || null,
    useSharedLocation: Boolean(p.useSharedLocation || s.useSharedLocation),
    convertedFromUsd: Boolean(p.convertedFromUsd || s.convertedFromUsd),
    sourceText: normalizeInput(p.sourceText || s.sourceText || ''),
    aiConfidence: Number(p.confidence || 0) || 0
  };

  merged.hasSignal = Boolean(
    merged.area
    || merged.district
    || merged.bedsMin > 0
    || merged.propertyType
    || merged.maxBudgetUgx > 0
    || merged.useSharedLocation
    || (merged.searchType && merged.searchType !== 'any')
  );

  return merged;
}

async function resolveNaturalSearchFilters({
  text,
  entities = {},
  fallbackType = 'any',
  language = 'en',
  sessionData = {}
} = {}) {
  const deterministic = extractNaturalSearchFilters(text, entities, fallbackType, sessionData);
  try {
    const aiExtract = await extractNaturalPropertyQuery({
      text,
      language,
      sessionData,
      fallbackType
    });
    return mergeNaturalSearchFilters(aiExtract, deterministic);
  } catch (error) {
    logger.warn('AI natural search extraction failed in route fallback:', error.message);
    return deterministic;
  }
}

function describeNaturalFilters(filters = {}) {
  const chips = [];
  if (filters.searchType && filters.searchType !== 'any') chips.push(typeLabel(filters.searchType, 'en'));
  if (filters.bedsMin > 0) chips.push(`${filters.bedsMin}+ bed`);
  if (filters.propertyType) chips.push(filters.propertyType);
  if (filters.maxBudgetUgx > 0) chips.push(`max ${formatPrice(filters.maxBudgetUgx, filters.budgetPeriod || '')}`);
  return chips.join(' • ');
}

async function findPropertiesByNaturalFilters(filters = {}) {
  const values = ['approved'];
  let where = 'WHERE status = $1';

  const listingType = normalizeListingType(filters.searchType || 'any');
  if (listingType !== 'any') {
    values.push(listingType);
    where += ` AND listing_type = $${values.length}`;
  }

  const area = normalizeInput(filters.area);
  if (area) {
    values.push(`%${area}%`);
    const qIdx = values.length;
    where += ` AND (
      district ILIKE $${qIdx}
      OR area ILIKE $${qIdx}
      OR title ILIKE $${qIdx}
      OR COALESCE(address, '') ILIKE $${qIdx}
    )`;
  }

  if (Number.isFinite(Number(filters.maxBudgetUgx)) && Number(filters.maxBudgetUgx) > 0) {
    values.push(Number(filters.maxBudgetUgx));
    where += ` AND price IS NOT NULL AND price <= $${values.length}`;
  }

  if (Number.isFinite(Number(filters.bedsMin)) && Number(filters.bedsMin) > 0) {
    values.push(Number(filters.bedsMin));
    where += ` AND COALESCE(bedrooms, 0) >= $${values.length}`;
  }

  const propertyType = normalizeInput(filters.propertyType);
  if (propertyType) {
    values.push(`%${propertyType}%`);
    const typeIdx = values.length;
    where += ` AND (
      COALESCE(property_type, '') ILIKE $${typeIdx}
      OR title ILIKE $${typeIdx}
      OR description ILIKE $${typeIdx}
    )`;
  }

  const result = await db.query(
    `SELECT id, title, listing_type, district, area, price, price_period, bedrooms, bathrooms, property_type
     FROM properties
     ${where}
     ORDER BY created_at DESC
     LIMIT 5`,
    values
  );

  return result.rows;
}

function normalizeOptKeyword(value) {
  return normalizeInput(value).toUpperCase().replace(/\s+/g, '');
}

function isAffirmativeReply(value) {
  const clean = normalizeInput(value).toLowerCase();
  const compact = normalizeOptKeyword(value);
  if (!clean && !compact) return false;
  if (['1', 'y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'confirm', 'proceed', 'continue', 'sawa'].includes(clean)) return true;
  if (['YES', 'OK', 'CONFIRM', 'CONTINUE', 'PROCEED', 'Y'].includes(compact)) return true;
  return /\b(yes|ok|confirm|continue)\b/i.test(clean);
}

function isNegativeReply(value) {
  const clean = normalizeInput(value).toLowerCase();
  const compact = normalizeOptKeyword(value);
  if (!clean && !compact) return false;
  if (['2', 'n', 'no', 'nope', 'nah', 'cancel', 'stop', 'menu'].includes(clean)) return true;
  if (['NO', 'CANCEL', 'STOP'].includes(compact)) return true;
  return /\b(no|cancel|stop)\b/i.test(clean);
}

async function upsertWhatsappUserProfile(phone, updates = {}) {
  const preferredLanguage = normalizeInput(updates.preferredLanguage);
  const optInSource = normalizeInput(updates.optInSource);
  const hasOptIn = typeof updates.marketingOptIn === 'boolean';

  await db.query(
    `INSERT INTO whatsapp_user_profiles (
      phone,
      preferred_language,
      marketing_opt_in,
      marketing_opt_in_at,
      marketing_opt_out_at,
      opt_in_source,
      metadata,
      last_seen_at
    ) VALUES (
      $1,
      COALESCE(NULLIF($2, ''), 'en'),
      COALESCE($3, FALSE),
      CASE WHEN $3 = TRUE THEN NOW() ELSE NULL END,
      CASE WHEN $3 = FALSE THEN NOW() ELSE NULL END,
      NULLIF($4, ''),
      COALESCE($5::jsonb, '{}'::jsonb),
      NOW()
    )
    ON CONFLICT (phone) DO UPDATE
    SET preferred_language = COALESCE(NULLIF($2, ''), whatsapp_user_profiles.preferred_language),
        marketing_opt_in = CASE
          WHEN $3 IS NULL THEN whatsapp_user_profiles.marketing_opt_in
          ELSE $3
        END,
        marketing_opt_in_at = CASE
          WHEN $3 = TRUE THEN NOW()
          ELSE whatsapp_user_profiles.marketing_opt_in_at
        END,
        marketing_opt_out_at = CASE
          WHEN $3 = FALSE THEN NOW()
          ELSE whatsapp_user_profiles.marketing_opt_out_at
        END,
        opt_in_source = COALESCE(NULLIF($4, ''), whatsapp_user_profiles.opt_in_source),
        metadata = whatsapp_user_profiles.metadata || COALESCE($5::jsonb, '{}'::jsonb),
        last_seen_at = NOW(),
        updated_at = NOW()`,
    [
      phone,
      preferredLanguage || null,
      hasOptIn ? updates.marketingOptIn : null,
      optInSource || null,
      JSON.stringify(updates.metadata || {})
    ]
  );
}

async function logWhatsappMessage({
  userPhone,
  waMessageId = null,
  direction = 'inbound',
  messageType = 'text',
  payload = {}
}) {
  await db.query(
    `INSERT INTO whatsapp_messages (user_phone, wa_message_id, direction, message_type, payload)
     VALUES ($1, NULLIF($2, ''), $3, $4, $5::jsonb)
     ON CONFLICT (wa_message_id) DO NOTHING`,
    [userPhone, waMessageId || null, direction, messageType, JSON.stringify(payload || {})]
  );
}

async function queueWhatsappWebBridgeAutoReply({
  phone,
  message,
  nextStep = null,
  source = 'whatsapp_runtime',
  actorId = 'system'
}) {
  const text = String(message || '').trim();
  if (!text) return null;

  return queueWhatsappWebBridgeMessage({
    recipient: phone,
    text,
    source,
    actorId,
    metadata: {
      next_step: nextStep || null,
      queued_by: source,
      queued_at: new Date().toISOString()
    }
  });
}

async function logIntent({
  userPhone,
  waMessageId = null,
  detectedIntent = 'unknown',
  confidence = 0,
  language = 'en',
  currentStep = '',
  rawText = '',
  transcript = '',
  entities = {},
  modelUsed = ''
}) {
  await db.query(
    `INSERT INTO whatsapp_intent_logs (
      user_phone, wa_message_id, detected_intent, confidence, language, current_step,
      raw_text, transcript, entities, model_used
    ) VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      userPhone,
      waMessageId || null,
      detectedIntent || 'unknown',
      Number.isFinite(Number(confidence)) ? Number(confidence) : null,
      language || 'en',
      currentStep || null,
      rawText || null,
      transcript || null,
      JSON.stringify(entities || {}),
      modelUsed || null
    ]
  );
}

async function saveTranscription({
  userPhone,
  waMessageId = null,
  transcript,
  detectedLanguage = '',
  mediaUrl = '',
  confidence = null
}) {
  if (!transcript) return;
  await db.query(
    `INSERT INTO transcriptions (user_phone, wa_message_id, transcript, confidence, detected_language, media_url)
     VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6)`,
    [userPhone, waMessageId || null, transcript, confidence, detectedLanguage || null, mediaUrl || null]
  );
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
    await smsService.sendSMS(phone, `MakaUg listing verification: ${otp}. Valid 10 mins. Do not share.`);
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

async function findPropertiesNearWhatsapp(searchType, sharedLocation) {
  const values = ['approved'];
  let where = 'WHERE status = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL';

  if (searchType && searchType !== 'any') {
    values.push(searchType);
    where += ` AND listing_type = $${values.length}`;
  }

  const result = await db.query(
    `SELECT id, title, listing_type, district, area, price, price_period, latitude, longitude
     FROM properties
     ${where}
     ORDER BY created_at DESC
     LIMIT 200`,
    values
  );

  const sourceLat = Number(sharedLocation.lat);
  const sourceLng = Number(sharedLocation.lng);
  const rowsWithDistance = result.rows
    .map((row) => {
      const lat = toNum(row.latitude);
      const lng = toNum(row.longitude);
      if (lat == null || lng == null) return null;
      const distanceKm = haversineKm(sourceLat, sourceLng, lat, lng);
      return { ...row, distance_km: distanceKm };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance_km - b.distance_km);

  const withinFiveMilesKm = 8.04672;
  const nearby = rowsWithDistance.filter((row) => row.distance_km <= withinFiveMilesKm);
  return {
    rows: (nearby.length ? nearby : rowsWithDistance).slice(0, 5),
    usedNearestFallback: nearby.length === 0 && rowsWithDistance.length > 0
  };
}

async function findPropertiesNearWhatsappWithFilters(baseSearchType, sharedLocation, filters = null) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const values = ['approved'];
  let where = 'WHERE status = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL';

  const listingType = normalizeListingType(f.searchType || baseSearchType || 'any');
  if (listingType && listingType !== 'any') {
    values.push(listingType);
    where += ` AND listing_type = $${values.length}`;
  }

  if (Number.isFinite(Number(f.maxBudgetUgx)) && Number(f.maxBudgetUgx) > 0) {
    values.push(Number(f.maxBudgetUgx));
    where += ` AND price IS NOT NULL AND price <= $${values.length}`;
  }

  if (Number.isFinite(Number(f.bedsMin)) && Number(f.bedsMin) > 0) {
    values.push(Number(f.bedsMin));
    where += ` AND COALESCE(bedrooms, 0) >= $${values.length}`;
  }

  const propertyType = normalizeInput(f.propertyType || '');
  if (propertyType) {
    values.push(`%${propertyType}%`);
    const typeIdx = values.length;
    where += ` AND (
      COALESCE(property_type, '') ILIKE $${typeIdx}
      OR title ILIKE $${typeIdx}
      OR description ILIKE $${typeIdx}
    )`;
  }

  const area = normalizeInput(f.area || '');
  if (area) {
    values.push(`%${area}%`);
    const areaIdx = values.length;
    where += ` AND (
      district ILIKE $${areaIdx}
      OR area ILIKE $${areaIdx}
      OR title ILIKE $${areaIdx}
    )`;
  }

  const result = await db.query(
    `SELECT id, title, listing_type, district, area, price, price_period, bedrooms, bathrooms, property_type, latitude, longitude
     FROM properties
     ${where}
     ORDER BY created_at DESC
     LIMIT 250`,
    values
  );

  const sourceLat = Number(sharedLocation.lat);
  const sourceLng = Number(sharedLocation.lng);
  const rowsWithDistance = result.rows
    .map((row) => {
      const lat = toNum(row.latitude);
      const lng = toNum(row.longitude);
      if (lat == null || lng == null) return null;
      const distanceKm = haversineKm(sourceLat, sourceLng, lat, lng);
      return { ...row, distance_km: distanceKm };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance_km - b.distance_km);

  const withinFiveMilesKm = 8.04672;
  const nearby = rowsWithDistance.filter((row) => row.distance_km <= withinFiveMilesKm);
  return {
    rows: (nearby.length ? nearby : rowsWithDistance).slice(0, 5),
    usedNearestFallback: nearby.length === 0 && rowsWithDistance.length > 0
  };
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

function extractAgentSearchKeywords(text, sessionData = {}) {
  const clean = normalizeInput(text);
  if (!clean) return [];

  const keywords = new Set();
  const parsedArea = parseAreaFromText(clean, sessionData);
  if (parsedArea) keywords.add(parsedArea);

  const lower = clean.toLowerCase();
  DISTRICTS.forEach((district) => {
    if (lower.includes(String(district).toLowerCase())) keywords.add(district);
  });

  clean.split(',').map((part) => normalizeInput(part)).filter(Boolean).slice(0, 3).forEach((part) => {
    if (part.length >= 3) keywords.add(part);
  });

  if (!keywords.size && clean.length >= 2) keywords.add(clean);
  return Array.from(keywords).slice(0, 8);
}

async function inferAgentSearchFromSharedLocation(sharedLocation, sessionData = {}) {
  const locationLabel = sharedLocation?.address
    || sharedLocation?.label
    || `${Number(sharedLocation?.lat || 0).toFixed(4)}, ${Number(sharedLocation?.lng || 0).toFixed(4)}`;

  const keywords = new Set(extractAgentSearchKeywords(locationLabel, sessionData));
  const preferredAgentIds = new Set();

  const sourceLat = toNum(sharedLocation?.lat);
  const sourceLng = toNum(sharedLocation?.lng);
  if (sourceLat == null || sourceLng == null) {
    return {
      locationLabel,
      keywords: Array.from(keywords),
      preferredAgentIds: []
    };
  }

  const nearbyResult = await db.query(
    `SELECT id, agent_id, district, area, latitude, longitude
     FROM properties
     WHERE status = 'approved'
       AND agent_id IS NOT NULL
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 300`
  );

  const rowsWithDistance = nearbyResult.rows
    .map((row) => {
      const lat = toNum(row.latitude);
      const lng = toNum(row.longitude);
      if (lat == null || lng == null) return null;
      return {
        ...row,
        distance_km: haversineKm(sourceLat, sourceLng, lat, lng)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance_km - b.distance_km);

  const withinFiveMilesKm = 8.04672;
  const nearby = rowsWithDistance.filter((row) => row.distance_km <= withinFiveMilesKm);
  const seedRows = (nearby.length ? nearby : rowsWithDistance).slice(0, 25);

  seedRows.forEach((row) => {
    if (row.agent_id) preferredAgentIds.add(String(row.agent_id));
    if (row.district) keywords.add(String(row.district));
    if (row.area) keywords.add(String(row.area));
  });

  return {
    locationLabel,
    keywords: Array.from(keywords).slice(0, 10),
    preferredAgentIds: Array.from(preferredAgentIds).slice(0, 25)
  };
}

async function findAgentsForWhatsappKeywords(keywords = [], preferredAgentIds = []) {
  const ranked = new Map();
  const keywordList = Array.isArray(keywords)
    ? keywords.map((k) => normalizeInput(k)).filter(Boolean)
    : [];
  const preferredIds = Array.isArray(preferredAgentIds)
    ? preferredAgentIds.map((id) => normalizeInput(id)).filter(Boolean)
    : [];

  if (preferredIds.length) {
    const preferredRows = await db.query(
      `SELECT id, full_name, company_name, phone, whatsapp, rating, districts_covered
       FROM agents
       WHERE status = 'approved'
         AND id = ANY($1::uuid[])
       ORDER BY rating DESC NULLS LAST, created_at DESC
       LIMIT 5`,
      [preferredIds]
    );

    preferredRows.rows.forEach((row) => {
      ranked.set(String(row.id), { ...row, _score: 200 });
    });
  }

  for (const keyword of keywordList) {
    const rows = await findAgentsForWhatsapp(keyword);
    rows.forEach((row, idx) => {
      const id = String(row.id);
      const existing = ranked.get(id);
      const boost = Math.max(15 - idx * 2, 5);
      if (!existing) ranked.set(id, { ...row, _score: boost });
      else ranked.set(id, { ...existing, _score: Number(existing._score || 0) + boost });
    });
  }

  return Array.from(ranked.values())
    .sort((a, b) => {
      const scoreDiff = Number(b._score || 0) - Number(a._score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(b.rating || 0) - Number(a.rating || 0);
    })
    .slice(0, 5)
    .map(({ _score, ...row }) => row);
}

async function logPropertySearchRequest({
  userPhone,
  searchType = 'any',
  queryText = '',
  location = null,
  resultRows = [],
  usedNearestFallback = false
}) {
  const payload = {
    search_type: searchType,
    query: queryText || null,
    location: location || null,
    used_nearest_fallback: !!usedNearestFallback,
    result_count: Array.isArray(resultRows) ? resultRows.length : 0
  };

  const inserted = await db.query(
    `INSERT INTO property_search_requests (user_phone, payload)
     VALUES ($1, $2::jsonb)
     RETURNING id`,
    [userPhone, JSON.stringify(payload)]
  );

  const requestId = inserted.rows[0]?.id;
  if (requestId) {
    const compactResults = (resultRows || []).map((row) => ({
      id: row.id,
      title: row.title,
      listing_type: row.listing_type,
      district: row.district,
      area: row.area,
      price: row.price,
      price_period: row.price_period,
      distance_km: Number.isFinite(Number(row.distance_km)) ? Number(row.distance_km) : null
    }));
    await db.query(
      `INSERT INTO search_results_cache (search_request_id, results_json)
       VALUES ($1, $2::jsonb)`,
      [requestId, JSON.stringify(compactResults)]
    );
  }
}

async function createNoMatchLead({
  userPhone,
  searchType = 'any',
  preferredArea = '',
  notes = ''
}) {
  await db.query(
    `INSERT INTO property_leads (phone, preferred_area, purpose, category, notes, payload)
     VALUES ($1, $2, 'search', $3, $4, $5::jsonb)`,
    [
      userPhone,
      preferredArea || null,
      searchType || 'any',
      notes || 'Auto-captured from WhatsApp no-match search.',
      JSON.stringify({
        source: 'whatsapp',
        search_type: searchType || 'any',
        preferred_area: preferredArea || null
      })
    ]
  );
}

function formatPropertySearchMessage(lang, rows, location, searchType) {
  const lines = [];
  lines.push(`🔎 *${t(lang, 'searchHeader')}* (${typeLabel(searchType, lang)} • ${location})`);
  lines.push('');
  rows.forEach((r, idx) => {
    lines.push(`${idx + 1}. *${r.title}*`);
    lines.push(`   ${typeLabel(r.listing_type, lang)} • ${r.area}, ${r.district}`);
    lines.push(`   ${formatPrice(r.price, r.price_period)}`);
    if (Number.isFinite(Number(r.distance_km))) {
      lines.push(`   📏 ${Number(r.distance_km).toFixed(1)} ${t(lang, 'kmAway')}`);
    }
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

function formatNoMatchReply(lang, preferredArea = '') {
  const code = resolveLangCode(lang);
  const area = normalizeInput(preferredArea);
  const areaText = area ? ` in *${area}*` : '';
  const messages = {
    en: `I do not have an approved match${areaText} right now. I have saved this request so MakaUg can follow up when a matching listing appears.\n\nBrowse live listings: ${HOME_URL}\n${t(code, 'menuHint')}`,
    lg: `Sifunye listing ekakasiddwa${areaText} kati. Nterese okusaba kuno MakaUg esobole okukuddamu nga listing efaanana efunye.\n\nLaba listings: ${HOME_URL}\n${t(code, 'menuHint')}`,
    sw: `Sijapata tangazo lililoidhinishwa${areaText} kwa sasa. Nimehifadhi ombi hili ili MakaUg ikujulishe likipatikana.\n\nTazama matangazo: ${HOME_URL}\n${t(code, 'menuHint')}`
  };
  return messages[code] || messages.en;
}

function intentRouteLabel(route) {
  const labels = {
    listing_type: 'list a property',
    search_type: 'search for a property',
    agent_area: 'find a broker',
    agent_registration: 'register as a broker',
    mortgage_help: 'open mortgage finder',
    account_help: 'get account/saved help',
    report_listing: 'report a listing',
    support: 'contact support'
  };
  return labels[route] || 'continue';
}

function menuRouteReply(lang, route) {
  if (route === 'listing_type') return { message: t(lang, 'askListingType'), nextStep: 'listing_type' };
  if (route === 'search_type') return { message: t(lang, 'askSearchType'), nextStep: 'search_type' };
  if (route === 'agent_area') return { message: t(lang, 'askAgentArea'), nextStep: 'agent_area' };
  if (route === 'agent_registration') {
    return { message: `📝 Register as a broker here: ${HOME_URL}/#page-brokers\n\n${t(lang, 'menuHint')}`, nextStep: 'main_menu' };
  }
  if (route === 'mortgage_help') {
    return { message: `🏦 Use Mortgage Finder here: ${HOME_URL}/#page-mortgage\n\n${t(lang, 'menuHint')}`, nextStep: 'main_menu' };
  }
  if (route === 'account_help') {
    return { message: `👤 Account help: ${HOME_URL}/#page-account\n❤️ Saved properties: ${HOME_URL}/#page-saved\n\n${t(lang, 'menuHint')}`, nextStep: 'main_menu' };
  }
  if (route === 'report_listing') {
    return {
      message: `🚨 Report a listing: ${HOME_URL}/#page-report\nSupport: ${process.env.SUPPORT_PHONE || '+256760112587'} | ${process.env.SUPPORT_EMAIL || 'info@makaug.com'}`,
      nextStep: 'main_menu'
    };
  }
  if (route === 'support') {
    return {
      message: `👋 Human support: ${process.env.SUPPORT_PHONE || '+256760112587'}\n📧 ${process.env.SUPPORT_EMAIL || 'info@makaug.com'}\n\n${t(lang, 'menuHint')}`,
      nextStep: 'main_menu'
    };
  }
  return { message: welcomeMessage(lang), nextStep: 'main_menu' };
}

function intentMenuRoute(intent) {
  const key = normalizeInput(intent).toLowerCase();
  if (key === 'property_listing') return 'listing_type';
  if (key === 'property_search' || key === 'looking_for_property_lead') return 'search_type';
  if (key === 'agent_search') return 'agent_area';
  if (key === 'agent_registration') return 'agent_registration';
  if (key === 'mortgage_help') return 'mortgage_help';
  if (key === 'account_help' || key === 'saved_properties') return 'account_help';
  if (key === 'report_listing') return 'report_listing';
  if (key === 'support') return 'support';
  return '';
}

// Step machine
const STEPS = [
  'greeting', 'choose_language', 'main_menu', 'listing_type', 'ownership', 'title', 'district',
  'area', 'price', 'bedrooms', 'description', 'photos', 'ask_deposit', 'ask_contract',
  'ask_university', 'ask_distance', 'ask_id_number', 'ask_selfie', 'ask_phone', 'search_type',
  'search_area', 'agent_area',
  'verify_otp', 'submitted'
];

async function processMessage(phone, body, mediaUrl, sharedLocation = null, runtime = {}) {
  const session = await getSession(phone);
  const lang = session.language || 'en';
  const step = session.current_step;
  const draft = session.listing_draft || {};
  const sessionData = session.session_data || {};
  const intentResult = runtime.intent || null;
  const cleanBody = normalizeInput(body);
  const bodyUpper = normUpper(body);
  const compactUpper = normalizeOptKeyword(bodyUpper);

  const respond = (msg, nextStep) => ({ message: msg, nextStep });

  if (!STEPS.includes(step)) {
    await updateSession(phone, { current_step: 'greeting' });
    return respond(welcomeMessage(lang), 'main_menu');
  }

  if (bodyUpper === 'RESET' || bodyUpper === 'RESTART') {
    await clearSessionData(phone);
    return respond(`${t(lang, 'restarted')}\n\n${t(lang, 'chooseLanguage')}`, 'choose_language');
  }

  if (bodyUpper === 'LANG' || bodyUpper === 'LANGUAGE') {
    return respond(`${t(lang, 'languageUpdated')}\n\n${t(lang, 'chooseLanguage')}`, 'choose_language');
  }

  if (['STOP', 'UNSUBSCRIBE', 'OPTOUT', 'OPT-OUT'].includes(compactUpper)) {
    await upsertWhatsappUserProfile(phone, {
      preferredLanguage: lang,
      marketingOptIn: false,
      optInSource: 'whatsapp_keyword_stop'
    });
    return respond('✅ You are unsubscribed from marketing updates. You will still receive listing/verification messages for active requests. Reply START anytime to opt in again.', 'main_menu');
  }

  if (['START', 'OPTIN', 'SUBSCRIBE'].includes(compactUpper)) {
    await upsertWhatsappUserProfile(phone, {
      preferredLanguage: lang,
      marketingOptIn: true,
      optInSource: 'whatsapp_keyword_start'
    });
    return respond('✅ You are now subscribed for MakaUg updates. Reply MENU to continue.', 'main_menu');
  }

  if (bodyUpper === 'MENU' || bodyUpper === 'HOME') {
    return respond(welcomeMessage(lang), 'main_menu');
  }

  if (isGreetingText(cleanBody)) {
    if (['greeting', 'main_menu', 'submitted'].includes(step)) {
      return respond(friendlyGreetingReply(lang), 'main_menu');
    }
    return respond(stepReminderMessage(lang, step), step);
  }

  const globalRoute = intentMenuRoute(intentResult?.intent);
  const globalIntentConfidence = Number(intentResult?.confidence || 0);
  const canSwitchFlow = globalRoute
    && step !== 'main_menu'
    && !['verify_otp', 'ask_id_number', 'ask_selfie'].includes(step)
    && globalIntentConfidence >= 0.6;

  if (canSwitchFlow) {
    const next = menuRouteReply(lang, globalRoute);
    await patchSessionData(phone, {
      interrupted_step: step,
      interrupted_at: new Date().toISOString(),
      interrupted_by_intent: intentResult.intent,
      interrupted_text: cleanBody
    });
    return respond(next.message, next.nextStep);
  }

  // GREETING
  if (step === 'greeting') {
    return respond(`${friendlyGreetingReply(lang)}\n\n${t(lang, 'chooseLanguage')}`, 'choose_language');
  }

  // CHOOSE LANGUAGE
  if (step === 'choose_language') {
    const langMap = { '1': 'en', '2': 'lg', '3': 'sw', '4': 'ac', '5': 'ny', '6': 'rn', '7': 'sm' };
    const chosen = langMap[cleanBody] || 'en';
    await updateSession(phone, { language: chosen });
    await clearSessionData(phone);
    return respond(welcomeMessage(chosen), 'main_menu');
  }

  // MAIN MENU
  if (step === 'main_menu') {
    const pendingIntent = sessionData.pending_intent_confirmation
      && typeof sessionData.pending_intent_confirmation === 'object'
      ? sessionData.pending_intent_confirmation
      : null;

    if (pendingIntent && pendingIntent.route) {
      if (isAffirmativeReply(cleanBody)) {
        await patchSessionData(phone, { pending_intent_confirmation: null });
        const next = menuRouteReply(lang, pendingIntent.route);
        return respond(next.message, next.nextStep);
      }

      if (isNegativeReply(cleanBody)) {
        await patchSessionData(phone, { pending_intent_confirmation: null });
        return respond(`${welcomeMessage(lang)}\n\n${t(lang, 'menuHint')}`, 'main_menu');
      }

      return respond(
        `I think you meant: *${intentRouteLabel(pendingIntent.route)}*.\nReply *YES* to continue or *NO* to stay on the main menu.`,
        'main_menu'
      );
    }

    if (cleanBody === '1') return respond(t(lang, 'askListingType'), 'listing_type');
    if (cleanBody === '2') return respond(t(lang, 'askSearchType'), 'search_type');
    if (cleanBody === '3') return respond(t(lang, 'askAgentArea'), 'agent_area');
    if (cleanBody === '9') return respond(t(lang, 'chooseLanguage'), 'choose_language');

    const naturalFilters = await resolveNaturalSearchFilters({
      text: cleanBody,
      entities: intentResult?.entities || {},
      fallbackType: 'any',
      language: lang,
      sessionData
    });
    const likelyPropertySearchIntent = ['property_search', 'looking_for_property_lead'].includes(intentResult?.intent);
    if (likelyPropertySearchIntent || naturalFilters.hasSignal) {
      if (naturalFilters.useSharedLocation) {
        await patchSessionData(phone, {
          search_type: naturalFilters.searchType || 'any',
          pending_search_filters: naturalFilters,
          natural_query_text: cleanBody
        });
        return respond(
          `📍 I can search around you.\n${describeNaturalFilters(naturalFilters) ? `Filters: ${describeNaturalFilters(naturalFilters)}\n` : ''}Please share your WhatsApp location now.`,
          'search_area'
        );
      }
      if (!naturalFilters.area) {
        await patchSessionData(phone, {
          search_type: naturalFilters.searchType || 'any',
          pending_search_filters: naturalFilters,
          natural_query_text: cleanBody
        });
        return respond(
          `🔎 I can search that for you.\n${describeNaturalFilters(naturalFilters) ? `Filters: ${describeNaturalFilters(naturalFilters)}\n` : ''}Please share the area or district.`,
          'search_area'
        );
      }

      const rows = await findPropertiesByNaturalFilters(naturalFilters);
      await logPropertySearchRequest({
        userPhone: phone,
        searchType: naturalFilters.searchType || 'any',
        queryText: cleanBody,
        location: null,
        resultRows: rows,
        usedNearestFallback: false
      });

      if (!rows.length) {
        await createNoMatchLead({
          userPhone: phone,
          searchType: naturalFilters.searchType || 'any',
          preferredArea: naturalFilters.area,
          notes: `No approved listings found for natural query: ${cleanBody}`
        });
        return respond(formatNoMatchReply(lang, naturalFilters.area), 'main_menu');
      }

      const fxNote = naturalFilters.convertedFromUsd
        ? '\n(Using approx FX: 1 USD = 3,800 UGX for matching.)\n'
        : '\n';
      return respond(
        `${describeNaturalFilters(naturalFilters) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters)}${fxNote}` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || 'any')}`,
        'main_menu'
      );
    }

    const inferredRoute = intentMenuRoute(intentResult?.intent);
    const inferredConfidence = Number(intentResult?.confidence || 0);
    const shouldConfirmIntent = inferredRoute
      && intentResult?.intent
      && intentResult.intent !== 'unknown'
      && inferredConfidence >= 0.45
      && inferredConfidence < 0.68;

    if (shouldConfirmIntent) {
      await patchSessionData(phone, {
        pending_intent_confirmation: {
          intent: intentResult.intent,
          route: inferredRoute,
          confidence: inferredConfidence,
          text: cleanBody,
          created_at: new Date().toISOString()
        }
      });
      return respond(
        `I think you want to *${intentRouteLabel(inferredRoute)}*.\nReply *YES* to continue or *NO* to stay on the main menu.`,
        'main_menu'
      );
    }

    if (inferredRoute) {
      const next = menuRouteReply(lang, inferredRoute);
      return respond(next.message, next.nextStep);
    }

    return respond(
      await conversationalAssistantFallback({
        phone,
        body: cleanBody,
        lang,
        step,
        intentResult,
        sessionData
      }),
      'main_menu'
    );
  }

  // SEARCH TYPE
  if (step === 'search_type') {
    const searchType = mapSearchTypeInput(cleanBody);
    if (searchType) {
      await patchSessionData(phone, { search_type: searchType });
      return respond(t(lang, 'askSearchArea'), 'search_area');
    }

    const naturalFilters = await resolveNaturalSearchFilters({
      text: cleanBody,
      entities: intentResult?.entities || {},
      fallbackType: 'any',
      language: lang,
      sessionData
    });
    if (!naturalFilters.hasSignal) return respond(`${t(lang, 'invalidInput')}\n\n${t(lang, 'askSearchType')}`, 'search_type');

    if (naturalFilters.useSharedLocation) {
      await patchSessionData(phone, {
        search_type: naturalFilters.searchType || 'any',
        pending_search_filters: naturalFilters,
        natural_query_text: cleanBody
      });
      return respond(
        `📍 Got it.\n${describeNaturalFilters(naturalFilters) ? `Filters: ${describeNaturalFilters(naturalFilters)}\n` : ''}Please share your WhatsApp location now.`,
        'search_area'
      );
    }

    if (!naturalFilters.area) {
      await patchSessionData(phone, {
        search_type: naturalFilters.searchType || 'any',
        pending_search_filters: naturalFilters,
        natural_query_text: cleanBody
      });
      return respond(
        `🔎 Got it.\n${describeNaturalFilters(naturalFilters) ? `Filters: ${describeNaturalFilters(naturalFilters)}\n` : ''}${t(lang, 'askSearchArea')}`,
        'search_area'
      );
    }

    const rows = await findPropertiesByNaturalFilters(naturalFilters);
    await logPropertySearchRequest({
      userPhone: phone,
      searchType: naturalFilters.searchType || 'any',
      queryText: cleanBody,
      location: null,
      resultRows: rows,
      usedNearestFallback: false
    });

    if (!rows.length) {
      await createNoMatchLead({
        userPhone: phone,
        searchType: naturalFilters.searchType || 'any',
        preferredArea: naturalFilters.area,
        notes: `No approved listings found for natural query: ${cleanBody}`
      });
      return respond(formatNoMatchReply(lang, naturalFilters.area), 'main_menu');
    }

    return respond(
      `${describeNaturalFilters(naturalFilters) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters)}\n` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || 'any')}`,
      'main_menu'
    );
  }

  // SEARCH AREA
  if (step === 'search_area') {
    const searchType = sessionData.search_type || 'any';
    const pendingFilters = sessionData.pending_search_filters && typeof sessionData.pending_search_filters === 'object'
      ? sessionData.pending_search_filters
      : null;
    if (sharedLocation && Number.isFinite(Number(sharedLocation.lat)) && Number.isFinite(Number(sharedLocation.lng))) {
      await patchSessionData(phone, {
        search_lat: Number(sharedLocation.lat),
        search_lng: Number(sharedLocation.lng),
        search_location_label: sharedLocation.address || sharedLocation.label || null,
        pending_search_filters: null
      });

      const locationText = sharedLocation.address
        || sharedLocation.label
        || `${Number(sharedLocation.lat).toFixed(4)}, ${Number(sharedLocation.lng).toFixed(4)}`;
      const near = pendingFilters
        ? await findPropertiesNearWhatsappWithFilters(searchType, sharedLocation, pendingFilters)
        : await findPropertiesNearWhatsapp(searchType, sharedLocation);
      await logPropertySearchRequest({
        userPhone: phone,
        searchType: pendingFilters?.searchType || searchType,
        queryText: '',
        location: {
          lat: Number(sharedLocation.lat),
          lng: Number(sharedLocation.lng),
          label: locationText
        },
        resultRows: near.rows,
        usedNearestFallback: near.usedNearestFallback
      });
      if (!near.rows.length) {
        await createNoMatchLead({
          userPhone: phone,
          searchType: pendingFilters?.searchType || searchType,
          preferredArea: locationText,
          notes: 'No approved listings found from shared location search.'
        });
        return respond(formatNoMatchReply(lang, locationText), 'main_menu');
      }

      const extra = near.usedNearestFallback ? `\n${t(lang, 'searchNoNearbyResults')}\n` : '\n';
      return respond(
        `${t(lang, 'locationSharedReceived')}${extra}${pendingFilters ? `\n${describeNaturalFilters(pendingFilters) ? `Filters: ${describeNaturalFilters(pendingFilters)}\n` : ''}` : ''}\n${formatPropertySearchMessage(lang, near.rows, locationText, pendingFilters?.searchType || searchType)}`,
        'main_menu'
      );
    }

    let naturalFilters = null;
    if (pendingFilters) {
      naturalFilters = { ...pendingFilters };
      if (!naturalFilters.area && cleanBody.length >= 2) naturalFilters.area = cleanBody;
      naturalFilters.searchType = naturalFilters.searchType || searchType || 'any';
    } else {
      const parsed = await resolveNaturalSearchFilters({
        text: cleanBody,
        entities: intentResult?.entities || {},
        fallbackType: searchType || 'any',
        language: lang,
        sessionData
      });
      if (parsed.hasSignal) naturalFilters = parsed;
    }

    if (naturalFilters && naturalFilters.area) {
      const rows = await findPropertiesByNaturalFilters(naturalFilters);
      await patchSessionData(phone, { pending_search_filters: null });
      await logPropertySearchRequest({
        userPhone: phone,
        searchType: naturalFilters.searchType || 'any',
        queryText: cleanBody,
        location: null,
        resultRows: rows,
        usedNearestFallback: false
      });
      if (!rows.length) {
        await createNoMatchLead({
          userPhone: phone,
          searchType: naturalFilters.searchType || 'any',
          preferredArea: naturalFilters.area,
          notes: `No approved listings found for natural query in search_area: ${cleanBody}`
        });
        return respond(formatNoMatchReply(lang, naturalFilters.area), 'main_menu');
      }
      return respond(
        `${describeNaturalFilters(naturalFilters) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters)}\n` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || searchType || 'any')}`,
        'main_menu'
      );
    }

    if (cleanBody.length < 2) return respond(t(lang, 'askSearchArea'), 'search_area');
    const rows = await findPropertiesForWhatsapp(searchType, cleanBody);
    await logPropertySearchRequest({
      userPhone: phone,
      searchType,
      queryText: cleanBody,
      location: null,
      resultRows: rows,
      usedNearestFallback: false
    });

    if (!rows.length) {
      await createNoMatchLead({
        userPhone: phone,
        searchType,
        preferredArea: cleanBody,
        notes: 'No approved listings found from typed area search.'
      });
      return respond(formatNoMatchReply(lang, cleanBody), 'main_menu');
    }

    return respond(formatPropertySearchMessage(lang, rows, cleanBody, searchType), 'main_menu');
  }

  // AGENT AREA SEARCH
  if (step === 'agent_area') {
    if (sharedLocation && Number.isFinite(Number(sharedLocation.lat)) && Number.isFinite(Number(sharedLocation.lng))) {
      const inferred = await inferAgentSearchFromSharedLocation(sharedLocation, sessionData);
      const rows = await findAgentsForWhatsappKeywords(inferred.keywords, inferred.preferredAgentIds);
      if (!rows.length) {
        return respond(
          `${t(lang, 'noAgentsFound')}\n\n${tt(lang, 'seeAllAgents', { url: `${HOME_URL}/#page-brokers` })}\n${t(lang, 'menuHint')}`,
          'main_menu'
        );
      }
      return respond(formatAgentSearchMessage(lang, rows, inferred.locationLabel), 'main_menu');
    }

    if (isNearMeQuery(cleanBody)) {
      return respond(
        `📍 Share your WhatsApp location and I will send brokers near you.\n\n${t(lang, 'menuHint')}`,
        'agent_area'
      );
    }

    if (cleanBody.length < 2) {
      return respond(
        `${t(lang, 'askAgentArea')}\n\n📍 Or share your WhatsApp location to find brokers near you.`,
        'agent_area'
      );
    }

    const keywords = extractAgentSearchKeywords(cleanBody, sessionData);
    const rows = await findAgentsForWhatsappKeywords(keywords);
    if (!rows.length) {
      return respond(
        `${t(lang, 'noAgentsFound')}\n\n${tt(lang, 'seeAllAgents', { url: `${HOME_URL}/#page-brokers` })}\n${t(lang, 'menuHint')}`,
        'main_menu'
      );
    }

    const locationLabel = keywords[0] || cleanBody;
    return respond(formatAgentSearchMessage(lang, rows, locationLabel), 'main_menu');
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
      if (currentPhotos.length < 5) return respond(t(lang, 'needExactlyFivePhotos'), 'photos');
      return respond(t(lang, 'askIDNumber'), 'ask_id_number');
    }
    if (mediaUrl) {
      const photos = draft.photos || [];
      if (photos.length >= 5) {
        return respond(tt(lang, 'photosUploaded', { count: photos.length }), 'photos');
      }
      photos.push(mediaUrl);
      await patchDraft(phone, { photos });
      const count = photos.length;
      if (count >= 5) return respond(tt(lang, 'photosUploaded', { count }), 'photos');
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
        const photos = d.photos.slice(0, 5);
        for (let i = 0; i < photos.length; i += 1) {
          await db.query(
            'INSERT INTO property_images (property_id, url, is_primary, sort_order) VALUES ($1, $2, $3, $4)',
            [propertyId, photos[i], i === 0, i]
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
    return respond(welcomeMessage(lang), 'main_menu');
  }

  return respond(t(lang, 'invalidInput'), step);
}

async function processInboundRuntime({
  phone,
  inboundMessageId = null,
  body = '',
  mediaUrl = null,
  mediaType = '',
  sharedLocation = null,
  provider = 'whatsapp'
}) {
  logger.info(
    `WhatsApp message from ${phone}: "${String(body || '').substring(0, 50)}"${
      mediaUrl ? ' [media]' : ''
    }${sharedLocation ? ' [location]' : ''} [${provider}]`
  );

  const session = await getSession(phone);
  const sessionLang = session.language || 'en';
  const sessionStep = session.current_step || 'greeting';
  const conversationControl = await getWhatsappConversationControl(phone);

  let effectiveBody = normalizeInput(body);
  let transcriptRecord = null;
  const normalizedMediaType = String(mediaType || '').toLowerCase();
  const isAudioNote = mediaUrl && normalizedMediaType.startsWith('audio/');

  if (isAudioNote) {
    transcriptRecord = await transcribeAudioFromUrl(mediaUrl, normalizedMediaType || 'audio/ogg');
    if (transcriptRecord?.text) effectiveBody = transcriptRecord.text;
  }

  const messageType = sharedLocation
    ? 'location'
    : (isAudioNote ? 'voice' : (mediaUrl ? 'media' : 'text'));

  await logWhatsappMessage({
    userPhone: phone,
    waMessageId: inboundMessageId,
    direction: 'inbound',
    messageType,
    payload: {
      provider,
      body,
      effectiveBody,
      mediaUrl,
      mediaType: normalizedMediaType,
      sharedLocation
    }
  });

  if (transcriptRecord?.text) {
    await saveTranscription({
      userPhone: phone,
      waMessageId: inboundMessageId,
      transcript: transcriptRecord.text,
      detectedLanguage: transcriptRecord.language || null,
      mediaUrl
    });
  }

  const intentResult = await classifyWhatsappIntent({
    text: effectiveBody,
    language: sessionLang,
    step: sessionStep,
    sessionData: session.session_data || {}
  });
  const detectedLanguage = resolveDetectedLanguage({
    text: effectiveBody,
    sessionLang,
    intentResult
  });
  const runtimeLang = detectedLanguage.code || sessionLang;
  if (
    runtimeLang
    && runtimeLang !== sessionLang
    && detectedLanguage.source !== 'session'
    && Number(detectedLanguage.confidence || 0) >= 0.84
  ) {
    await updateSession(phone, { language: runtimeLang });
  }

  await logIntent({
    userPhone: phone,
    waMessageId: inboundMessageId,
    detectedIntent: intentResult.intent,
    confidence: intentResult.confidence,
    language: runtimeLang,
    currentStep: sessionStep,
    rawText: body,
    transcript: transcriptRecord?.text || null,
    entities: intentResult.entities || {},
    modelUsed: intentResult.model || null
  });

  const shouldPauseAutomation = ['off', 'copilot'].includes(String(conversationControl?.ai_mode || '').toLowerCase())
    || ['needs_human', 'escalated'].includes(String(conversationControl?.status || '').toLowerCase());

  if (shouldPauseAutomation) {
    await updateSession(phone, { current_step: sessionStep, current_intent: intentResult.intent || null });
    await upsertWhatsappUserProfile(phone, {
      preferredLanguage: runtimeLang,
      metadata: {
        last_intent: intentResult.intent || 'unknown',
        last_step: sessionStep,
        automation_paused: true
      }
    });
    await syncWhatsappConversationState({
      phone,
      direction: 'inbound',
      intent: intentResult.intent,
      preferredLanguage: runtimeLang,
      currentStep: sessionStep,
      provider,
      messageType,
      metadata: {
        automation_paused: true,
        paused_reason: conversationControl?.status || conversationControl?.ai_mode || 'manual_review'
      }
    });

    return { message: humanHandoffAck(runtimeLang), nextStep: sessionStep };
  }

  const { message, nextStep } = await processMessage(
    phone,
    effectiveBody,
    mediaUrl,
    sharedLocation,
    { intent: intentResult, mediaType: normalizedMediaType, transcript: transcriptRecord?.text || null }
  );

  await updateSession(phone, { current_step: nextStep, current_intent: intentResult.intent || null });
  const refreshedSession = await getSession(phone);
  await upsertWhatsappUserProfile(phone, {
    preferredLanguage: refreshedSession.language || runtimeLang,
    metadata: {
      last_intent: intentResult.intent || 'unknown',
      last_step: nextStep
    }
  });

  await syncWhatsappConversationState({
    phone,
    direction: 'inbound',
    intent: intentResult.intent,
    preferredLanguage: refreshedSession.language || runtimeLang,
    currentStep: nextStep,
    provider,
    messageType,
    metadata: {
      last_inbound_message_id: inboundMessageId || null
    }
  });

  return { message, nextStep };
}

// GET /api/whatsapp/webhook
// WhatsApp Cloud API verification endpoint
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && String(token) === WHATSAPP_VERIFY_TOKEN) {
    logger.info('Meta WhatsApp webhook verified successfully');
    return res.status(200).send(String(challenge || ''));
  }

  logger.warn('Meta WhatsApp webhook verification failed');
  return res.sendStatus(403);
});

// POST /api/whatsapp/webhook
// Supports BOTH:
// - Meta WhatsApp Cloud API payload
// - Twilio webhook payload (legacy fallback)
router.post('/webhook', async (req, res) => {
  try {
    // Meta WhatsApp Cloud API mode
    if (isMetaWebhookPayload(req.body)) {
      const inboundMessages = await parseMetaInboundMessages(req.body);
      if (!inboundMessages.length) return res.status(200).json({ ok: true, ignored: true });

      for (const inbound of inboundMessages) {
        try {
          const { message, nextStep } = await processInboundRuntime({
            phone: inbound.phone,
            inboundMessageId: inbound.inboundMessageId,
            body: inbound.body,
            mediaUrl: inbound.mediaUrl,
            mediaType: inbound.mediaType,
            sharedLocation: inbound.sharedLocation,
            provider: 'meta'
          });

          await sendMetaTextMessage(inbound.phone, message);
          await logWhatsappMessage({
            userPhone: inbound.phone,
            waMessageId: null,
            direction: 'outbound',
            messageType: 'text',
            payload: {
              provider: 'meta',
              reply: message,
              nextStep
            }
          });
          await syncWhatsappConversationState({
            phone: inbound.phone,
            direction: 'outbound',
            preferredLanguage: nextStep === 'choose_language' ? 'en' : null,
            currentStep: nextStep,
            provider: 'meta',
            messageType: 'text',
            ai: true,
            metadata: {
              source: 'whatsapp_runtime',
              last_reply_preview: String(message || '').slice(0, 240)
            }
          });
        } catch (err) {
          logger.error(`Meta inbound processing failed for ${inbound.phone}`, err);
        }
      }

      // Meta expects a quick 200 ACK.
      return res.status(200).json({ ok: true });
    }

    // Twilio fallback mode
    const { From, Body, MediaUrl0, MediaContentType0, NumMedia, MessageSid, SmsSid } = req.body;
    if (!From) return res.status(400).send('Missing From');

    const phone = From.replace('whatsapp:', '');
    const inboundMessageId = MessageSid || SmsSid || null;
    const body = (Body || '').trim();
    const mediaUrl = NumMedia && parseInt(NumMedia, 10) > 0 ? MediaUrl0 : null;
    const mediaType = mediaUrl ? String(MediaContentType0 || '').toLowerCase() : '';
    const sharedLocation = parseInboundLocation(req.body);

    const { message, nextStep } = await processInboundRuntime({
      phone,
      inboundMessageId,
      body,
      mediaUrl,
      mediaType,
      sharedLocation,
      provider: 'twilio'
    });

    const MessagingResponse = require('twilio').twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    twiml.message(message);

    await logWhatsappMessage({
      userPhone: phone,
      waMessageId: null,
      direction: 'outbound',
      messageType: 'text',
      payload: {
        provider: 'twilio',
        reply: message,
        nextStep
      }
    });
    await syncWhatsappConversationState({
      phone,
      direction: 'outbound',
      preferredLanguage: nextStep === 'choose_language' ? 'en' : null,
      currentStep: nextStep,
      provider: 'twilio',
      messageType: 'text',
      ai: true,
      metadata: {
        source: 'whatsapp_runtime',
        last_reply_preview: String(message || '').slice(0, 240)
      }
    });

    res.type('text/xml');
    return res.send(twiml.toString());
  } catch (err) {
    logger.error('WhatsApp webhook error:', err);

    if (isMetaWebhookPayload(req.body)) {
      // Still ACK Meta to avoid perpetual retries on unrecoverable payloads.
      return res.status(200).json({ ok: false, error: 'processing_failed' });
    }

    const MessagingResponse = require('twilio').twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    twiml.message(tt('en', 'genericWebhookError', { url: HOME_URL }));
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

// POST /api/whatsapp/web-bridge/heartbeat
router.post('/web-bridge/heartbeat', async (req, res) => {
  if (!isWhatsappWebBridgeAuthorized(req)) return bridgeUnauthorized(res);

  const client = await upsertWhatsappWebBridgeClient({
    clientId: req.body.client_id || 'web_bridge',
    operatorName: req.body.operator_name || null,
    status: req.body.status || 'online',
    browserName: req.body.browser_name || 'Google Chrome',
    profileDir: req.body.profile_dir || null,
    currentUrl: req.body.current_url || null,
    activeChatKey: req.body.active_chat_key || null,
    unreadCount: req.body.unread_count || 0,
    lastError: req.body.last_error || null,
    stats: req.body.stats || {},
    metadata: req.body.metadata || {}
  });

  return res.json({ ok: true, data: client });
});

// POST /api/whatsapp/web-bridge/inbound
router.post('/web-bridge/inbound', async (req, res) => {
  if (!isWhatsappWebBridgeAuthorized(req)) return bridgeUnauthorized(res);

  const phone = normalizeBridgeInboundKey(req.body.phone || req.body.chat_key || req.body.contact_key);
  const body = normalizeInput(req.body.body || req.body.text || '');
  const mediaUrl = normalizeInput(req.body.media_url || req.body.mediaUrl);
  const mediaType = normalizeInput(req.body.media_type || req.body.mediaType).toLowerCase();
  const sharedLocation = parseInboundLocation(req.body.shared_location || req.body.location || req.body);
  const dryRun = ['1', 'true', 'yes'].includes(String(req.body.dry_run || req.body.dryRun || '').trim().toLowerCase());
  const inboundMessageId = createBridgeMessageId({
    phone,
    body,
    createdAt: req.body.created_at || req.body.timestamp || '',
    providerMessageId: req.body.message_id || req.body.provider_message_id || '',
    mediaType
  });

  if (!phone) {
    return res.status(400).json({ ok: false, error: 'phone or chat_key is required' });
  }
  if (!body && !mediaUrl && !sharedLocation) {
    return res.status(400).json({ ok: false, error: 'body, media, or location is required' });
  }

  const alreadySeen = await db.query(
    'SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1',
    [inboundMessageId]
  );
  if (alreadySeen.rows.length) {
    return res.json({ ok: true, duplicate: true, inbound_message_id: inboundMessageId });
  }

  if (req.body.client_id) {
    await upsertWhatsappWebBridgeClient({
      clientId: req.body.client_id,
      operatorName: req.body.operator_name || null,
      status: req.body.status || 'online',
      browserName: req.body.browser_name || 'Google Chrome',
      activeChatKey: phone,
      unreadCount: req.body.unread_count || 0,
      currentUrl: req.body.current_url || null,
      stats: req.body.stats || {},
      metadata: {
        ...(req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}),
        last_inbound_message_id: inboundMessageId
      }
    });
  }

  const { message, nextStep } = await processInboundRuntime({
    phone,
    inboundMessageId,
    body,
    mediaUrl: mediaUrl || null,
    mediaType,
    sharedLocation,
    provider: 'web_bridge'
  });

  let queuedReply = null;
  if (message && !dryRun) {
    queuedReply = await queueWhatsappWebBridgeAutoReply({
      phone,
      message,
      nextStep,
      source: 'whatsapp_runtime',
      actorId: 'system'
    });
  }

  return res.json({
    ok: true,
    data: {
      inbound_message_id: inboundMessageId,
      next_step: nextStep,
      message,
      dry_run: dryRun,
      queued_reply: !!queuedReply,
      queue_id: queuedReply?.id || null
    }
  });
});

// GET /api/whatsapp/web-bridge/outbox
router.get('/web-bridge/outbox', async (req, res) => {
  if (!isWhatsappWebBridgeAuthorized(req)) return bridgeUnauthorized(res);

  const clientId = normalizeInput(req.query.client_id || req.headers['x-whatsapp-web-bridge-client'] || 'web_bridge');
  const messages = await claimWhatsappWebBridgeMessages({
    clientId,
    limit: req.query.limit || 10
  });

  return res.json({
    ok: true,
    data: messages.map((row) => ({
      id: row.id,
      recipient: row.user_phone,
      text: row.payload?.text || '',
      source: row.metadata?.source || 'system',
      actor_id: row.metadata?.actor_id || null,
      metadata: row.metadata || {},
      created_at: row.created_at,
      attempts: row.attempts || 0
    }))
  });
});

// POST /api/whatsapp/web-bridge/outbox/:id/sent
router.post('/web-bridge/outbox/:id/sent', async (req, res) => {
  if (!isWhatsappWebBridgeAuthorized(req)) return bridgeUnauthorized(res);

  const updated = await markWhatsappWebBridgeMessageSent(req.params.id, {
    bridge_client_id: req.body.client_id || null,
    bridge_sent_at: new Date().toISOString(),
    bridge_message_id: req.body.bridge_message_id || null
  });

  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Queued message not found' });
  }

  const replyText = String(updated.payload?.text || '').trim();
  const source = String(updated.metadata?.source || '').trim().toLowerCase();

  await logWhatsappMessage({
    userPhone: updated.user_phone,
    waMessageId: req.body.bridge_message_id || null,
    direction: 'outbound',
    messageType: 'text',
    payload: {
      provider: 'web_bridge',
      reply: replyText,
      source: source || 'web_bridge',
      bridge_client_id: req.body.client_id || null
    }
  });

  await syncWhatsappConversationState({
    phone: updated.user_phone,
    direction: 'outbound',
    provider: 'web_bridge',
    messageType: 'text',
    ai: source.includes('ai') || source === 'whatsapp_runtime',
    human: !(source.includes('ai') || source === 'whatsapp_runtime'),
    metadata: {
      source: source || 'web_bridge',
      bridge_client_id: req.body.client_id || null,
      last_reply_preview: replyText.slice(0, 240)
    }
  });

  return res.json({ ok: true, data: updated });
});

// POST /api/whatsapp/web-bridge/outbox/:id/failed
router.post('/web-bridge/outbox/:id/failed', async (req, res) => {
  if (!isWhatsappWebBridgeAuthorized(req)) return bridgeUnauthorized(res);

  const updated = await markWhatsappWebBridgeMessageFailed(
    req.params.id,
    req.body.error || 'bridge_send_failed',
    {
      bridge_client_id: req.body.client_id || null,
      bridge_failed_at: new Date().toISOString()
    }
  );

  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Queued message not found' });
  }

  if (req.body.client_id) {
    await upsertWhatsappWebBridgeClient({
      clientId: req.body.client_id,
      status: 'degraded',
      lastError: req.body.error || 'bridge_send_failed',
      metadata: {
        last_failed_queue_id: req.params.id
      }
    });
  }

  return res.json({ ok: true, data: updated });
});

// POST /api/whatsapp/test
// For testing in development
router.post('/test', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });

  const { phone = '+256760112587', body = '1', mediaUrl, mediaType = '' } = req.body;
  const sharedLocation = parseInboundLocation(req.body.location || req.body);

  const session = await getSession(phone);
  const intent = await classifyWhatsappIntent({
    text: body,
    language: session.language || 'en',
    step: session.current_step || 'greeting',
    sessionData: session.session_data || {}
  });
  const result = await processMessage(phone, body, mediaUrl, sharedLocation, { intent, mediaType });
  await updateSession(phone, { current_step: result.nextStep, current_intent: intent.intent || null });
  const refreshedSession = await db.query('SELECT * FROM whatsapp_sessions WHERE phone = $1', [phone]);

  return res.json({
    botResponse: result.message,
    nextStep: result.nextStep,
    intent,
    session: refreshedSession.rows[0]
  });
});

// DELETE /api/whatsapp/reset
router.delete('/reset/:phone', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });
  await db.query('DELETE FROM whatsapp_sessions WHERE phone = $1', [req.params.phone]);
  return res.json({ reset: true });
});

module.exports = router;
module.exports.__test = {
  processInboundRuntime,
  parseInboundLocation,
  normalizeBridgeInboundKey
};
