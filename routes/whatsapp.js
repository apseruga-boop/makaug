const express = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const smsService = require('../models/smsService');
const logger = require('../config/logger');
const { DISTRICTS } = require('../utils/constants');
const {
  classifyWhatsappIntent,
  detectWhatsappLanguage,
  suggestWhatsappAssistantReply,
  transcribeAudioFromUrl,
  transcribeAudioFromDataUrl,
  extractNaturalPropertyQuery
} = require('../services/aiService');
const {
  getWhatsappConversationControl,
  syncWhatsappConversationState
} = require('../services/whatsappConversationService');
const { sendSupportEmail } = require('../services/emailService');
const {
  claimWhatsappWebBridgeMessages,
  getWhatsappWebBridgeToken,
  markWhatsappWebBridgeMessageFailed,
  markWhatsappWebBridgeMessageSent,
  queueWhatsappWebBridgeMessage,
  upsertWhatsappWebBridgeClient
} = require('../services/whatsappWebBridgeService');
const { captureLearningEvent } = require('../services/aiLearningCaptureService');
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
    askOwnership: '✅ Are you the owner of this property, or an agent listing on behalf of an owner?\n1️⃣ I am the owner\n2️⃣ I am an agent',
    askFieldAgent: '🤝 Has a MakaUg field agent helped you with this listing?\n1️⃣ Yes\n2️⃣ No',
    askFieldAgentDetails: 'Please send the field agent name or phone number so we can credit the right person.',
    askTitle: '✏️ Give your property a short title (e.g. "3-bedroom house in Ntinda Kampala"):',
    askDistrict: '📍 Which district is the property in? (e.g. Kampala, Wakiso, Mukono, Jinja...)',
    askArea: '🗺️ What area or neighbourhood? (e.g. Kololo, Ntinda, Bugolobi...)',
    askPrice: '💰 What is your asking price in Uganda Shillings? (numbers only, e.g. 250000000)',
    askBedrooms: '🛏 How many bedrooms does the property have? (Enter a number, or 0 if N/A)',
    askDescription: '📝 Describe your property in a few sentences (location, features, condition...)',
    askPhotos: '📸 Please send the *front/outside* photo first.',
    askPublicName: '👤 What public contact name should appear on the listing? (For example: Amina, Amina Properties, or Private Owner)',
    askContactMethod: '📲 How should serious viewers contact you?\n1️⃣ WhatsApp / phone\n2️⃣ Email',
    askContactValuePhone: '📱 Please send the WhatsApp/phone number for listing enquiries.\nFormat: +256 7XX XXX XXX',
    askContactValueEmail: '✉️ Please send the email address for listing enquiries.',
    askIDNumber: '🪪 For security, we need your National ID Number (NIN). This is required to prevent fraud and will not be publicly shown.\n\nPlease type your NIN:',
    askSelfie: '🤳 Please take a clear selfie (photo of yourself) holding your National ID card and send it here. This verifies you are real and reduces fraud.',
    askPhone: '📱 What is your mobile phone number (for verification)?\nFormat: +256 7XX XXX XXX',
    otpSent: "📲 We've sent a 6-digit code to your phone via SMS. Please type that code here to verify:",
    otpSentEmail: "✉️ We've sent a 6-digit code to your email. Please type that code here to verify:",
    listingSubmitted: "🎉 *Your listing has been submitted!*\n\nOur team will review it and make it live within 24 hours.\n\n🔗 You'll receive a link to your listing once approved.\n\nReference: #{ref}\n\n✅ Next step: set up your profile to track listing views, saves, and enquiries.\n\nThank you for using MakaUg! 🏠🇺🇬",
    invalidInput: "❓ Sorry, I didn't understand that. Please reply with one of the options above.",
    verifyOTP: 'Please type the 6-digit code we sent via SMS:',
    otpSuccess: '✅ Phone verified!',
    otpFailed: '❌ Incorrect code. Please try again or type RESEND for a new code.',
    askDeposit: '💵 What is the deposit amount required? (in UGX, numbers only)',
    askContract: '📅 What is the minimum contract length in months? (e.g. 6, 12, 24)',
    askUniversity: '🎓 Which is the nearest university? (e.g. Makerere, Kyambogo, UCU...)',
    askDistance: '🚶 How far is the property from the university (in km)? (e.g. 0.5, 1, 2)',
    askSearchType: '🔎 What are you looking for?\n1️⃣ For sale\n2️⃣ To rent\n3️⃣ Land\n4️⃣ Student accommodation\n5️⃣ Commercial property\n6️⃣ Anything',
    askSearchArea: '📍 Which area or district are you looking in? You can also share your WhatsApp location.',
    locationSharedReceived: '📍 Location received. I am searching within 5 miles of you first.',
    searchNoNearbyResults: 'No approved listings found within 5 miles. Showing the nearest available options.',
    widenNearbySearch: 'Reply *WIDEN* if you want me to expand the search area.',
    kmAway: 'km away',
    searchNoResults: 'I do not have an approved matching listing right now.',
    askAgentArea: '👔 Which district or area do you need an agent for? (for example Kampala, Wakiso, Mbarara). You can also share your location.',
    noAgentsFound: 'I do not have a verified agent matching that area right now.',
    menuHint: 'Type MENU anytime to return to the main menu.',
    languageUpdated: '✅ Language updated.',
    restarted: '🔄 Session restarted.',
    searchHeader: 'Best matching properties',
    agentHeader: 'Verified agents',
    titleTooShort: 'Title is too short. Please give a descriptive title.',
    invalidPrice: '❌ Please enter a valid price in UGX (numbers only, e.g. 250000000)',
    descriptionTooShort: 'Please write a longer description (at least 10 characters).',
    needAtLeastOnePhoto: '❌ Please send all 5 required photos before typing DONE.',
    needExactlyFivePhotos: '❌ Please upload exactly 5 photos: front, sitting room, bedroom, kitchen, bathroom.',
    photosUploaded: "📸 You've uploaded {count} photos. Type *DONE* to continue, or send any extra helpful photos.",
    photoReceived: '✅ Photo {count} received.',
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
    voiceNotUnderstood: "🎙️ I received your voice note, but I couldn't understand it clearly. Please send it again in a clear voice, or type the message.",
    voiceTranscriptionUnavailable: "🎙️ I received your voice note, but voice transcription is not switched on yet. Please type the message for now.",
    voiceTranscriptEcho: '🎙️ You said: "{transcript}"',
    genericSaveError: '❌ Something went wrong saving your listing. Please try again or visit {url}',
    genericWebhookError: 'Sorry, something went wrong. Please try again or visit {url}'
  },
  lg: {
    welcome: "🏠 Tukusuubiza ku *MakaUg* - eyitwa wangu ya property mu Uganda!\n\nOyagala kukola ki?\n1️⃣ Okwetayirira eby'ensi byange\n2️⃣ Okunoonyereza ensi\n3️⃣ Okunoonya musomesa\n\nSuula 1, 2 oba 3",
    chooseLanguage: 'Choose your language / Gyenda mu lulimi lwo:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
    askListingType: "🏠 Kyoyetaagadde okutereka kya ki?\n1️⃣ Enju/Ensi okutunda\n2️⃣ Enju okusasula\n3️⃣ Ttaka\n4️⃣ Eby'okulala by'abayizi\n5️⃣ Ensi ez'ebikolwa",
    askOwnership: "✅ Ggwe nnyini ensi ono oba agent?\n1️⃣ Nze nnyini\n2️⃣ Nze agent",
    askFieldAgent: '🤝 Waliwo field agent wa MakaUg eyakuyambye ku listing eno?\n1️⃣ Yee\n2️⃣ Nedda',
    askFieldAgentDetails: 'Mpandiikira erinnya oba ennamba ya field agent tumumanye bulungi.',
    askTitle: '✏️ Nyumba yoyo ejjiire etya? (e.g. "Enyumba esatu Ntinda Kampala"):',
    askDistrict: '📍 Ensi eno eri mu kitundu ki? (e.g. Kampala, Wakiso, Mukono...)',
    askArea: '🗺️ Ekitundu ekitonotono ki? (e.g. Kololo, Ntinda, Bugolobi...)',
    askPrice: '💰 Ebbeeyi yayo mu Shillingi za Uganda bwoba nyo? (ennamba zokka)',
    askBedrooms: "🛏 Eddiini ezingaana? (Okwandika ennamba, oba 0 bw'etaba)",
    askDescription: '📝 Teeka ennukuta ntono ku ensi eno (otuutu, ebintu, embeera...)',
    askPhotos: '📸 Weereza ekifaananyi kya *front/outside* okusooka.',
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
    locationSharedReceived: '📍 Location yo efuniddwa. Nnoonya mu miles 5 ezikuli okumpi okusooka...',
    searchNoNearbyResults: 'Tewali listings ezikkiriziddwa munda wa miles 5. Tukulaga eziri okumpi eziriwo.',
    widenNearbySearch: 'Ddamu *WIDEN* bwoyagala ngaziye ekitundu kyokunoonya.',
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
    voiceNotUnderstood: '🎙️ Nfunye voice note yo naye sitegedde bulungi. Ddamu ogyogere bulungi oba wandiika message yo.',
    voiceTranscriptionUnavailable: '🎙️ Nfunye voice note yo, naye transcription tennaba kukoleezebwa. Nkwegayiridde wandiika message yo kati.',
    voiceTranscriptEcho: '🎙️ Ogambye nti: "{transcript}"',
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
    askPhotos: '📸 Tuma picha ya *mbele/nje* kwanza.',
    listingSubmitted: '🎉 *Mali yako imewasilishwa!*\n\nRef: #{ref}\n\n✅ Hatua inayofuata: weka profile yako ili kufuatilia views, saves na enquiries za tangazo lako.\n\nAsante kwa kutumia MakaUg! 🏠🇺🇬',
    invalidInput: '❓ Sijaelewa. Tafadhali jibu kwa mojawapo ya chaguo.',
    otpSent: '📲 Tumetuma nambari ya siri kwa SMS yako. Andika hapa:',
    otpSuccess: '✅ Nambari ya simu imethibitishwa!',
    otpFailed: '❌ Nambari si sahihi. Jaribu tena.',
    askSearchType: '🔎 Unatafuta nini?\n1️⃣ Ya kuuza\n2️⃣ Ya kupangisha\n3️⃣ Ardhi\n4️⃣ Makazi ya wanafunzi\n5️⃣ Biashara\n6️⃣ Mali yoyote',
    askSearchArea: '📍 Andika eneo, wilaya au mahali unapotafuta (mf. Ntinda, Kampala, Wakiso), au tuma location yako kwenye WhatsApp:',
    locationSharedReceived: '📍 Location yako imepokelewa. Natafuta kwanza ndani ya maili 5 karibu nawe...',
    searchNoNearbyResults: 'Hakuna mali zilizoidhinishwa ndani ya maili 5. Tunaonyesha chaguo za karibu zilizopo.',
    widenNearbySearch: 'Jibu *WIDEN* kama unataka nipanue eneo la utafutaji.',
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
    voiceTranscriptEcho: '🎙️ Umesema: "{transcript}"',
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

Object.assign(T.sw, {
  languageUpdated: '✅ Lugha imesasishwa.',
  restarted: '🔄 Mazungumzo yameanza upya.',
  askOwnership: '✅ Wewe ndiye mmiliki wa mali hii, au ni wakala?\n1️⃣ Mimi ni mmiliki\n2️⃣ Mimi ni wakala',
  askFieldAgent: '🤝 Je, field agent wa MakaUg amekusaidia na tangazo hili?\n1️⃣ Ndiyo\n2️⃣ Hapana',
  askFieldAgentDetails: 'Tuma jina au namba ya field agent ili tumtambue vizuri.',
  askBedrooms: '🛏 Mali ina vyumba vingapi vya kulala? (Andika nambari, au 0 kama haihusiki)',
  askDescription: '📝 Eleza mali yako kwa sentensi chache (eneo, vipengele, hali...)',
  askPublicName: '👤 Jina gani lionekane kwenye tangazo? (mfano Amina, Amina Properties, au Private Owner)',
  askContactMethod: '📲 Watazamaji makini wakupateje?\n1️⃣ WhatsApp / simu\n2️⃣ Email',
  askContactValuePhone: '📱 Tuma namba ya WhatsApp/simu kwa maswali ya tangazo.\nMfano: +256 7XX XXX XXX',
  askContactValueEmail: '✉️ Tuma email ya maswali ya tangazo.',
  askIDNumber: '🪪 Kwa usalama, tunahitaji National ID Number (NIN). Haitaonekana hadharani.\n\nTafadhali andika NIN yako:',
  askSelfie: '🤳 Tuma selfie iliyo wazi ukiwa umeshika National ID yako.',
  askPhone: '📱 Namba yako ya simu ya uthibitisho ni ipi?\nMfano: +256 7XX XXX XXX',
  verifyOTP: 'Tafadhali andika code ya tarakimu 6 tuliyotuma:',
  askDeposit: '💵 Deposit ni kiasi gani? (UGX, nambari tu)',
  askContract: '📅 Mkataba wa chini ni miezi mingapi? (mfano 6, 12, 24)',
  askUniversity: '🎓 Chuo kikuu kilicho karibu ni kipi?',
  askDistance: '🚶 Mali iko umbali gani kutoka chuo kikuu kwa km? (mfano 0.5, 1, 2)',
  voiceNotUnderstood: '🎙️ Nimepokea voice note yako, lakini sikuweza kuisoma vizuri. Tafadhali tuma tena kwa sauti wazi au andika ujumbe wako.',
  voiceTranscriptionUnavailable: '🎙️ Nimepokea voice note yako, lakini transcription bado haijawashwa. Tafadhali andika ujumbe wako kwa sasa.',
  voiceTranscriptEcho: '🎙️ Umesema: "{transcript}"'
});

Object.assign(T.ac, {
  askListingType: '🏠 Itye keto ngo?\n1️⃣ Ot/property me acata\n2️⃣ Ot/property me rent\n3️⃣ Ngom/plot\n4️⃣ Kabedo me students\n5️⃣ Property me business',
  askOwnership: '✅ In aye won property man, onyo agent?\n1️⃣ An won-ne\n2️⃣ An agent',
  askFieldAgent: '🤝 Field agent pa MakaUg okonyi ki listing man?\n1️⃣ Eyo\n2️⃣ Pe',
  askFieldAgentDetails: 'Coo nying onyo namba pa field agent wek wangeye maber.',
  askTitle: '✏️ Coo nying property macek:',
  askDistrict: '📍 Property man tye i district mene?',
  askArea: '🗺️ Kabedo/neighbourhood mene?',
  askPrice: '💰 Wel-ne i Uganda Shillings? (namba keken)',
  askBedrooms: '🛏 Tye ki bedrooms adi? (Coo namba, onyo 0)',
  askDescription: '📝 Tit property man macek (kabedo, jami, kit ma tye...)',
  askPhotos: '📸 Cwal cal me *front/outside* mukwongo.',
  askPublicName: '👤 Nying mene myero nen i listing?',
  askContactMethod: '📲 Jo ma mito property bikubi kwedi nining?\n1️⃣ WhatsApp / cim\n2️⃣ Email',
  askContactValuePhone: '📱 Cwal namba me WhatsApp/cim pi enquiries.',
  askContactValueEmail: '✉️ Cwal email pi enquiries.',
  askIDNumber: '🪪 Pi gwoko kuc, wamito National ID Number (NIN). Pe bino nyute bot lwak.\n\nCoo NIN mamegi:',
  askSelfie: '🤳 Cwal selfie ma nen maber ki National ID mamegi.',
  askPhone: '📱 Namba cim mamegi pi verification?',
  otpSent: '📲 Wacwalo code me digit 6 i cim mamegi. Coo code kany:',
  otpSentEmail: '✉️ Wacwalo code me digit 6 i email mamegi. Coo code kany:',
  verifyOTP: 'Coo code me digit 6 ma wacwalo:',
  otpSuccess: '✅ Cim mamegi ocikke!',
  otpFailed: '❌ Code pe kakare. Tem doki.',
  askDeposit: '💵 Deposit rom mene i UGX?',
  askContract: '📅 Contract manok twero bedo dwe adi?',
  askUniversity: '🎓 University ma cok obedo mene?',
  askDistance: '🚶 Bor-ne ki university i km rom mene?',
  askSearchType: '🔎 Itye kayenyo ngo?\n1️⃣ Me acata\n2️⃣ Me rent\n3️⃣ Ngom\n4️⃣ Kabedo me students\n5️⃣ Business\n6️⃣ Weng',
  askSearchArea: '📍 Coo area onyo district ma iyenyo iye, onyo share location mamegi.',
  locationSharedReceived: '📍 Location onongo. Wayenyo properties i miles 5 ma cok kwedi mukwongo.',
  widenNearbySearch: 'Dwog *WIDEN* ka imito ni warwak kabedo me yeny.',
  searchNoNearbyResults: 'Pe wanongo listings ma approved i miles 5. Wanyuto ma cok.',
  searchNoResults: 'Pe wanongo listing ma approved ma rwate kombedi.',
  askAgentArea: '👔 Imito agent i district/area mene?',
  noAgentsFound: 'Pe wanongo agent ma verified i area meno kombedi.',
  menuHint: 'Coo MENU cawa mo keken me dwogo i main menu.',
  searchHeader: 'Properties ma rwate maber',
  agentHeader: 'Agents ma verified',
  titleTooShort: 'Nying macek tutwal. Coo nying ma nyuto property maber.',
  invalidPrice: '❌ Coo wel ma kakare i UGX (namba keken).',
  descriptionTooShort: 'Coo description ma bor nok (letters 10 onyo makato).',
  needExactlyFivePhotos: '❌ Cwal photos 5: front, sitting room, bedroom, kitchen, bathroom.',
  photosUploaded: '📸 Itye ki photos {count}/5. Coo *DONE* ka oromo 5.',
  photoReceived: '✅ Photo {count}/5 onongo! Cwal ma lubo kore.',
  sendSelfiePhotoOnly: '❌ Cwal photo/selfie, pe text.',
  replySearchAgain: 'Dwog 2 me yenyo doki.',
  replyAgentAgain: 'Dwog 3 me yenyo agent mukene.',
  typeSale: 'Me acata',
  typeRent: 'Me rent',
  typeLand: 'Ngom',
  typeStudent: 'Students',
  typeCommercial: 'Business',
  typeAny: 'Weng',
  voiceNotUnderstood: '🎙️ Wanongo voice note mamegi, ento pe watye ki transcription maber. Tim ber icwal doki ki dwon maleng onyo coo message.',
  voiceTranscriptionUnavailable: '🎙️ Wanongo voice note mamegi, ento transcription pe oketo i tic pwod. Tim ber coo message kombedi.',
  voiceTranscriptEcho: '🎙️ Wawinyo ni: "{transcript}"'
});

Object.assign(T.ny, {
  askListingType: '🏠 Niki eki orikuteeka?\n1️⃣ Enju/property kugurisha\n2️⃣ Enju/property kukodisa\n3️⃣ Itaka/plot\n4️⃣ Ebyokutuuramu byaba students\n5️⃣ Commercial property',
  askOwnership: '✅ Niwe nyini property egi, nari ori agent?\n1️⃣ Ndi nyini\n2️⃣ Ndi agent',
  askFieldAgent: '🤝 Hari field agent wa MakaUg owakuhwereire ahari listing egi?\n1️⃣ Eego\n2️⃣ Ngaaha',
  askFieldAgentDetails: 'Handiika eizina nari namba ya field agent kugira tumumanye gye.',
  askTitle: '✏️ Ha property yaawe omutwe mugufi:',
  askDistrict: '📍 Property eri mu district ki?',
  askArea: '🗺️ Area/neighbourhood ki?',
  askPrice: '💰 Omuhendo mu Uganda Shillings? (namba zonka)',
  askBedrooms: '🛏 Ebyumba byo kwebaka bingahi? (Handiika namba, nari 0)',
  askDescription: '📝 Shoboorora property yaawe mu sentences nke (location, features, condition...)',
  askPhotos: '📸 Tuma ekishushani kya *front/outside* kubanza.',
  askSearchType: '🔎 Noshaka ki?\n1️⃣ Ebyokugurisha\n2️⃣ Ebyokukodisa\n3️⃣ Itaka\n4️⃣ Student accommodation\n5️⃣ Commercial\n6️⃣ Byona',
  askSearchArea: '📍 Handiika area nari district eyi orikushakiramu, nari share location yaawe.',
  locationSharedReceived: '📍 Location yaawe yatunga. Ninyanza kushaka omu miles 5 eziri haihi naiwe.',
  widenNearbySearch: 'Garukamu *WIDEN* waaba noyenda nyongyereho ahokushakira.',
  searchNoNearbyResults: 'Tinsangire listings ezikirizibwe omu miles 5. Ninyija kukwereka ezirikubaasa kukuhwera.',
  menuHint: 'Handiika MENU obwire bwona kugaruka aha main menu.',
  searchHeader: 'Properties ezirikukwatagana munonga',
  agentHeader: 'Agents abahamibwa',
  replySearchAgain: 'Garukamu 2 kushaka kandi.',
  replyAgentAgain: 'Garukamu 3 kushaka agent ondi.',
  typeSale: 'Ebyokugurisha',
  typeRent: 'Ebyokukodisa',
  typeLand: 'Itaka',
  typeStudent: 'Students',
  typeCommercial: 'Commercial',
  typeAny: 'Byona',
  photoReceived: '✅ Ekishushani {count}/5 kyatunga! Tuma ekirikukurataho.',
  photosUploaded: '📸 Otumire ebishushani {count}/5. Handiika *DONE* waheza 5.',
  needExactlyFivePhotos: '❌ Tuma ebishushani 5: front, sitting room, bedroom, kitchen, bathroom.',
  voiceNotUnderstood: '🎙️ Natunga voice note yaawe, kwonka tindagihurire gye. Tuma kandi n’eiraka eririkwetegyerezibwa nari ohandiike.',
  voiceTranscriptionUnavailable: '🎙️ Natunga voice note yaawe, kwonka transcription terikukora hati. Hati, nyabura ohandiike message yaawe.',
  voiceTranscriptEcho: '🎙️ Nahurira nti: "{transcript}"'
});

Object.assign(T.rn, {
  askListingType: '🏠 Uriko ushira ikiho?\n1️⃣ Inzu/property yo kugurisha\n2️⃣ Inzu/property yo gukodesha\n3️⃣ Ubutaka/plot\n4️⃣ Aho abanyeshuri baba\n5️⃣ Commercial property',
  askOwnership: '✅ Ni wewe nyiri property, canke uri agent?\n1️⃣ Ndi nyiri\n2️⃣ Ndi agent',
  askFieldAgent: '🤝 Hari field agent wa MakaUg yabafashije kuri iyi listing?\n1️⃣ Ego\n2️⃣ Oya',
  askFieldAgentDetails: 'Andika izina canke namba ya field agent kugira tumumenye neza.',
  askTitle: '✏️ Andika umutwe mugufi wa property:',
  askDistrict: '📍 Property iri muri district iyihe?',
  askArea: '🗺️ Area/neighbourhood iyihe?',
  askPrice: '💰 Igiciro muri Uganda Shillings? (nimero gusa)',
  askBedrooms: '🛏 Bedrooms zingahe? (Andika nimero, canke 0)',
  askDescription: '📝 Sobanura property mu nteruro nke (location, features, condition...)',
  askPhotos: '📸 Ohereza ifoto ya *front/outside* mbere.',
  askSearchType: '🔎 Urashaka iki?\n1️⃣ Kugurisha\n2️⃣ Gukodesha\n3️⃣ Ubutaka\n4️⃣ Student accommodation\n5️⃣ Commercial\n6️⃣ Vyose',
  askSearchArea: '📍 Andika area canke district uronderamwo, canke share location yawe.',
  locationSharedReceived: '📍 Location yawe yakiriwe. Ntanguye kurondera mu miles 5 hafi yawe.',
  widenNearbySearch: 'Subiza *WIDEN* nimba ushaka nagure aho kurondera.',
  searchNoNearbyResults: 'Nta listings zemejwe nabonye mu miles 5. Ndakwereka izindi zishobora gufasha.',
  menuHint: 'Andika MENU igihe cose gusubira kuri main menu.',
  searchHeader: 'Properties zihuye cane',
  agentHeader: 'Agents bemejwe',
  replySearchAgain: 'Subiza 2 kurondera kandi.',
  replyAgentAgain: 'Subiza 3 kurondera agent uwundi.',
  typeSale: 'Kugurisha',
  typeRent: 'Gukodesha',
  typeLand: 'Ubutaka',
  typeStudent: 'Students',
  typeCommercial: 'Commercial',
  typeAny: 'Vyose',
  photoReceived: '✅ Ifoto {count}/5 yakiriwe! Ohereza ikurikira.',
  photosUploaded: '📸 Wohereje amafoto {count}/5. Andika *DONE* umaze 5.',
  needExactlyFivePhotos: '❌ Ohereza amafoto 5: front, sitting room, bedroom, kitchen, bathroom.',
  voiceNotUnderstood: '🎙️ Nakiriye voice note yawe, ariko sinayumvise neza. Ongera uyohereze uvuga neza canke wandike ubutumwa.',
  voiceTranscriptionUnavailable: '🎙️ Nakiriye voice note yawe, ariko transcription ntirafungurwa. Ubu, ndagusavye wandike ubutumwa bwawe.',
  voiceTranscriptEcho: '🎙️ Numvise uti: "{transcript}"'
});

Object.assign(T.sm, {
  askListingType: "🏠 Oteeka ki?\n1️⃣ Ennyumba/property okutunda\n2️⃣ Ennyumba/property okukodisa\n3️⃣ Ettaka/plot\n4️⃣ Obutuuze bw'abayizi\n5️⃣ Commercial property",
  askOwnership: '✅ Ggwe nyini property eno, oba agent?\n1️⃣ Nze nyini\n2️⃣ Nze agent',
  askFieldAgent: '🤝 Waliwo field agent wa MakaUg eyakuyambye ku listing eno?\n1️⃣ Yee\n2️⃣ Nedda',
  askFieldAgentDetails: 'Mpandiikira erinnya oba ennamba ya field agent tumumanye bulungi.',
  askTitle: '✏️ Wa property yo omutwe omumpi:',
  askDistrict: '📍 Property eri mu district ki?',
  askArea: '🗺️ Area/neighbourhood ki?',
  askPrice: '💰 Ebbeeyi mu Uganda Shillings? (ennamba zokka)',
  askBedrooms: '🛏 Bedrooms ziri mmeka? (Wandiika ennamba, oba 0)',
  askDescription: '📝 Nnyonnyola property yo mu sentences ntono (location, features, condition...)',
  askPhotos: '📸 Weereza ekifaananyi kya *front/outside* okusooka.',
  askSearchType: "🔎 Onoonya ki?\n1️⃣ Ebitundibwa\n2️⃣ Eby'okukodisa\n3️⃣ Ttaka\n4️⃣ Obutuuze bw'abayizi\n5️⃣ Commercial\n6️⃣ Byonna",
  askSearchArea: '📍 Wandiika area oba district gyonoonya, oba share location yo.',
  locationSharedReceived: '📍 Location yo efuniddwa. Nnoonya mu miles 5 ezikuli okumpi okusooka.',
  widenNearbySearch: 'Ddamu *WIDEN* bwoyagala ngaziye ekitundu kyokunoonya.',
  searchNoNearbyResults: 'Sirabye listings ezikakasiddwa mu miles 5. Nja kukulaga ezirala eziyinza okukuyamba.',
  menuHint: 'Wandiika MENU anytime okudda ku main menu.',
  searchHeader: 'Properties ezisinga okukwatagana',
  agentHeader: 'Agents abakakasiddwa',
  replySearchAgain: 'Ddamu 2 okunoonya nate.',
  replyAgentAgain: 'Ddamu 3 okunoonya agent omulala.',
  typeSale: 'Ebitundibwa',
  typeRent: "Eby'okukodisa",
  typeLand: 'Ttaka',
  typeStudent: 'Abayizi',
  typeCommercial: 'Commercial',
  typeAny: 'Byonna',
  photoReceived: '✅ Ekifaananyi {count}/5 kifuniddwa! Weereza ekiddako.',
  photosUploaded: '📸 Oweerezza ebifaananyi {count}/5. Wandiika *DONE* bwomala 5.',
  needExactlyFivePhotos: '❌ Weereza ebifaananyi 5: front, sitting room, bedroom, kitchen, bathroom.',
  voiceNotUnderstood: '🎙️ Nfunye voice note yo naye sitegedde bulungi. Ddamu ogyogere bulungi oba wandiika message.',
  voiceTranscriptionUnavailable: '🎙️ Nfunye voice note yo, naye transcription tennaba kukoleezebwa. Nkwegayiridde wandiika message yo kati.',
  voiceTranscriptEcho: '🎙️ Mpulidde nti: "{transcript}"'
});

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

function cleanDisplayName(value) {
  const raw = normalizeInput(value);
  if (!raw) return '';
  const withoutBusinessSuffix = raw
    .replace(/\s*\|\s*.+$/g, '')
    .replace(/\s*-\s*MakaUg.*$/i, '')
    .trim();
  const digits = withoutBusinessSuffix.replace(/\D/g, '');
  if (digits.length >= 7) return '';
  if (/^(makaug|makaug\.com|whatsapp|you|unknown|codex)$/i.test(withoutBusinessSuffix)) return '';
  if (/\bcodex\b/i.test(withoutBusinessSuffix)) return '';
  if (/^https?:\/\//i.test(withoutBusinessSuffix)) return '';
  return withoutBusinessSuffix.replace(/[^\p{L}\p{N}\s'.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function firstNameFromSessionData(sessionData = {}) {
  const name = cleanDisplayName(
    sessionData.contact_name
    || sessionData.display_name
    || sessionData.name
    || sessionData.profile_name
  );
  if (!name) return '';
  return name.split(/\s+/)[0];
}

function timeGreetingWithName(lang, sessionData = {}) {
  const firstName = firstNameFromSessionData(sessionData);
  return `${timeGreeting(lang)}${firstName ? `, ${firstName}` : ''}`;
}

function welcomeMessage(lang, sessionData = {}) {
  const code = resolveLangCode(lang);
  return `${timeGreetingWithName(code, sessionData)} 👋 ${assistantIntro(code)}\n\n${t(code, 'welcome')}\n\nBrowse MakaUg anytime: ${HOME_URL}`;
}

function detectLanguageFromText(text) {
  const clean = normalizeInput(text).toLowerCase();
  if (!clean) return { code: '', confidence: 0 };

  const rules = [
    { code: 'sw', confidence: 0.92, re: /\b(habari|mambo|niaje|jambo|sasa|salama|natafuta|tafuta|nitafutie|nyumba|shamba|kiwanja|ardhi|kupangisha|kuuza|bei|asante|karibu)\b/ },
    { code: 'lg', confidence: 0.9, re: /\b(oli otya|wasuze|osiibye|webale|noonya|nfunira|nyumba|enju|ttaka|okupangisa)\b/ },
    { code: 'sm', confidence: 0.86, re: /\b(mirembe|noonia|amaka|ebifa|lusoga)\b/ },
    { code: 'ac', confidence: 0.88, re: /\b(itye|apwoyo|yeny|nongo|gang|ot|acholi)\b/ },
    { code: 'ny', confidence: 0.86, re: /\b(oraire|osiibire|webare|shaka|nyowe|runyankole)\b/ },
    { code: 'rn', confidence: 0.84, re: /\b(mwaramutse|mwiriwe|murakoze|shaka|rukiga)\b/ },
    { code: 'en', confidence: 0.9, re: /\b(hello|hi|hey|good morning|good afternoon|good evening|search|looking|need|want|rent|buy|house|home|property|agent|broker|land|commercial|student|accommodation|hostel|apartment|flat)\b/ }
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

function shouldAdoptDetectedLanguage({ sessionLang = 'en', sessionStep = 'greeting', detectedLanguage = {} }) {
  const nextLang = resolveLangCode(detectedLanguage.code || '');
  const currentLang = resolveLangCode(sessionLang || 'en');
  if (!nextLang || nextLang === currentLang) return false;
  if (detectedLanguage.source === 'intent_entity') return true;
  if (detectedLanguage.source === 'ai_explicit_language') return true;
  if (detectedLanguage.source === 'ai_language' && Number(detectedLanguage.confidence || 0) >= 0.92) return true;
  if (detectedLanguage.source === 'voice_transcription') return true;
  if (detectedLanguage.source === 'voice_transcript_text') return true;
  if (Number(detectedLanguage.confidence || 0) < 0.9) return false;
  if (nextLang === 'en' && currentLang !== 'en') return false;
  return ['greeting', 'main_menu', 'choose_language', 'submitted'].includes(sessionStep || 'greeting');
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

function parseLanguageChange(text) {
  const clean = normalizeInput(text).toLowerCase();
  if (!clean) return '';
  const explicit = clean.match(/\b(?:change|switch|set|speak|use|talk|continue|carry on|carry|respond|reply|answer|write)\s+(?:the\s+conversation\s+)?(?:my\s+)?(?:language\s+)?(?:to\s+|in\s+|with\s+)?(english|luganda|lugandan|lunganda|lugand|kiswahili|ki swahili|swahili|acholi|runyankole|rukiga|lusoga)\b/);
  const direct = clean.match(/^(english|luganda|lugandan|lunganda|lugand|kiswahili|ki swahili|swahili|acholi|runyankole|rukiga|lusoga)$/);
  const value = (explicit || direct || [])[1] || '';
  const map = {
    english: 'en',
    luganda: 'lg',
    lugandan: 'lg',
    lunganda: 'lg',
    lugand: 'lg',
    kiswahili: 'sw',
    'ki swahili': 'sw',
    swahili: 'sw',
    acholi: 'ac',
    runyankole: 'ny',
    rukiga: 'rn',
    lusoga: 'sm'
  };
  return map[value] || '';
}

function normalizeTranscriptionLanguage(value) {
  const clean = normalizeInput(value).toLowerCase();
  if (!clean) return '';
  const map = {
    en: 'en',
    eng: 'en',
    english: 'en',
    lg: 'lg',
    lug: 'lg',
    luganda: 'lg',
    sw: 'sw',
    swa: 'sw',
    swahili: 'sw',
    kiswahili: 'sw',
    ac: 'ac',
    ach: 'ac',
    acholi: 'ac',
    ny: 'ny',
    nyn: 'ny',
    runyankole: 'ny',
    rn: 'rn',
    rukiga: 'rn',
    sm: 'sm',
    xog: 'sm',
    lusoga: 'sm'
  };
  return map[clean] || map[clean.split(/[-_]/)[0]] || '';
}

function resolveVoiceDetectedLanguage(transcriptRecord, transcriptText, sessionLang) {
  const fromProvider = normalizeTranscriptionLanguage(transcriptRecord?.language);
  if (fromProvider) return { code: fromProvider, confidence: 0.96, source: 'voice_transcription' };
  const fromText = detectLanguageFromText(transcriptText);
  if (fromText.code) return { ...fromText, source: 'voice_transcript_text' };
  return { code: resolveLangCode(sessionLang), confidence: 0.5, source: 'session' };
}

function mergeAiLanguageDetection(baseLanguage = {}, aiLanguage = {}) {
  if (!aiLanguage || typeof aiLanguage !== 'object') return baseLanguage;
  const aiCode = resolveLangCode(aiLanguage.language || aiLanguage.code || '');
  if (!aiCode) return baseLanguage;

  const aiConfidence = Number(aiLanguage.confidence || 0);
  const baseConfidence = Number(baseLanguage.confidence || 0);
  if (aiLanguage.explicitSwitch || aiConfidence >= Math.max(0.86, baseConfidence)) {
    return {
      code: aiCode,
      confidence: aiConfidence || 0.9,
      source: aiLanguage.explicitSwitch ? 'ai_explicit_language' : 'ai_language',
      reason: aiLanguage.reason || ''
    };
  }

  return baseLanguage;
}

function photoRequirementLabel(index, lang = 'en') {
  const code = resolveLangCode(lang);
  const labels = {
    en: ['front/outside', 'sitting room or main room', 'bedroom', 'kitchen', 'bathroom', 'extra useful photo'],
    lg: ['front/outside', 'sitting room oba ekisenge ekikulu', 'bedroom', 'kitchen', 'bathroom', 'ekifaananyi ekirala'],
    sw: ['mbele/nje', 'sebule au chumba kikuu', 'chumba cha kulala', 'jikoni', 'bafu', 'picha nyingine muhimu'],
    ac: ['front/outside', 'sitting room onyo room madit', 'bedroom', 'kitchen', 'bathroom', 'photo mukene ma konyo'],
    ny: ['front/outside', 'sitting room nari main room', 'bedroom', 'kitchen', 'bathroom', 'ekishushani ekindi'],
    rn: ['front/outside', 'sitting room canke main room', 'bedroom', 'kitchen', 'bathroom', 'ifoto yindi ifasha'],
    sm: ['front/outside', 'sitting room oba ekisenge ekikulu', 'bedroom', 'kitchen', 'bathroom', 'ekifaananyi ekirala']
  };
  const row = labels[code] || labels.en;
  return row[index] || row[5];
}

function photoNextPrompt(lang, count = 0) {
  const code = resolveLangCode(lang);
  const safeCount = Math.max(0, Number(count) || 0);
  if (safeCount >= 5) {
    const done = {
      en: `✅ I have the 5 key photos. Type *DONE* to continue, or send any extra helpful photos.`,
      lg: `✅ Ebifaananyi 5 ebikulu bifuniddwa. Wandiika *DONE* okugenda mu maaso, oba weereza ebirala bw'oba obirina.`,
      sw: `✅ Nimepata picha 5 muhimu. Andika *DONE* kuendelea, au tuma picha nyingine kama zipo.`,
      ac: `✅ Atye ki photos 5 ma pire tek. Coo *DONE* me mede anyim, onyo cwal photos mukene ma konyo.`,
      ny: `✅ Natunga ebishushani 5 ebikuru. Handiika *DONE* kugumizamu, nari tuma ebindi.`,
      rn: `✅ Nakiriye amafoto 5 akenewe. Andika *DONE* gukomeza, canke ohereze ayandi.`,
      sm: `✅ Ebifaananyi 5 ebikulu bifuniddwa. Wandiika *DONE* okugenda mu maaso, oba weereza ebirala.`
    };
    return done[code] || done.en;
  }
  const label = photoRequirementLabel(safeCount, code);
  const prompts = {
    en: `📸 Next: please send the *${label}* photo.`,
    lg: `📸 Ekiddako: weereza ekifaananyi kya *${label}*.`,
    sw: `📸 Inayofuata: tafadhali tuma picha ya *${label}*.`,
    ac: `📸 Malubo: tim ber icwal photo me *${label}*.`,
    ny: `📸 Ekirikukurataho: tuma ekishushani kya *${label}*.`,
    rn: `📸 Igikurikira: ohereza ifoto ya *${label}*.`,
    sm: `📸 Ekiddako: weereza ekifaananyi kya *${label}*.`
  };
  return prompts[code] || prompts.en;
}

function photoCompletePrompt(lang, count = 5) {
  const code = resolveLangCode(lang);
  const safeCount = Math.max(5, Number(count) || 5);
  const messages = {
    en: `📸 ${safeCount} photos received. I have the key listing photos.`,
    lg: `📸 Ebifaananyi ${safeCount}/5 bifuniddwa. Ebifaananyi ebikulu biriwo.`,
    sw: `📸 Picha ${safeCount}/5 zimepokelewa. Nina picha muhimu za tangazo.`,
    ac: `📸 Photos ${safeCount}/5 onongo. Atye ki photos ma pire tek pi listing.`,
    ny: `📸 Ebishushani ${safeCount}/5 byatunga. Ebishushani bikuru biriho.`,
    rn: `📸 Amafoto ${safeCount}/5 yakiriwe. Amafoto y'ingenzi arahari.`,
    sm: `📸 Ebifaananyi ${safeCount}/5 bifuniddwa. Ebifaananyi ebikulu biriwo.`
  };
  return messages[code] || messages.en;
}

function friendlyGreetingReply(lang, sessionData = {}) {
  const code = resolveLangCode(lang);
  const lead = timeGreetingWithName(code, sessionData);
  const languageLine = languageComfortLine(code);
  const messages = {
    en: `${lead} 👋 ${assistantIntro(code)}\n${languageLine}\n\nHow can I help today?\n1️⃣ List my property\n2️⃣ Search for a property\n3️⃣ Find an agent\n\nYou can also type naturally, like "2 bedroom house in Kampala", "student room near me", or share your location.`,
    lg: `${lead} 👋 ${assistantIntro(code)}\n${languageLine}\n\nNnyinza kukuyamba ntya leero?\n1️⃣ Listing y'ennyumba yo\n2️⃣ Noonya ennyumba\n3️⃣ Funa agent\n\nOsobola n'okuwandika nga "ennyumba e Ntinda", "abayizi okumpi nange", oba okusindika location yo.`,
    sw: `${lead} 👋 ${assistantIntro(code)}\n${languageLine}\n\nNinaweza kukusaidiaje leo?\n1️⃣ Orodhesha mali yangu\n2️⃣ Tafuta nyumba/mali\n3️⃣ Tafuta agent\n\nUnaweza pia kuandika kawaida, kama "nyumba ya vyumba 2 Kampala", "student room karibu nami", au kushare location yako.`,
    ac: `${lead} 👋 ${assistantIntro(code)}\n${languageLine}\n\nAromo konyi nining tin?\n1️⃣ Ket property mamegi\n2️⃣ Yeny property\n3️⃣ Nong agent\n\nI romo coc ki leb ma yot onyo share location mamegi.`,
    ny: `${lead} 👋 ${assistantIntro(code)}\n${languageLine}\n\nNinkuyamba nta eriizooba?\n1️⃣ Handiika property yaawe\n2️⃣ Shaka property\n3️⃣ Shaka agent\n\nNoobaasa kuhandiika nk'omuntu arikugamba, ninga share location yaawe.`,
    rn: `${lead} 👋 ${assistantIntro(code)}\n${languageLine}\n\nNinkuyamba nteeri hati?\n1️⃣ Shyira property yaaweho\n2️⃣ Shaka property\n3️⃣ Shaka agent\n\nNimushobora kwandika bisanzwe cyangwa mugasangiza location.`,
    sm: `${lead} 👋 ${assistantIntro(code)}\n${languageLine}\n\nNnyinza kukuyamba ntya leero?\n1️⃣ Listing y'ennyumba yo\n2️⃣ Noonya ennyumba\n3️⃣ Funa agent\n\nOsobola n'okuwandika nga "ennyumba e Ntinda", "abayizi okumpi nange", oba okusindika location yo.`
  };
  return `${messages[code] || messages.en}\n\n${t(code, 'menuHint')}`;
}

function languageComfortLine(lang) {
  const code = resolveLangCode(lang);
  const messages = {
    en: 'You can speak to me in English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga, or Lusoga. I will keep replying in the language you use.',
    lg: 'Osobola okunjogerera mu English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga oba Lusoga. Nja kuddamu mu lulimi lwokozesa.',
    sw: 'Unaweza kuzungumza nami kwa English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga au Lusoga. Nitajibu kwa lugha unayotumia.',
    ac: 'I romo loko kweda i English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga onyo Lusoga. Abino dwoko i leb ma itiyo kwede.',
    ny: 'Noobaasa kugamba nanje omu English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga nari Lusoga. Ninyija kugarukamu omu rurimi orikukozesa.',
    rn: 'Mushobora kuvugana nanje mu English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga canke Lusoga. Nzasubiza mu rurimi mukoresha.',
    sm: 'Osobola okunjogerera mu English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga oba Lusoga. Nja kuddamu mu lulimi lwokozesa.'
  };
  return messages[code] || messages.en;
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
    ask_public_name: t(code, 'askPublicName'),
    ask_contact_method: t(code, 'askContactMethod'),
    ask_contact_value: t(code, 'askContactValuePhone'),
    ask_id_number: t(code, 'askIDNumber'),
    ask_selfie: t(code, 'askSelfie'),
    ask_phone: t(code, 'askPhone'),
    search_type: t(code, 'askSearchType'),
    search_area: t(code, 'askSearchArea'),
    ask_field_agent: t(code, 'askFieldAgent'),
    ask_field_agent_details: t(code, 'askFieldAgentDetails'),
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

function formatVoiceTranscriptEcho(lang, transcript) {
  const transcriptText = normalizeInput(transcript).slice(0, 1000);
  if (!transcriptText) return '';
  return tt(lang, 'voiceTranscriptEcho', { transcript: transcriptText });
}

function isNoMatchChallenge(text) {
  const clean = normalizeInput(text).toLowerCase();
  if (!clean) return false;
  return /\b(yes you do|you do|saw it|seen it|looked at|on the website|on your website|it is there|available on|but you have)\b/.test(clean);
}

function noMatchChallengeReply(lang, sessionData = {}) {
  const code = resolveLangCode(lang);
  const last = sessionData?.last_no_match && typeof sessionData.last_no_match === 'object'
    ? sessionData.last_no_match
    : {};
  const area = normalizeInput(last.area || '');
  const searchType = normalizeInput(last.search_type || 'any');
  const areaParam = area ? `&area=${encodeURIComponent(area)}` : '';
  const typeParam = searchType && searchType !== 'any' ? `?listing_type=${encodeURIComponent(searchType)}${areaParam}` : (area ? `?area=${encodeURIComponent(area)}` : '');
  const url = `${HOME_URL}/#page-sale${typeParam}`;
  const messages = {
    en: `You're right to challenge that. I may have filtered too narrowly, so I am sending you back to the live website results and saving this for admin review.\n\nOpen live MakaUg listings: ${url}\n\n${process.env.SUPPORT_EMAIL || 'info@makaug.com'}`,
    lg: `Oli mutuufu okukibuuzako. Nyinza okuba nga nsumbye filter nnyo, kale nkusindika ku live listings era nterese kino admin akirabe.\n\nGgulawo listings: ${url}\n\n${process.env.SUPPORT_EMAIL || 'info@makaug.com'}`,
    sw: `Uko sawa kuuliza hilo. Huenda nilichuja sana, kwa hiyo nakutuma kwenye matokeo ya live website na nimehifadhi hili kwa admin.\n\nFungua listings: ${url}\n\n${process.env.SUPPORT_EMAIL || 'info@makaug.com'}`
  };
  return `${messages[code] || messages.en}\n\n${t(code, 'menuHint')}`;
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

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      logger.error('WhatsApp route failed', {
        path: req.originalUrl,
        error: error.message || String(error)
      });
      if (res.headersSent) return next(error);
      const dryRun = ['1', 'true', 'yes'].includes(String(req.body?.dry_run || req.body?.dryRun || '').trim().toLowerCase());
      return res.status(500).json({
        ok: false,
        error: 'whatsapp_route_failed',
        message: process.env.NODE_ENV === 'production' && !dryRun ? 'WhatsApp processing failed' : (error.message || String(error)),
        ...(dryRun ? { stack: String(error.stack || '').split('\n').slice(0, 6) } : {})
      });
    });
  };
}

async function withTimeout(promise, timeoutMs, fallbackValue = null, label = 'operation') {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          logger.warn(`${label} timed out after ${timeoutMs}ms`);
          resolve(fallbackValue);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeBridgeInboundKey(value) {
  const raw = normalizeInput(value);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 9) return digits;
  return raw.slice(0, 160);
}

function createBridgeDryRunKey(phone, scope = '') {
  const normalizedPhone = normalizeBridgeInboundKey(phone) || 'unknown';
  const normalizedScope = normalizeInput(scope).slice(0, 80);
  const hash = crypto
    .createHash('sha1')
    .update(`${normalizedPhone}:${normalizedScope}`)
    .digest('hex')
    .slice(0, 12);
  return `dryrun:${normalizedPhone}:${hash}`;
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

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeContactPhone(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function isValidContactPhone(value) {
  return /^\+?[0-9]{10,15}$/.test(normalizeContactPhone(value));
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

function isLocationPreviewWithoutCoordinates(mediaType = '', body = '') {
  const type = String(mediaType || '').toLowerCase();
  if (type.includes('location')) return true;
  return type === 'image' && /^\s*\d{1,2}:\d{2}\s*(?:am|pm)?\s*$/i.test(String(body || '').trim());
}

function locationPreviewPrompt(lang) {
  const code = resolveLangCode(lang);
  const messages = {
    en: '📍 I can see a map/location preview, but WhatsApp Web did not expose the exact pin. Please tap *+ → Location → Send your current location*, or type the nearest area/district so I can search accurately.',
    lg: '📍 Ndaba map/location preview, naye WhatsApp Web tempadde pin entuufu. Share location yo oba wandika ekitundu/district ekiri okumpi.',
    sw: '📍 Naona ramani/location preview, lakini WhatsApp Web haijatoa pin halisi. Tafadhali tuma location yako au andika eneo/wilaya iliyo karibu.',
    ac: '📍 Aneno map/location preview, ento WhatsApp Web pe omiyo pin kikome. Tim ber share location mamegi onyo cwoo area/district macok.',
    ny: '📍 Nindeba map/location preview, kwonka WhatsApp Web terikworeka pin eyenyini. Share location yaawe ninga handiika area/district eri haihi.',
    rn: '📍 Ndabona map/location preview, ariko WhatsApp Web ntiyerekanye pin nyayo. Sangiza location cyangwa wandike area/district iri hafi.',
    sm: '📍 Ndaba map/location preview, naye WhatsApp Web tempadde pin entuufu. Share location yo oba wandika ekitundu/district ekiri okumpi.'
  };
  return messages[code] || messages.en;
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
  { type: 'student', re: /\b(student|students|hostel|dorm|dormitory|campus|university)\b/i },
  { type: 'commercial', re: /\b(commercial|office|retail|warehouse|shop|business premises)\b/i },
  { type: 'land', re: /\b(land|plot|plots|acre|acres|farm land|agricultural)\b/i },
  { type: 'rent', re: /\b(rent|rental|to rent|monthly|per month|a month|\/month|lease)\b/i },
  { type: 'sale', re: /\b(buy|buying|sale|for sale|purchase|own)\b/i }
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
  'mbale town': 'Mbale',
  mbali: 'Mbale',
  bali: 'Mbale',
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

const REGION_DISTRICTS = {
  central: [
    'Buikwe', 'Bukomansimbi', 'Buvuma', 'Gomba', 'Kalangala', 'Kalungu',
    'Kampala', 'Kasanda', 'Kayunga', 'Kiboga', 'Kyankwanzi', 'Kyotera',
    'Luwero', 'Lwengo', 'Lyantonde', 'Masaka', 'Mityana', 'Mpigi',
    'Mubende', 'Mukono', 'Nakaseke', 'Nakasongola', 'Rakai',
    'Sembabule', 'Wakiso', 'Butambala'
  ],
  eastern: [
    'Budaka', 'Bududa', 'Bugiri', 'Bugweri', 'Bukedea', 'Bukwo',
    'Bulambuli', 'Busia', 'Butaleja', 'Butebo', 'Buyende', 'Iganga',
    'Jinja', 'Kaberamaido', 'Kalaki', 'Kaliro', 'Kamuli', 'Kapchorwa',
    'Kapelebyong', 'Katakwi', 'Kibuku', 'Kumi', 'Luuka', 'Mayuge',
    'Mbale', 'Namisindwa', 'Namutumba', 'Namayingo', 'Ngora',
    'Pallisa', 'Serere', 'Sironko', 'Soroti', 'Tororo', 'Amuria'
  ],
  northern: [
    'Abim', 'Adjumani', 'Agago', 'Alebtong', 'Amolatar', 'Amudat',
    'Amuru', 'Apac', 'Arua', 'Dokolo', 'Gulu', 'Kaabong', 'Karenga',
    'Kitgum', 'Koboko', 'Kole', 'Kotido', 'Kwania',
    'Lamwo', 'Lira', 'Madi-Okollo', 'Maracha', 'Moroto', 'Moyo',
    'Nabilatuk', 'Nakapiripirit', 'Napak', 'Nebbi', 'Nwoya',
    'Obongi', 'Omoro', 'Otuke', 'Oyam', 'Pader', 'Pakwach',
    'Yumbe', 'Zombo'
  ],
  western: [
    'Buhweju', 'Buliisa', 'Bundibugyo', 'Bunyangabu', 'Bushenyi',
    'Hoima', 'Ibanda', 'Isingiro', 'Kabale', 'Kabarole', 'Kagadi',
    'Kakumiro', 'Kamwenge', 'Kanungu', 'Kasese', 'Kibaale', 'Kitagwenda',
    'Kikuube', 'Kiruhura', 'Kiryandongo', 'Kisoro', 'Kyegegwa',
    'Kyenjojo', 'Mbarara', 'Mitooma', 'Ntoroko', 'Ntungamo',
    'Rubanda', 'Rubirizi', 'Rukiga', 'Rukungiri', 'Sheema'
  ],
  'greater kampala': ['Kampala', 'Wakiso', 'Mukono']
};

const WEBSITE_PUBLIC_LISTINGS = [
  {
    id: 'website-seed-1',
    title: 'Luxury Villa in Kololo',
    area: 'Kololo',
    district: 'Kampala',
    listing_type: 'sale',
    property_type: 'Villa',
    bedrooms: 5,
    bathrooms: 4,
    price: 950000000,
    price_period: '',
    primary_image_url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=900&q=80',
    property_url: `${HOME_URL}/property/1`
  },
  {
    id: 'website-seed-2',
    title: '3-Bed Apartment - Nakasero',
    area: 'Nakasero',
    district: 'Kampala',
    listing_type: 'rent',
    property_type: 'Apartment',
    bedrooms: 3,
    bathrooms: 2,
    price: 5500000,
    price_period: 'mo',
    primary_image_url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&q=80',
    property_url: `${HOME_URL}/property/2`
  },
  {
    id: 'website-seed-3',
    title: 'Kikoni Student Hostel',
    area: 'Kikoni',
    district: 'Kampala',
    listing_type: 'student',
    property_type: 'Hostel',
    bedrooms: 1,
    bathrooms: 1,
    price: 450000,
    price_period: 'sem',
    primary_image_url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=900&q=80',
    property_url: `${HOME_URL}/property/3`
  },
  {
    id: 'website-seed-4',
    title: 'Office Space - Ntinda',
    area: 'Ntinda',
    district: 'Kampala',
    listing_type: 'commercial',
    property_type: 'Office',
    bedrooms: null,
    bathrooms: 2,
    price: 12000000,
    price_period: 'mo',
    primary_image_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&q=80',
    property_url: `${HOME_URL}/property/4`
  },
  {
    id: 'website-seed-5',
    title: '0.5 Acre Plot - Namugongo',
    area: 'Namugongo',
    district: 'Wakiso',
    listing_type: 'land',
    property_type: 'Residential Plot',
    bedrooms: null,
    bathrooms: null,
    price: 120000000,
    price_period: '',
    primary_image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=900&q=80',
    property_url: `${HOME_URL}/property/5`
  },
  {
    id: 'website-seed-6',
    title: '2-Bed Apartment - Ntinda',
    area: 'Ntinda',
    district: 'Kampala',
    listing_type: 'rent',
    property_type: 'Apartment',
    bedrooms: 2,
    bathrooms: 1,
    price: 1800000,
    price_period: 'mo',
    primary_image_url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&q=80',
    property_url: `${HOME_URL}/property/6`
  },
  {
    id: 'website-seed-7',
    title: '4-Bed Home - Muyenga',
    area: 'Muyenga',
    district: 'Kampala',
    listing_type: 'sale',
    property_type: 'House',
    bedrooms: 4,
    bathrooms: 3,
    price: 480000000,
    price_period: '',
    primary_image_url: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=900&q=80',
    property_url: `${HOME_URL}/property/7`
  },
  {
    id: 'website-seed-8',
    title: '1-Acre Commercial Plot - Mbale',
    area: 'Mbale Town',
    district: 'Mbale',
    listing_type: 'land',
    property_type: 'Commercial Land',
    bedrooms: null,
    bathrooms: null,
    price: 185000000,
    price_period: '',
    primary_image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=900&q=80',
    property_url: `${HOME_URL}/property/8`
  },
  {
    id: 'website-seed-9',
    title: 'Wandegeya Studio Apartment',
    area: 'Wandegeya',
    district: 'Kampala',
    listing_type: 'student',
    property_type: 'Studio',
    bedrooms: 1,
    bathrooms: 1,
    price: 800000,
    price_period: 'sem',
    primary_image_url: 'https://images.unsplash.com/photo-1494526585095-c41746248156?w=900&q=80',
    property_url: `${HOME_URL}/property/9`
  },
  {
    id: 'website-seed-10',
    title: "Ntinda Girls' Hostel",
    area: 'Ntinda',
    district: 'Kampala',
    listing_type: 'student',
    property_type: 'Hostel',
    bedrooms: 1,
    bathrooms: 1,
    price: 300000,
    price_period: 'sem',
    primary_image_url: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=900&q=80',
    property_url: `${HOME_URL}/property/10`
  },
  {
    id: 'website-seed-11',
    title: 'Kisaasi Student Apartment',
    area: 'Kisaasi',
    district: 'Kampala',
    listing_type: 'student',
    property_type: 'Apartment',
    bedrooms: 2,
    bathrooms: 1,
    price: 1200000,
    price_period: 'sem',
    primary_image_url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=900&q=80',
    property_url: `${HOME_URL}/property/11`
  },
  {
    id: 'website-seed-12',
    title: 'Budget Shared Room - Kikoni',
    area: 'Kikoni',
    district: 'Kampala',
    listing_type: 'student',
    property_type: 'Shared Room',
    bedrooms: 1,
    bathrooms: 1,
    price: 350000,
    price_period: 'sem',
    primary_image_url: 'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?w=900&q=80',
    property_url: `${HOME_URL}/property/12`
  },
  {
    id: 'website-seed-13',
    title: 'Male Only Hostel - Kyambogo',
    area: 'Kyambogo',
    district: 'Kampala',
    listing_type: 'student',
    property_type: 'Hostel',
    bedrooms: 1,
    bathrooms: 1,
    price: 500000,
    price_period: 'sem',
    primary_image_url: 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=900&q=80',
    property_url: `${HOME_URL}/property/13`
  }
];

function normalizeRegionKey(value) {
  const clean = normalizeInput(value)
    .toLowerCase()
    .replace(/\b(region|metropolitan area|metro area|metro)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (['gkla', 'gkma', 'greater kampala'].includes(clean)) return 'greater kampala';
  if (['central', 'eastern', 'northern', 'western'].includes(clean)) return clean;
  return '';
}

function getRegionDistricts(value) {
  const key = normalizeRegionKey(value);
  return key ? (REGION_DISTRICTS[key] || []) : [];
}

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
  // Natural phrases like "land for sale" contain sale/rent words, but the
  // category intent is land. Check category-specific nouns before exact maps.
  if (/\b(land|plot|plots|acre|acres|farm land|agricultural)\b/i.test(clean)) return 'land';
  if (/\b(commercial|office|retail|warehouse|shop|business premises)\b/i.test(clean)) return 'commercial';
  if (/\b(student|students|hostel|dorm|dormitory|campus|university)\b/i.test(clean)) return 'student';
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

  const regionHit = normalizeRegionKey(cleanedLower);
  if (regionHit) return regionHit === 'greater kampala' ? 'Greater Kampala' : `${regionHit.charAt(0).toUpperCase()}${regionHit.slice(1)} Region`;

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

function sanitizeSearchAreaCandidate(area, originalText = '') {
  const cleanArea = normalizeInput(area);
  if (!cleanArea) return null;

  const lowerArea = cleanArea.toLowerCase();
  const lowerText = normalizeInput(originalText).toLowerCase();
  const aliasMap = AREA_ALIASES;

  const directAlias = aliasMap[lowerArea];
  if (directAlias) return directAlias;

  const districtHit = DISTRICTS.find((d) => lowerArea === String(d || '').toLowerCase());
  if (districtHit) return districtHit;

  const regionHit = normalizeRegionKey(lowerArea);
  if (regionHit) return regionHit === 'greater kampala' ? 'Greater Kampala' : `${regionHit.charAt(0).toUpperCase()}${regionHit.slice(1)} Region`;

  if (parseLanguageChange(cleanArea)) return null;
  if (/^(english|luganda|lugandan|lunganda|kiswahili|ki swahili|swahili|acholi|runyankole|rukiga|lusoga)$/i.test(cleanArea)) return null;

  const instructionLike = /\b(respond|reply|answer|write|language|luganda|lunganda|swahili|kiswahili|english|natafuta|tafuta|nitafutie|looking|search|find|need|want|show|property|house|nyumba|shamba|kiwanja|ardhi|land|plot|student|hostel|commercial|agent|broker)\b/i;
  if (instructionLike.test(cleanArea)) {
    const parsed = parseAreaFromText(originalText);
    if (parsed && parsed.toLowerCase() !== lowerArea) return parsed;
    return null;
  }

  if (lowerText && lowerArea === lowerText) {
    return null;
  }

  return cleanArea;
}

function sanitizeNaturalSearchFilters(filters = {}, originalText = '') {
  const next = { ...(filters || {}) };
  next.area = sanitizeSearchAreaCandidate(next.area || next.district || '', originalText);
  if (!next.area && next.district) next.district = null;
  next.hasSignal = Boolean(
    next.area
    || next.district
    || Number(next.bedsMin || 0) > 0
    || next.propertyType
    || Number(next.maxBudgetUgx || 0) > 0
    || next.useSharedLocation
    || (next.searchType && next.searchType !== 'any')
  );
  return next;
}

function extractNaturalSearchFilters(text, entities = {}, fallbackType = 'any', sessionData = {}) {
  const clean = normalizeInput(text);
  const e = entities && typeof entities === 'object' ? entities : {};
  const parsedSearchType = parseSearchType(clean);
  const entitySearchType = e.listing_type || e.listingType;
  const categorySearchType = ['land', 'student', 'commercial'].includes(parsedSearchType)
    ? parsedSearchType
    : null;

  const searchType = normalizeListingType(
    categorySearchType || entitySearchType || parsedSearchType || fallbackType || 'any'
  );
  const area = sanitizeSearchAreaCandidate(e.area || e.location || e.district || parseAreaFromText(clean, sessionData), clean);
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
  const deterministic = sanitizeNaturalSearchFilters(
    extractNaturalSearchFilters(text, entities, fallbackType, sessionData),
    text
  );
  try {
    const aiExtract = await extractNaturalPropertyQuery({
      text,
      language,
      sessionData,
      fallbackType
    });
    const merged = sanitizeNaturalSearchFilters(mergeNaturalSearchFilters(aiExtract, deterministic), text);
    if (deterministic.searchType && deterministic.searchType !== 'any') merged.searchType = deterministic.searchType;
    if (deterministic.area) merged.area = deterministic.area;
    if (deterministic.propertyType) merged.propertyType = deterministic.propertyType;
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
  } catch (error) {
    logger.warn('AI natural search extraction failed in route fallback:', error.message);
    return deterministic;
  }
}

function describeNaturalFilters(filters = {}, lang = 'en') {
  const chips = [];
  if (filters.searchType && filters.searchType !== 'any') chips.push(typeLabel(filters.searchType, lang));
  if (filters.bedsMin > 0) chips.push(`${filters.bedsMin}+ bed`);
  if (filters.propertyType && String(filters.propertyType).toLowerCase() !== String(filters.searchType || '').toLowerCase()) {
    chips.push(filters.propertyType);
  }
  if (filters.maxBudgetUgx > 0) chips.push(`max ${formatPrice(filters.maxBudgetUgx, filters.budgetPeriod || '')}`);
  return chips.join(' • ');
}

function naturalSearchPrompt(lang, filters = {}, mode = 'area') {
  const code = resolveLangCode(lang);
  const chips = describeNaturalFilters(filters, code);
  const filterLine = chips ? {
    en: `Filters: ${chips}\n`,
    lg: `Filters: ${chips}\n`,
    sw: `Vichujio: ${chips}\n`,
    ac: `Filters: ${chips}\n`,
    ny: `Filters: ${chips}\n`,
    rn: `Filters: ${chips}\n`,
    sm: `Filters: ${chips}\n`
  }[code] || `Filters: ${chips}\n` : '';

  const copy = {
    area: {
      en: `🔎 I can search that for you.\n${filterLine}Please share the area or district.`,
      lg: `🔎 Nsobola okukinoonya.\n${filterLine}Mpandiikira ekitundu oba district.`,
      sw: `🔎 Naweza kukutafutia hiyo.\n${filterLine}Tafadhali taja eneo au wilaya.`,
      ac: `🔎 Aromo yenyoni pi in.\n${filterLine}Tim ber icwal area onyo district.`,
      ny: `🔎 Nimbaasa kukishakira.\n${filterLine}Ngambira ekicweka nari district.`,
      rn: `🔎 Nshobora kubishakira.\n${filterLine}Mumbwire area canke district.`,
      sm: `🔎 Nsobola okukinoonya.\n${filterLine}Mpandiikira ekitundu oba district.`
    },
    location: {
      en: `📍 I can search around you.\n${filterLine}Please share your WhatsApp location now. I will start within 5 miles, then you can reply WIDEN if you want more options.`,
      lg: `📍 Nsobola okunoonya okumpi naawe.\n${filterLine}Weereza location yo eya WhatsApp kati. Nja kusooka mu miles 5, olwo oddemu WIDEN bwoyagala ebisingawo.`,
      sw: `📍 Naweza kutafuta karibu na wewe.\n${filterLine}Tafadhali share location yako ya WhatsApp sasa. Nitaanza ndani ya maili 5, kisha ujibu WIDEN ukitaka chaguo zaidi.`,
      ac: `📍 Aromo yeny ka cok kwedi.\n${filterLine}Tim ber icwal location mamegi i WhatsApp. Abicako i miles 5, dok iromo dwoko WIDEN pi me yaro.`,
      ny: `📍 Nimbaasa kushaka haihi naiwe.\n${filterLine}Tuma location yaawe eya WhatsApp hati. Ninyija kutandika omu miles 5, kandi wangarukamu WIDEN waba noyenda ebindi.`,
      rn: `📍 Nshobora gushaka hafi yanyu.\n${filterLine}Ohereza location ya WhatsApp ubu. Ndatangura muri miles 5, hanyuma wandike WIDEN nimba mushaka ibindi.`,
      sm: `📍 Nsobola okunoonya okumpi naawe.\n${filterLine}Weereza location yo eya WhatsApp kati. Nja kusooka mu miles 5, olwo oddemu WIDEN bwoyagala ebisingawo.`
    }
  };
  return copy[mode]?.[code] || copy[mode]?.en || copy.area.en;
}

function canonicalAreaText(value) {
  const clean = normalizeInput(value);
  if (!clean) return '';
  return AREA_ALIASES[clean.toLowerCase()] || clean;
}

function listingMatchesSearchType(row, searchType) {
  const listingType = normalizeListingType(searchType || 'any');
  if (listingType === 'any') return true;
  if (listingType === 'student') {
    const haystack = [
      row.listing_type,
      row.title,
      row.property_type,
      row.description
    ].map((v) => normalizeInput(v).toLowerCase()).join(' ');
    return row.listing_type === 'student' || /\b(student|hostel|dorm|campus)\b/i.test(haystack);
  }
  return row.listing_type === listingType;
}

function listingMatchesArea(row, areaValue) {
  const area = canonicalAreaText(areaValue);
  if (!area || area.toLowerCase() === 'any') return true;
  const regionDistricts = getRegionDistricts(area);
  const rowDistrict = normalizeInput(row.district);
  if (regionDistricts.length && regionDistricts.some((d) => d.toLowerCase() === rowDistrict.toLowerCase())) return true;
  const q = area.toLowerCase();
  return [
    row.area,
    row.district,
    row.title,
    row.property_type
  ].map((v) => normalizeInput(v).toLowerCase()).some((v) => v.includes(q));
}

function listingMatchesPropertyType(row, propertyType) {
  const clean = normalizeInput(propertyType);
  if (!clean) return true;
  const q = clean.toLowerCase();
  return [
    row.property_type,
    row.title
  ].map((v) => normalizeInput(v).toLowerCase()).some((v) => v.includes(q));
}

function findWebsitePublicListings(filters = {}, limit = 5) {
  const searchType = normalizeListingType(filters.searchType || 'any');
  const area = canonicalAreaText(filters.area || filters.preferredArea || '');
  const propertyType = normalizeInput(filters.propertyType || '');
  const maxBudget = Number(filters.maxBudgetUgx || 0);
  const bedsMin = Number(filters.bedsMin || 0);

  return WEBSITE_PUBLIC_LISTINGS
    .filter((row) => listingMatchesSearchType(row, searchType))
    .filter((row) => listingMatchesArea(row, area))
    .filter((row) => listingMatchesPropertyType(row, propertyType))
    .filter((row) => !Number.isFinite(maxBudget) || maxBudget <= 0 || !row.price || Number(row.price) <= maxBudget)
    .filter((row) => !Number.isFinite(bedsMin) || bedsMin <= 0 || Number(row.bedrooms || 0) >= bedsMin)
    .slice(0, limit);
}

function mergeSearchRows(primaryRows = [], websiteRows = [], limit = 5) {
  const rows = [];
  const seen = new Set();
  [...primaryRows, ...websiteRows].forEach((row) => {
    if (!row || rows.length >= limit) return;
    const key = normalizeInput(row.id || `${row.title}-${row.area}-${row.district}`).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  });
  return rows;
}

async function findPropertiesByNaturalFilters(filters = {}) {
  const values = ['approved'];
  let where = 'WHERE status = $1';

  const listingType = normalizeListingType(filters.searchType || 'any');
  if (listingType !== 'any') {
    if (listingType === 'student') {
      where += ` AND (
        listing_type = 'student'
        OR students_welcome = TRUE
        OR title ILIKE '%student%'
        OR title ILIKE '%hostel%'
        OR description ILIKE '%student%'
        OR description ILIKE '%hostel%'
        OR COALESCE(property_type, '') ILIKE '%hostel%'
      )`;
    } else {
      values.push(listingType);
      where += ` AND listing_type = $${values.length}`;
    }
  }

  const area = normalizeInput(filters.area);
  if (area) {
    const regionDistricts = getRegionDistricts(area);
    if (regionDistricts.length) {
      values.push(regionDistricts);
      const regionIdx = values.length;
      values.push(`%${area}%`);
      const qIdx = values.length;
      where += ` AND (
        district = ANY($${regionIdx})
        OR COALESCE(extra_fields->>'region', '') ILIKE $${qIdx}
        OR COALESCE(extra_fields->>'resolved_location_label', '') ILIKE $${qIdx}
      )`;
    } else {
      values.push(`%${area}%`);
      const qIdx = values.length;
      where += ` AND (
        district ILIKE $${qIdx}
        OR area ILIKE $${qIdx}
        OR title ILIKE $${qIdx}
        OR COALESCE(address, '') ILIKE $${qIdx}
        OR COALESCE(description, '') ILIKE $${qIdx}
        OR COALESCE(extra_fields->>'city', '') ILIKE $${qIdx}
        OR COALESCE(extra_fields->>'neighborhood', '') ILIKE $${qIdx}
        OR COALESCE(extra_fields->>'street_name', '') ILIKE $${qIdx}
        OR COALESCE(extra_fields->>'region', '') ILIKE $${qIdx}
        OR COALESCE(extra_fields->>'resolved_location_label', '') ILIKE $${qIdx}
      )`;
    }
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
    `SELECT p.id, p.title, p.listing_type, p.district, p.area, p.price, p.price_period, p.bedrooms, p.bathrooms, p.property_type, p.extra_fields,
            img.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT CASE WHEN url ~* '^https?://' AND length(url) < 500 THEN url ELSE NULL END AS url
       FROM property_images
       WHERE property_id = p.id
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC
       LIMIT 1
     ) img ON TRUE
     ${where}
     ORDER BY p.created_at DESC
     LIMIT 5`,
    values
  );

  const websiteRows = findWebsitePublicListings(filters, 5);
  return mergeSearchRows(result.rows, websiteRows, 5);
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

function isAnyAreaReply(value) {
  const clean = normalizeInput(value).toLowerCase();
  return /^(any|anywhere|any area|anything|show me anything)\b/i.test(clean)
    || /\b(?:i\s+)?don.?t mind\b/i.test(clean)
    || /\bdoesn.?t matter\b/i.test(clean)
    || /\bdont mind\b/i.test(clean)
    || /\bdoesnt matter\b/i.test(clean);
}

function fallbackNaturalSearchSentence(text) {
  const clean = normalizeInput(text);
  const lower = clean.toLowerCase();
  const areaMatch = lower.match(/\b(?:in|near|around)\s+([a-z][a-z\s'.-]{1,60})$/i);
  const area = normalizeInput(areaMatch?.[1] || '').replace(/\b(right now|please|thanks?)$/i, '').trim();
  if (!area) return { hasSignal: false };

  let searchType = 'any';
  if (/\b(student|hostel|accommodation)\b/i.test(clean)) searchType = 'student';
  else if (/\b(commercial|shop|office|retail)\b/i.test(clean)) searchType = 'commercial';
  else if (/\b(land|plot)\b/i.test(clean)) searchType = 'land';
  else if (/\b(rent|rental|to rent|for rent)\b/i.test(clean)) searchType = 'rent';
  else if (/\b(buy|sale|for sale|purchase)\b/i.test(clean)) searchType = 'sale';

  let propertyType = '';
  if (/\bhouse|home\b/i.test(clean)) propertyType = 'house';
  else if (/\bflat|apartment\b/i.test(clean)) propertyType = 'apartment';
  else if (/\broom\b/i.test(clean)) propertyType = 'room';

  return {
    hasSignal: searchType !== 'any' || !!propertyType,
    searchType,
    area,
    propertyType: propertyType || null
  };
}

function looksLikeLocationOnlySearch(text) {
  const clean = normalizeInput(text);
  if (clean.length < 2 || clean.length > 80) return false;
  if (mapSearchTypeInput(clean) || isAnyAreaReply(clean) || isGreetingText(clean)) return false;
  if (/\b(agent|broker|realtor|list|sell my|advertise|otp|code|help|support|menu|done)\b/i.test(clean)) return false;
  if (DISTRICTS.some((d) => d.toLowerCase() === clean.toLowerCase())) return true;
  return /^[a-z][a-z\s'.-]+$/i.test(clean);
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

async function issueOtp(identifier, options = {}) {
  const channel = String(options.channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
  const destination = channel === 'email'
    ? String(identifier || '').trim().toLowerCase()
    : normalizeContactPhone(identifier);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  await db.query(
    "UPDATE otps SET used = TRUE WHERE phone = $1 AND purpose = 'verify' AND used = FALSE",
    [destination]
  );

  await db.query(
    "INSERT INTO otps (phone, code, purpose, expires_at) VALUES ($1, $2, 'verify', NOW() + INTERVAL '10 minutes')",
    [destination, otp]
  );

  try {
    if (channel === 'email') {
      await sendSupportEmail({
        to: destination,
        subject: 'MakaUg listing verification code',
        text: `Your MakaUg listing verification code is ${otp}. It is valid for 10 minutes. Do not share this code.`
      });
    } else {
      await smsService.sendSMS(destination, `MakaUg listing verification: ${otp}. Valid 10 mins. Do not share.`);
    }
  } catch (e) {
    logger.error(`OTP ${channel} failed:`, e.message);
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
    if (searchType === 'student') {
      where += ` AND (
        listing_type = 'student'
        OR students_welcome = TRUE
        OR title ILIKE '%student%'
        OR title ILIKE '%hostel%'
        OR description ILIKE '%student%'
        OR description ILIKE '%hostel%'
        OR COALESCE(property_type, '') ILIKE '%hostel%'
      )`;
    } else {
      values.push(searchType);
      where += ` AND listing_type = $${values.length}`;
    }
  }

  const cleanLocation = normalizeInput(location);
  if (cleanLocation) {
    const regionDistricts = getRegionDistricts(cleanLocation);
    if (regionDistricts.length) {
      values.push(regionDistricts);
      const regionIdx = values.length;
      values.push(`%${cleanLocation}%`);
      const likeIdx = values.length;
      where += ` AND (
        district = ANY($${regionIdx})
        OR COALESCE(extra_fields->>'region', '') ILIKE $${likeIdx}
        OR COALESCE(extra_fields->>'resolved_location_label', '') ILIKE $${likeIdx}
      )`;
    } else {
      values.push(`%${cleanLocation}%`);
      const likeIdx = values.length;
      where += ` AND (
        district ILIKE $${likeIdx}
        OR area ILIKE $${likeIdx}
        OR title ILIKE $${likeIdx}
        OR COALESCE(address, '') ILIKE $${likeIdx}
        OR COALESCE(description, '') ILIKE $${likeIdx}
        OR COALESCE(extra_fields->>'city', '') ILIKE $${likeIdx}
        OR COALESCE(extra_fields->>'neighborhood', '') ILIKE $${likeIdx}
        OR COALESCE(extra_fields->>'street_name', '') ILIKE $${likeIdx}
        OR COALESCE(extra_fields->>'region', '') ILIKE $${likeIdx}
        OR COALESCE(extra_fields->>'resolved_location_label', '') ILIKE $${likeIdx}
      )`;
    }
  }

  const result = await db.query(
    `SELECT p.id, p.title, p.listing_type, p.district, p.area, p.price, p.price_period, p.bedrooms, p.bathrooms, p.property_type, p.extra_fields,
            img.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT CASE WHEN url ~* '^https?://' AND length(url) < 500 THEN url ELSE NULL END AS url
       FROM property_images
       WHERE property_id = p.id
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC
       LIMIT 1
     ) img ON TRUE
     ${where}
     ORDER BY p.created_at DESC
     LIMIT 5`,
    values
  );

  const websiteRows = findWebsitePublicListings({
    searchType,
    area: cleanLocation
  }, 5);
  return mergeSearchRows(result.rows, websiteRows, 5);
}

async function findPropertiesNearWhatsapp(searchType, sharedLocation, radiusMiles = 5) {
  const values = ['approved'];
  let where = 'WHERE status = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL';

  if (searchType && searchType !== 'any') {
    values.push(searchType);
    where += ` AND listing_type = $${values.length}`;
  }

  const result = await db.query(
    `SELECT p.id, p.title, p.listing_type, p.district, p.area, p.price, p.price_period, p.latitude, p.longitude, p.extra_fields,
            p.bedrooms, p.bathrooms, p.property_type, img.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT CASE WHEN url ~* '^https?://' AND length(url) < 500 THEN url ELSE NULL END AS url
       FROM property_images
       WHERE property_id = p.id
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC
       LIMIT 1
     ) img ON TRUE
     ${where}
     ORDER BY p.created_at DESC
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

  const radiusKm = Math.max(1, Number(radiusMiles) || 5) * 1.609344;
  const nearby = rowsWithDistance.filter((row) => row.distance_km <= radiusKm);
  return {
    rows: (nearby.length ? nearby : rowsWithDistance).slice(0, 5),
    usedNearestFallback: nearby.length === 0 && rowsWithDistance.length > 0,
    radiusMiles: Math.max(1, Number(radiusMiles) || 5)
  };
}

async function findPropertiesNearWhatsappWithFilters(baseSearchType, sharedLocation, filters = null, radiusMiles = 5) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const values = ['approved'];
  let where = 'WHERE status = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL';

  const listingType = normalizeListingType(f.searchType || baseSearchType || 'any');
  if (listingType && listingType !== 'any') {
    if (listingType === 'student') {
      where += ` AND (
        listing_type = 'student'
        OR students_welcome = TRUE
        OR title ILIKE '%student%'
        OR title ILIKE '%hostel%'
        OR description ILIKE '%student%'
        OR description ILIKE '%hostel%'
        OR COALESCE(property_type, '') ILIKE '%hostel%'
      )`;
    } else {
      values.push(listingType);
      where += ` AND listing_type = $${values.length}`;
    }
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
    const regionDistricts = getRegionDistricts(area);
    if (regionDistricts.length) {
      values.push(regionDistricts);
      const regionIdx = values.length;
      values.push(`%${area}%`);
      const areaIdx = values.length;
      where += ` AND (
        district = ANY($${regionIdx})
        OR COALESCE(extra_fields->>'region', '') ILIKE $${areaIdx}
        OR COALESCE(extra_fields->>'resolved_location_label', '') ILIKE $${areaIdx}
      )`;
    } else {
      values.push(`%${area}%`);
      const areaIdx = values.length;
      where += ` AND (
        district ILIKE $${areaIdx}
        OR area ILIKE $${areaIdx}
        OR title ILIKE $${areaIdx}
        OR COALESCE(address, '') ILIKE $${areaIdx}
        OR COALESCE(description, '') ILIKE $${areaIdx}
        OR COALESCE(extra_fields->>'city', '') ILIKE $${areaIdx}
        OR COALESCE(extra_fields->>'neighborhood', '') ILIKE $${areaIdx}
        OR COALESCE(extra_fields->>'street_name', '') ILIKE $${areaIdx}
        OR COALESCE(extra_fields->>'region', '') ILIKE $${areaIdx}
        OR COALESCE(extra_fields->>'resolved_location_label', '') ILIKE $${areaIdx}
      )`;
    }
  }

  const result = await db.query(
    `SELECT p.id, p.title, p.listing_type, p.district, p.area, p.price, p.price_period, p.bedrooms, p.bathrooms, p.property_type, p.latitude, p.longitude, p.extra_fields,
            img.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT CASE WHEN url ~* '^https?://' AND length(url) < 500 THEN url ELSE NULL END AS url
       FROM property_images
       WHERE property_id = p.id
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC
       LIMIT 1
     ) img ON TRUE
     ${where}
     ORDER BY p.created_at DESC
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

  const radiusKm = Math.max(1, Number(radiusMiles) || 5) * 1.609344;
  const nearby = rowsWithDistance.filter((row) => row.distance_km <= radiusKm);
  return {
    rows: (nearby.length ? nearby : rowsWithDistance).slice(0, 5),
    usedNearestFallback: nearby.length === 0 && rowsWithDistance.length > 0,
    radiusMiles: Math.max(1, Number(radiusMiles) || 5)
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

async function findAllAgentsForWhatsapp(limit = 5) {
  const result = await db.query(
    `SELECT id, full_name, company_name, phone, whatsapp, rating, districts_covered
     FROM agents
     WHERE status = 'approved'
     ORDER BY rating DESC NULLS LAST, created_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(10, Number(limit) || 5))]
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

function extractPrimaryAgentArea(text, sessionData = {}) {
  const clean = normalizeInput(text);
  if (!clean) return '';
  const parsedArea = sanitizeSearchAreaCandidate(parseAreaFromText(clean, sessionData), clean);
  if (parsedArea) return parsedArea;
  const lower = clean.toLowerCase();
  const districtHit = DISTRICTS.find((district) => lower.includes(String(district || '').toLowerCase()));
  if (districtHit) return districtHit;
  return '';
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

function safePublicPreviewUrl(value) {
  const url = normalizeInput(value);
  if (!/^https?:\/\//i.test(url)) return '';
  if (url.length > 500) return '';
  return url;
}

function getExtraField(row, key) {
  const extra = row?.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return extra[key];
}

function isSponsoredWhatsappRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return row.featured === true
    || row.is_sponsored === true
    || row.sponsored === true
    || String(extra.sponsored || '').toLowerCase() === 'true'
    || String(extra.whatsapp_sponsored || '').toLowerCase() === 'true'
    || String(extra.ad_placement || '').toLowerCase().includes('sponsor');
}

function sponsoredBadge(lang) {
  const code = resolveLangCode(lang);
  const labels = {
    en: '💚 Sponsored MakaUg pick',
    lg: '💚 MakaUg sponsored pick',
    sw: '💚 Chaguo la MakaUg lililodhaminiwa',
    ac: '💚 MakaUg pick ma sponsored',
    ny: '💚 MakaUg pick erikushagikwa',
    rn: '💚 MakaUg pick yishyuwe',
    sm: '💚 MakaUg sponsored pick'
  };
  return labels[code] || labels.en;
}

function widenedNearbyIntro(lang, miles = 15) {
  const code = resolveLangCode(lang);
  const messages = {
    en: `📍 I widened the search to ${miles} miles.`,
    lg: `📍 Ngaziyizza okunoonya okutuuka ku miles ${miles}.`,
    sw: `📍 Nimepanua utafutaji hadi maili ${miles}.`,
    ac: `📍 Ayaro yeny me oo i miles ${miles}.`,
    ny: `📍 Ningazire okushaka kuhika aha miles ${miles}.`,
    rn: `📍 Naguriye ukurondera gushika kuri miles ${miles}.`,
    sm: `📍 Ngaziyizza okunoonya okutuuka ku miles ${miles}.`
  };
  return messages[code] || messages.en;
}

function listingDraftSavedNote(lang) {
  const code = resolveLangCode(lang);
  const messages = {
    en: 'I have kept your listing draft safe.',
    lg: 'Nterese draft ya listing yo bulungi.',
    sw: 'Nimehifadhi draft ya tangazo lako salama.',
    ac: 'Agwoko draft me listing mamegi maber.',
    ny: 'Nabika draft ya listing yaawe gye.',
    rn: 'Nabitse draft ya listing yanyu neza.',
    sm: 'Nterese draft ya listing yo bulungi.'
  };
  return messages[code] || messages.en;
}

async function findBroaderPropertyFallback(filters = {}) {
  const searchType = normalizeListingType(filters.searchType || 'any');
  const area = normalizeInput(filters.area || filters.preferredArea || '');
  const propertyType = normalizeInput(filters.propertyType || '');
  const attempts = [];

  if (searchType !== 'any' && area) {
    attempts.push(() => findPropertiesByNaturalFilters({
      ...filters,
      searchType: 'any',
      propertyType: propertyType || null
    }));
  }
  if (area) attempts.push(() => findPropertiesForWhatsapp('any', area));
  if (searchType !== 'any') attempts.push(() => findPropertiesForWhatsapp(searchType, ''));
  attempts.push(() => findPropertiesForWhatsapp('any', ''));

  for (const attempt of attempts) {
    const rows = await attempt();
    if (rows.length) return rows;
  }
  return [];
}

async function formatNoMatchOrFallbackReply({
  lang,
  userPhone,
  searchType = 'any',
  area = '',
  queryText = '',
  notes = '',
  filters = {}
}) {
  const normalizedSearchType = normalizeListingType(searchType || filters.searchType || 'any');
  const preferredArea = normalizeInput(area || filters.area || '') || 'any';
  await createNoMatchLead({
    userPhone,
    searchType: normalizedSearchType,
    preferredArea,
    notes
  });
  await patchSessionData(userPhone, {
    last_no_match: {
      search_type: normalizedSearchType,
      area: preferredArea,
      query: queryText,
      created_at: new Date().toISOString()
    }
  });

  const fallbackRows = await findBroaderPropertyFallback({
    ...filters,
    searchType: normalizedSearchType,
    area: preferredArea === 'any' ? '' : preferredArea
  });

  if (!fallbackRows.length) return formatNoMatchReply(lang, preferredArea === 'any' ? 'any area' : preferredArea);

  const code = resolveLangCode(lang);
  const exactLabel = typeLabel(normalizedSearchType, lang);
  const locationLabel = preferredArea === 'any' ? 'any area' : preferredArea;
  const copy = {
    en: [
      `I do not have an approved exact match for *${exactLabel}* in *${locationLabel}* right now.`,
      'I have saved this request so MakaUg can follow up when a matching listing appears.',
      'While we look, here are live MakaUg listings that may still help:'
    ],
    lg: [
      `Sirina exact match ekakasiddwa ya *${exactLabel}* mu *${locationLabel}* kati.`,
      'Nterese okusaba kuno MakaUg esobole okukugoberera nga listing ekwatagana evuddeyo.',
      'Nga tunoonya, zino live listings za MakaUg eziyinza okukuyamba:'
    ],
    sw: [
      `Sina match kamili iliyoidhinishwa ya *${exactLabel}* katika *${locationLabel}* kwa sasa.`,
      'Nimehifadhi ombi hili ili MakaUg iweze kukufuatilia listing inayolingana ikipatikana.',
      'Tukiendelea kutafuta, hizi ni live listings za MakaUg zinazoweza kusaidia:'
    ],
    ac: [
      `Pe atye ki exact match ma kimoko pi *${exactLabel}* i *${locationLabel}* kombedi.`,
      'Atyeko gwoko kwac man wek MakaUg orom lubo ka listing ma rwate onen.',
      'Kadi watye ka yeny, man aye live listings pa MakaUg ma romo konyi:'
    ],
    ny: [
      `Tinsangire exact match eyikirizibwe ya *${exactLabel}* omuri *${locationLabel}* hati.`,
      'Nabika okusaba oku kugira ngu MakaUg ekugarukiremu listing erikwesimire yaaba ebonekire.',
      'Tukishaka, ezi ni live listings za MakaUg ezirikubaasa kukuhwera:'
    ],
    rn: [
      `Nta exact match yemejwe ya *${exactLabel}* muri *${locationLabel}* ubu.`,
      'Nabitse iki gisabwa kugira MakaUg izobakurikirane listing ijanye ibonetse.',
      'Tukiriko turarondera, izi ni live listings za MakaUg zishobora kubafasha:'
    ],
    sm: [
      `Sirina exact match ekakasiddwa ya *${exactLabel}* mu *${locationLabel}* kati.`,
      'Nterese okusaba kuno MakaUg esobole okukugoberera nga listing ekwatagana evuddeyo.',
      'Nga tunoonya, zino live listings za MakaUg eziyinza okukuyamba:'
    ]
  };
  const lines = copy[code] || copy.en;
  return [
    lines[0],
    lines[1],
    '',
    lines[2],
    '',
    formatPropertySearchMessage(lang, fallbackRows, preferredArea === 'any' ? 'Any area' : preferredArea, 'any')
  ].join('\n');
}

function formatPropertySearchMessage(lang, rows, location, searchType) {
  const code = resolveLangCode(lang);
  const cardCopy = {
    en: {
      filter: 'Filter',
      bed: 'bed',
      bath: 'bath',
      preview: 'Preview',
      open: 'View photos, map and enquire',
      available: 'Available',
      footer: 'Tap any link to open the full MakaUg page with photos, map, and enquiry options.',
      opensOnMakaUg: 'Every result opens on MakaUg with photos, map and enquiry options.'
    },
    lg: {
      filter: 'Filter',
      bed: 'ekisenge',
      bath: 'bathroom',
      preview: 'Ekifaananyi',
      open: 'Laba ebifaananyi, map, era obuuze',
      available: 'Kisobola okufunibwa',
      footer: 'Nyiga link yonna okuggulawo page ya MakaUg eriko ebifaananyi, map, n\'engeri y\'okubuuza.',
      opensOnMakaUg: 'Buli result eggulawo ku MakaUg n\'ebifaananyi, map, n\'engeri y\'okubuuza.'
    },
    sw: {
      filter: 'Kichujio',
      bed: 'chumba',
      bath: 'bafu',
      preview: 'Picha',
      open: 'Fungua picha, ramani na kuuliza',
      available: 'Inapatikana',
      footer: 'Bonyeza link yoyote kufungua ukurasa kamili wa MakaUg wenye picha, ramani, na sehemu ya kuuliza.',
      opensOnMakaUg: 'Kila matokeo hufunguka MakaUg na picha, ramani na njia ya kuuliza.'
    },
    ac: {
      filter: 'Filter',
      bed: 'bedroom',
      bath: 'bathroom',
      preview: 'Cal',
      open: 'Nen cal, map, ki penyo',
      available: 'Tye',
      footer: 'Dii link mo keken me yabo pot buk MakaUg ma tye ki cal, map, ki yoo me penyo.',
      opensOnMakaUg: 'Result acel acel yabo i MakaUg ki cal, map, ki yoo me penyo.'
    },
    ny: {
      filter: 'Filter',
      bed: 'bedroom',
      bath: 'bathroom',
      preview: 'Ekishushani',
      open: 'Reeba ebishushani, map, kandi obuuze',
      available: 'Kiraboneka',
      footer: 'Kanda link yoona kuguraho page ya MakaUg erimu ebishushani, map, n\'okubuuza.',
      opensOnMakaUg: 'Buri result neegura ahari MakaUg erimu ebishushani, map, n\'okubuuza.'
    },
    rn: {
      filter: 'Filter',
      bed: 'bedroom',
      bath: 'bathroom',
      preview: 'Ifoto',
      open: 'Raba amafoto, map, hanyuma ubaze',
      available: 'Irahari',
      footer: 'Kanda link yose gufungura page ya MakaUg irimwo amafoto, map, n\'aho kubaza.',
      opensOnMakaUg: 'Buri result yuguruka kuri MakaUg irimwo amafoto, map, n\'aho kubaza.'
    },
    sm: {
      filter: 'Filter',
      bed: 'ekisenge',
      bath: 'bathroom',
      preview: 'Ekifaananyi',
      open: 'Laba ebifaananyi, map, era obuuze',
      available: 'Kisobola okufunibwa',
      footer: 'Nyiga link yonna okuggulawo page ya MakaUg eriko ebifaananyi, map, n\'engeri y\'okubuuza.',
      opensOnMakaUg: 'Buli result eggulawo ku MakaUg n\'ebifaananyi, map, n\'engeri y\'okubuuza.'
    }
  };
  const copy = cardCopy[code] || cardCopy.en;
  const lines = [];
  lines.push('🟩🟨 *MakaUg Matchboard* 🟨🟩');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`🔎 *${t(lang, 'searchHeader')}*`);
  lines.push(`🎯 ${copy.filter}: ${typeLabel(searchType, lang)} • ${location}`);
  lines.push(copy.opensOnMakaUg || cardCopy.en.opensOnMakaUg);
  lines.push('━━━━━━━━━━━━━━━━');
  rows.forEach((r, idx) => {
    const meta = [
      r.property_type,
      Number.isFinite(Number(r.bedrooms)) && Number(r.bedrooms) > 0 ? `${r.bedrooms} ${copy.bed}` : '',
      Number.isFinite(Number(r.bathrooms)) && Number(r.bathrooms) > 0 ? `${r.bathrooms} ${copy.bath}` : ''
    ].filter(Boolean).join(' • ');
    const sponsor = isSponsoredWhatsappRow(r);
    lines.push(`${idx + 1}. ${sponsor ? '⭐' : '🏡'} *${r.title}*`);
    if (sponsor) lines.push(`   ${sponsoredBadge(lang)}`);
    lines.push(`   📍 ${[r.area, r.district].filter(Boolean).join(', ')}`);
    lines.push(`   🏷️ ${typeLabel(r.listing_type, lang)}${meta ? ` • ${meta}` : ''}`);
    lines.push(`   💰 ${formatPrice(r.price, r.price_period)}`);
    const availability = normalizeInput(getExtraField(r, 'available_from') || getExtraField(r, 'availability'));
    if (availability) lines.push(`   📅 ${copy.available || cardCopy.en.available}: ${availability}`);
    if (Number.isFinite(Number(r.distance_km))) {
      lines.push(`   📏 ${Number(r.distance_km).toFixed(1)} ${t(lang, 'kmAway')}`);
    }
    const listingUrl = safePublicPreviewUrl(r.property_url || r.url) || `${HOME_URL}/property/${r.id}`;
    lines.push(`   🔗 ${copy.open}: ${listingUrl}`);
    lines.push('━━━━━━━━━━━━━━━━');
  });
  lines.push(`✨ ${copy.footer}`);
  lines.push(t(lang, 'menuHint'));
  lines.push(t(lang, 'replySearchAgain'));
  return lines.join('\n');
}

function cleanAgentDisplayName(value) {
  return normalizeInput(value)
    .replace(/\b\d{7,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+-\s+$/g, '')
    .trim();
}

function formatAgentSearchMessage(lang, rows, location) {
  const lines = [];
  lines.push(`👔 *${t(lang, 'agentHeader')}* (${location})`);
  lines.push('');
  rows.forEach((r, idx) => {
    const areas = Array.isArray(r.districts_covered) ? r.districts_covered.join(', ') : '';
    const name = cleanAgentDisplayName(r.full_name) || 'MakaUg agent';
    const company = cleanAgentDisplayName(r.company_name);
    lines.push(`${idx + 1}. *${name}*${company ? ` - ${company}` : ''}`);
    if (areas) lines.push(`   ${t(lang, 'areasLabel')}: ${areas}`);
    if (r.rating != null) lines.push(`   ${t(lang, 'ratingLabel')}: ⭐ ${Number(r.rating).toFixed(1)}`);
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

function isIdleResumeDue(session = {}) {
  const last = session.last_message_at ? new Date(session.last_message_at).getTime() : 0;
  if (!Number.isFinite(last) || last <= 0) return false;
  return Date.now() - last > 2 * 60 * 1000;
}

function idleResumePrompt(lang, step) {
  const code = resolveLangCode(lang);
  const messages = {
    en: `Welcome back. Do you want to carry on where we left off, or is this a new request?\n\nReply *CONTINUE* to carry on: ${stepReminderMessage(code, step)}\n\nReply *MENU* to start again, or type your new request in one sentence.`,
    lg: `Tukwanirizza nate. Oyagala tugende mu maaso gye twakoma, oba kino kipya?\n\nReply *CONTINUE* okugenda mu maaso: ${stepReminderMessage(code, step)}\n\nReply *MENU* okutandika nate, oba wandika ky'oyagala mu sentence emu.`,
    sw: `Karibu tena. Unataka tuendelee tulipoishia, au hili ni ombi jipya?\n\nJibu *CONTINUE* kuendelea: ${stepReminderMessage(code, step)}\n\nJibu *MENU* kuanza upya, au andika ombi jipya kwa sentensi moja.`
  };
  return messages[code] || messages.en;
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
  'greeting', 'choose_language', 'main_menu', 'listing_type', 'ownership', 'ask_field_agent', 'ask_field_agent_details', 'title', 'district',
  'area', 'price', 'bedrooms', 'description', 'photos', 'ask_deposit', 'ask_contract',
  'ask_university', 'ask_distance', 'ask_public_name', 'ask_contact_method', 'ask_contact_value',
  'ask_id_number', 'ask_selfie', 'ask_phone', 'search_type', 'search_area', 'agent_area',
  'verify_otp', 'submitted'
];

async function processMessage(phone, body, mediaUrl, sharedLocation = null, runtime = {}) {
  const session = await getSession(phone);
  const lang = resolveLangCode(runtime.language || session.language || 'en');
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
    return respond(welcomeMessage(lang, sessionData), 'main_menu');
  }

  if (bodyUpper === 'RESET' || bodyUpper === 'RESTART') {
    await clearSessionData(phone);
    return respond(`${t(lang, 'restarted')}\n\n${t(lang, 'chooseLanguage')}`, 'choose_language');
  }

  if (bodyUpper === 'LANG' || bodyUpper === 'LANGUAGE') {
    return respond(`${t(lang, 'languageUpdated')}\n\n${t(lang, 'chooseLanguage')}`, 'choose_language');
  }

  const languageSwitch = parseLanguageChange(cleanBody);
  if (languageSwitch) {
    const continuingStep = ['greeting', 'main_menu', 'submitted'].includes(step) ? 'main_menu' : step;
    await updateSession(phone, { language: languageSwitch, current_step: continuingStep });
    await patchSessionData(phone, {
      language_changed_at: new Date().toISOString(),
      language_changed_from: lang
    });
    if (continuingStep !== 'main_menu') {
      const reminder = continuingStep === 'photos'
        ? photoNextPrompt(languageSwitch, (draft.photos || []).length)
        : stepReminderMessage(languageSwitch, continuingStep);
      return respond(`${t(languageSwitch, 'languageUpdated')}\n\n${reminder}`, continuingStep);
    }
    return respond(welcomeMessage(languageSwitch, sessionData), 'main_menu');
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
    await patchSessionData(phone, { idle_resume_prompt: null });
    return respond(welcomeMessage(lang, sessionData), 'main_menu');
  }

  const idlePrompt = sessionData.idle_resume_prompt && typeof sessionData.idle_resume_prompt === 'object'
    ? sessionData.idle_resume_prompt
    : null;
  if (idlePrompt) {
    if (isAffirmativeReply(cleanBody) || compactUpper === 'CONTINUE') {
      await patchSessionData(phone, { idle_resume_prompt: null });
      return respond(stepReminderMessage(lang, idlePrompt.step || step), idlePrompt.step || step);
    }
    await patchSessionData(phone, {
      idle_resume_prompt: null,
      idle_resume_resolved_as: 'new_request',
      idle_resume_resolved_at: new Date().toISOString(),
      idle_resume_new_text: cleanBody
    });
    if (!isGreetingText(cleanBody)) {
      await updateSession(phone, { current_step: 'main_menu' });
      return respond(`Got it. I will treat this as a new request.\n\n${friendlyGreetingReply(lang, sessionData)}`, 'main_menu');
    }
  }

  if (
    isIdleResumeDue(session)
    && !['greeting', 'main_menu', 'submitted', 'choose_language'].includes(step)
    && !mediaUrl
    && !sharedLocation
    && cleanBody
  ) {
    await patchSessionData(phone, {
      idle_resume_prompt: {
        step,
        prompted_at: new Date().toISOString()
      }
    });
    return respond(idleResumePrompt(lang, step), step);
  }

  if (isNoMatchChallenge(cleanBody) && sessionData.last_no_match) {
    await patchSessionData(phone, {
      last_no_match_challenge: {
        text: cleanBody,
        last_no_match: sessionData.last_no_match,
        created_at: new Date().toISOString()
      }
    });
    return respond(noMatchChallengeReply(lang, sessionData), 'main_menu');
  }

  if (isGreetingText(cleanBody)) {
    if (['greeting', 'main_menu', 'submitted'].includes(step)) {
      return respond(friendlyGreetingReply(lang, sessionData), 'main_menu');
    }
    return respond(stepReminderMessage(lang, step), step);
  }

  const globalRoute = intentMenuRoute(intentResult?.intent);
  const globalIntentConfidence = Number(intentResult?.confidence || 0);
  const numericOptionReply = /^[1-9]$/.test(cleanBody);
  const activeFlowOwnsNumericReply = numericOptionReply
    && !['greeting', 'main_menu', 'choose_language', 'search_type', 'search_area', 'agent_area'].includes(step);
  if (['greeting', 'main_menu'].includes(step) && globalRoute === 'agent_registration') {
    const next = menuRouteReply(lang, globalRoute);
    return respond(next.message, next.nextStep);
  }

  if (['greeting', 'main_menu'].includes(step) && /\b(agent|broker|realtor)\b/i.test(cleanBody)) {
    const primaryArea = extractPrimaryAgentArea(cleanBody, sessionData);
    const keywords = primaryArea
      ? [primaryArea, ...extractAgentSearchKeywords(cleanBody, sessionData).filter((item) => item !== primaryArea)]
      : extractAgentSearchKeywords(cleanBody, sessionData);
    const rows = await findAgentsForWhatsappKeywords(keywords);
    if (keywords.length && rows.length) {
      return respond(formatAgentSearchMessage(lang, rows, keywords[0]), 'main_menu');
    }
    return respond(t(lang, 'askAgentArea'), 'agent_area');
  }

  if (
    ['greeting', 'main_menu'].includes(step)
    && cleanBody.length > 3
    && (!globalRoute || globalRoute === 'search_type')
  ) {
    let naturalFilters = await resolveNaturalSearchFilters({
      text: cleanBody,
      entities: intentResult?.entities || {},
      fallbackType: 'any',
      language: lang,
      sessionData
    });

    if (!naturalFilters.hasSignal || !naturalFilters.area) {
      const fallbackFilters = fallbackNaturalSearchSentence(cleanBody);
      if (fallbackFilters.hasSignal && fallbackFilters.area) {
        naturalFilters = {
          ...naturalFilters,
          ...fallbackFilters,
          hasSignal: true
        };
      }
    }

    if (!naturalFilters.hasSignal) {
      // Let non-search intents, greetings, and free-form support messages continue through the normal router.
    } else if (naturalFilters.useSharedLocation) {
      await patchSessionData(phone, {
        search_type: naturalFilters.searchType || 'any',
        pending_search_filters: naturalFilters,
        natural_query_text: cleanBody
      });
      return respond(
        naturalSearchPrompt(lang, naturalFilters, 'location'),
        'search_area'
      );
    } else if (!naturalFilters.area) {
      await patchSessionData(phone, {
        search_type: naturalFilters.searchType || 'any',
        pending_search_filters: naturalFilters,
        natural_query_text: cleanBody
      });
      return respond(
        naturalSearchPrompt(lang, naturalFilters, 'area'),
        'search_area'
      );
    } else {
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
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType: naturalFilters.searchType || 'any',
          area: naturalFilters.area,
          queryText: cleanBody,
          filters: naturalFilters,
          notes: `No approved listings found for natural query: ${cleanBody}`
        });
        return respond(reply, 'main_menu');
      }

      return respond(
        `${describeNaturalFilters(naturalFilters, lang) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters, lang)}\n` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || 'any')}`,
        'main_menu'
      );
    }
  }

  const canSwitchFlow = globalRoute
    && step !== 'main_menu'
    && !activeFlowOwnsNumericReply
    && globalRoute !== step
    && !(globalRoute === 'search_type' && ['search_type', 'search_area'].includes(step))
    && !['verify_otp', 'ask_id_number', 'ask_selfie'].includes(step)
    && (
      !['title', 'district', 'area', 'price', 'bedrooms', 'description', 'photos', 'ask_field_agent', 'ask_field_agent_details'].includes(step)
      && !['ask_public_name', 'ask_contact_method', 'ask_contact_value', 'ask_id_number', 'ask_selfie'].includes(step)
      || ['agent_area', 'support', 'account_help', 'report_listing', 'mortgage_help'].includes(globalRoute)
    )
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
    if (cleanBody === '1') return respond(t(lang, 'askListingType'), 'listing_type');
    if (cleanBody === '2') return respond(t(lang, 'askSearchType'), 'search_type');
    if (cleanBody === '3') return respond(t(lang, 'askAgentArea'), 'agent_area');
    return respond(`${friendlyGreetingReply(lang, sessionData)}\n\n${t(lang, 'chooseLanguage')}`, 'choose_language');
  }

  // CHOOSE LANGUAGE
  if (step === 'choose_language') {
    const langMap = { '1': 'en', '2': 'lg', '3': 'sw', '4': 'ac', '5': 'ny', '6': 'rn', '7': 'sm' };
    const chosen = langMap[cleanBody] || 'en';
    await updateSession(phone, { language: chosen });
    await clearSessionData(phone);
    if (sessionData.contact_name) {
      await patchSessionData(phone, { contact_name: sessionData.contact_name });
    }
    return respond(welcomeMessage(chosen, sessionData), 'main_menu');
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
        return respond(`${welcomeMessage(lang, sessionData)}\n\n${t(lang, 'menuHint')}`, 'main_menu');
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

    if (compactUpper === 'WIDEN' && Number.isFinite(Number(sessionData.search_lat)) && Number.isFinite(Number(sessionData.search_lng))) {
      const widenedLocation = {
        lat: Number(sessionData.search_lat),
        lng: Number(sessionData.search_lng),
        address: sessionData.search_location_label || null,
        label: sessionData.search_location_label || null
      };
      const widenedType = sessionData.search_type || 'any';
      const widenedFilters = sessionData.last_nearby_search_filters && typeof sessionData.last_nearby_search_filters === 'object'
        ? sessionData.last_nearby_search_filters
        : { searchType: widenedType };
      const widened = await findPropertiesNearWhatsappWithFilters(
        widenedType,
        widenedLocation,
        widenedFilters,
        15
      );
      await logPropertySearchRequest({
        userPhone: phone,
        searchType: widenedFilters.searchType || widenedType,
        queryText: 'widen_nearby_search',
        location: widenedLocation,
        resultRows: widened.rows,
        usedNearestFallback: widened.usedNearestFallback
      });
      if (!widened.rows.length) {
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType: widenedFilters.searchType || widenedType,
          area: sessionData.search_location_label || 'near me',
          queryText: 'widen_nearby_search',
          filters: widenedFilters,
          notes: 'No approved listings found from widened WhatsApp location search.'
        });
        return respond(reply, 'main_menu');
      }
      return respond(
        `${widenedNearbyIntro(lang, 15)}\n\n${formatPropertySearchMessage(lang, widened.rows, sessionData.search_location_label || 'near me', widenedFilters.searchType || widenedType)}`,
        'main_menu'
      );
    }

    let naturalFilters = await resolveNaturalSearchFilters({
      text: cleanBody,
      entities: intentResult?.entities || {},
      fallbackType: 'any',
      language: lang,
      sessionData
    });
    if (!naturalFilters.hasSignal || !naturalFilters.area) {
      const fallbackFilters = fallbackNaturalSearchSentence(cleanBody);
      if (fallbackFilters.hasSignal && fallbackFilters.area) {
        naturalFilters = {
          ...naturalFilters,
          ...fallbackFilters,
          hasSignal: true
        };
      }
    }
    const likelyPropertySearchIntent = ['property_search', 'looking_for_property_lead'].includes(intentResult?.intent);
    if (likelyPropertySearchIntent || naturalFilters.hasSignal) {
      if (naturalFilters.useSharedLocation) {
        await patchSessionData(phone, {
          search_type: naturalFilters.searchType || 'any',
          pending_search_filters: naturalFilters,
          natural_query_text: cleanBody
        });
        return respond(
          naturalSearchPrompt(lang, naturalFilters, 'location'),
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
          naturalSearchPrompt(lang, naturalFilters, 'area'),
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
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType: naturalFilters.searchType || 'any',
          area: naturalFilters.area,
          queryText: cleanBody,
          filters: naturalFilters,
          notes: `No approved listings found for natural query: ${cleanBody}`
        });
        return respond(reply, 'main_menu');
      }

      const fxNote = naturalFilters.convertedFromUsd
        ? '\n(Using approx FX: 1 USD = 3,800 UGX for matching.)\n'
        : '\n';
      return respond(
        `${describeNaturalFilters(naturalFilters, lang) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters, lang)}${fxNote}` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || 'any')}`,
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
    let naturalFilters = await resolveNaturalSearchFilters({
      text: cleanBody,
      entities: intentResult?.entities || {},
      fallbackType: 'any',
      language: lang,
      sessionData
    });

    if (!naturalFilters.hasSignal || !naturalFilters.area) {
      const fallbackFilters = fallbackNaturalSearchSentence(cleanBody);
      if (fallbackFilters.hasSignal && fallbackFilters.area) {
        naturalFilters = {
          ...naturalFilters,
          ...fallbackFilters,
          hasSignal: true
        };
      }
    }

    if (naturalFilters.hasSignal && naturalFilters.area) {
      const rows = await findPropertiesByNaturalFilters(naturalFilters);
      await patchSessionData(phone, { pending_search_filters: null, search_type: naturalFilters.searchType || 'any' });
      await logPropertySearchRequest({
        userPhone: phone,
        searchType: naturalFilters.searchType || 'any',
        queryText: cleanBody,
        location: null,
        resultRows: rows,
        usedNearestFallback: false
      });
      if (!rows.length) {
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType: naturalFilters.searchType || 'any',
          area: naturalFilters.area,
          queryText: cleanBody,
          filters: naturalFilters,
          notes: `No approved listings found for natural query in search_type: ${cleanBody}`
        });
        return respond(reply, 'main_menu');
      }
      return respond(
        `${describeNaturalFilters(naturalFilters, lang) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters, lang)}\n` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || 'any')}`,
        'main_menu'
      );
    }

    if (isAnyAreaReply(cleanBody)) {
      const rows = await findPropertiesForWhatsapp('any', '');
      await patchSessionData(phone, { search_type: 'any', pending_search_filters: null });
      await logPropertySearchRequest({
        userPhone: phone,
        searchType: 'any',
        queryText: cleanBody,
        location: null,
        resultRows: rows,
        usedNearestFallback: false
      });
      if (!rows.length) {
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType: 'any',
          area: 'any',
          queryText: cleanBody,
          notes: 'No approved listings found from broad WhatsApp search type.'
        });
        return respond(reply, 'main_menu');
      }
      return respond(formatPropertySearchMessage(lang, rows, 'Any area', 'any'), 'main_menu');
    }

    const searchType = mapSearchTypeInput(cleanBody);
    if (searchType) {
      await patchSessionData(phone, { search_type: searchType });
      return respond(t(lang, 'askSearchArea'), 'search_area');
    }

    if (looksLikeLocationOnlySearch(cleanBody)) {
      const rows = await findPropertiesForWhatsapp('any', cleanBody);
      await patchSessionData(phone, { search_type: 'any', pending_search_filters: null });
      await logPropertySearchRequest({
        userPhone: phone,
        searchType: 'any',
        queryText: cleanBody,
        location: null,
        resultRows: rows,
        usedNearestFallback: false
      });
      if (!rows.length) {
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType: 'any',
          area: cleanBody,
          queryText: cleanBody,
          notes: `No approved listings found for location-only WhatsApp search: ${cleanBody}`
        });
        return respond(reply, 'main_menu');
      }
      return respond(formatPropertySearchMessage(lang, rows, cleanBody, 'any'), 'main_menu');
    }

    if (!naturalFilters.hasSignal) return respond(`${t(lang, 'invalidInput')}\n\n${t(lang, 'askSearchType')}`, 'search_type');

    if (naturalFilters.useSharedLocation) {
      await patchSessionData(phone, {
        search_type: naturalFilters.searchType || 'any',
        pending_search_filters: naturalFilters,
        natural_query_text: cleanBody
      });
      return respond(
        naturalSearchPrompt(lang, naturalFilters, 'location'),
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
        naturalSearchPrompt(lang, naturalFilters, 'area'),
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
      const reply = await formatNoMatchOrFallbackReply({
        lang,
        userPhone: phone,
        searchType: naturalFilters.searchType || 'any',
        area: naturalFilters.area,
        queryText: cleanBody,
        filters: naturalFilters,
        notes: `No approved listings found for natural query: ${cleanBody}`
      });
      return respond(reply, 'main_menu');
    }

    return respond(
      `${describeNaturalFilters(naturalFilters, lang) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters, lang)}\n` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || 'any')}`,
      'main_menu'
    );
  }

  // SEARCH AREA
  if (step === 'search_area') {
    const searchType = sessionData.search_type || 'any';
    const pendingFilters = sessionData.pending_search_filters && typeof sessionData.pending_search_filters === 'object'
      ? sessionData.pending_search_filters
      : null;
    if (!sharedLocation && isLocationPreviewWithoutCoordinates(runtime.mediaType, cleanBody)) {
      await patchSessionData(phone, {
        last_location_preview_without_coordinates: {
          search_type: pendingFilters?.searchType || searchType,
          body: cleanBody,
          media_type: runtime.mediaType || null,
          created_at: new Date().toISOString()
        }
      });
      return respond(locationPreviewPrompt(lang), 'search_area');
    }

    if (isAnyAreaReply(cleanBody)) {
      const rows = await findPropertiesForWhatsapp(searchType, '');
      await patchSessionData(phone, { pending_search_filters: null });
      await logPropertySearchRequest({
        userPhone: phone,
        searchType,
        queryText: cleanBody,
        location: null,
        resultRows: rows,
        usedNearestFallback: false
      });
      if (!rows.length) {
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType,
          area: 'any',
          queryText: cleanBody,
          notes: 'No approved listings found from broad WhatsApp search.'
        });
        return respond(reply, 'main_menu');
      }
      return respond(formatPropertySearchMessage(lang, rows, 'Any area', searchType), 'main_menu');
    }

    if (sharedLocation && Number.isFinite(Number(sharedLocation.lat)) && Number.isFinite(Number(sharedLocation.lng))) {
      await patchSessionData(phone, {
        search_lat: Number(sharedLocation.lat),
        search_lng: Number(sharedLocation.lng),
        search_location_label: sharedLocation.address || sharedLocation.label || null,
        search_type: pendingFilters?.searchType || searchType,
        last_nearby_search_filters: pendingFilters || { searchType },
        last_nearby_search_at: new Date().toISOString(),
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
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType: pendingFilters?.searchType || searchType,
          area: locationText,
          queryText: 'shared_location',
          filters: pendingFilters || { searchType },
          notes: 'No approved listings found from shared location search.'
        });
        return respond(reply, 'main_menu');
      }

      const extra = near.usedNearestFallback
        ? `\n${t(lang, 'searchNoNearbyResults')}\n${t(lang, 'widenNearbySearch')}\n`
        : `\n${t(lang, 'widenNearbySearch')}\n`;
      return respond(
        `${t(lang, 'locationSharedReceived')}${extra}${pendingFilters ? `\n${describeNaturalFilters(pendingFilters, lang) ? `Filters: ${describeNaturalFilters(pendingFilters, lang)}\n` : ''}` : ''}\n${formatPropertySearchMessage(lang, near.rows, locationText, pendingFilters?.searchType || searchType)}`,
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
        const reply = await formatNoMatchOrFallbackReply({
          lang,
          userPhone: phone,
          searchType: naturalFilters.searchType || 'any',
          area: naturalFilters.area,
          queryText: cleanBody,
          filters: naturalFilters,
          notes: `No approved listings found for natural query in search_area: ${cleanBody}`
        });
        return respond(reply, 'main_menu');
      }
      return respond(
        `${describeNaturalFilters(naturalFilters, lang) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters, lang)}\n` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || searchType || 'any')}`,
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
      const reply = await formatNoMatchOrFallbackReply({
        lang,
        userPhone: phone,
        searchType,
        area: cleanBody,
        queryText: cleanBody,
        notes: 'No approved listings found from typed area search.'
      });
      return respond(reply, 'main_menu');
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

    if (isAnyAreaReply(cleanBody)) {
      const rows = await findAllAgentsForWhatsapp(5);
      if (!rows.length) {
        return respond(
          `${t(lang, 'noAgentsFound')}\n\n${tt(lang, 'seeAllAgents', { url: `${HOME_URL}/#page-brokers` })}\n${t(lang, 'menuHint')}`,
          'main_menu'
        );
      }
      return respond(formatAgentSearchMessage(lang, rows, t(lang, 'typeAny')), 'main_menu');
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
    return respond(t(lang, 'askFieldAgent'), 'ask_field_agent');
  }

  // FIELD AGENT CREDIT
  if (step === 'ask_field_agent') {
    if (isAffirmativeReply(cleanBody)) {
      await patchDraft(phone, { assisted_by_field_agent: true });
      return respond(t(lang, 'askFieldAgentDetails'), 'ask_field_agent_details');
    }
    if (isNegativeReply(cleanBody)) {
      await patchDraft(phone, { assisted_by_field_agent: false });
      return respond(t(lang, 'askTitle'), 'title');
    }
    return respond(t(lang, 'invalidInput') + '\n\n' + t(lang, 'askFieldAgent'), 'ask_field_agent');
  }

  if (step === 'ask_field_agent_details') {
    if (cleanBody.length < 2) return respond(t(lang, 'askFieldAgentDetails'), 'ask_field_agent_details');
    await patchDraft(phone, {
      assisted_by_field_agent: true,
      field_agent_reference: cleanBody
    });
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
    return respond(`${t(lang, 'askPhotos')}\n${photoNextPrompt(lang, 0)}`, 'photos');
  }

  // PHOTOS
  if (step === 'photos') {
    if (!mediaUrl && cleanBody && bodyUpper !== 'DONE') {
      let naturalFilters = await resolveNaturalSearchFilters({
        text: cleanBody,
        entities: intentResult?.entities || {},
        fallbackType: 'any',
        language: lang,
        sessionData
      });
      if (!naturalFilters.hasSignal || !naturalFilters.area) {
        const fallbackFilters = fallbackNaturalSearchSentence(cleanBody);
        if (fallbackFilters.hasSignal && fallbackFilters.area) {
          naturalFilters = {
            ...naturalFilters,
            ...fallbackFilters,
            hasSignal: true
          };
        }
      }

      const likelySearch = ['property_search', 'looking_for_property_lead'].includes(intentResult?.intent)
        || /\b(looking for|search|find|need|student accommodation|house|home|apartment|flat|land|commercial|rent|buy)\b/i.test(cleanBody);

      if (likelySearch || naturalFilters.hasSignal) {
        await patchSessionData(phone, {
          interrupted_step: 'photos',
          interrupted_at: new Date().toISOString(),
          interrupted_by_intent: 'property_search',
          interrupted_text: cleanBody,
          listing_draft_saved: true,
          search_type: naturalFilters.searchType || 'any',
          pending_search_filters: naturalFilters.hasSignal ? naturalFilters : null,
          natural_query_text: cleanBody
        });

        const draftNote = listingDraftSavedNote(lang);
        if (naturalFilters.useSharedLocation) {
          return respond(
            `${draftNote}\n\n${naturalSearchPrompt(lang, naturalFilters, 'location')}`,
            'search_area'
          );
        }

        if (!naturalFilters.area) {
          return respond(
            `${draftNote}\n\n${naturalSearchPrompt(lang, naturalFilters, 'area')}`,
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
          const reply = await formatNoMatchOrFallbackReply({
            lang,
            userPhone: phone,
            searchType: naturalFilters.searchType || 'any',
            area: naturalFilters.area,
            queryText: cleanBody,
            filters: naturalFilters,
            notes: `No approved listings found for natural query during photo upload: ${cleanBody}`
          });
          return respond(`${draftNote}\n\n${reply}`, 'main_menu');
        }

        return respond(
          `${draftNote}\n\n${describeNaturalFilters(naturalFilters, lang) ? `✅ Filters applied: ${describeNaturalFilters(naturalFilters, lang)}\n` : ''}${formatPropertySearchMessage(lang, rows, naturalFilters.area, naturalFilters.searchType || 'any')}`,
          'main_menu'
        );
      }
    }

    if (bodyUpper === 'DONE' && !mediaUrl) {
      const currentPhotos = draft.photos || [];
      if (currentPhotos.length < 5) return respond(t(lang, 'needExactlyFivePhotos'), 'photos');
      return respond(t(lang, 'askPublicName'), 'ask_public_name');
    }
    if (mediaUrl) {
      const photos = draft.photos || [];
      const incomingCount = Math.max(1, Math.min(10, Number(runtime.mediaCount || 0) || 1));
      if (photos.length >= 10) {
        return respond(tt(lang, 'photosUploaded', { count: photos.length }), 'photos');
      }
      const availableSlots = Math.max(0, 10 - photos.length);
      const toAdd = Math.min(incomingCount, availableSlots);
      for (let i = 0; i < toAdd; i += 1) {
        photos.push(toAdd === 1 ? mediaUrl : `${mediaUrl}#${i + 1}`);
      }
      await patchDraft(phone, { photos });
      const count = photos.length;
      if (count >= 5) {
        return respond(`${photoCompletePrompt(lang, count)}\n\n${t(lang, 'askPublicName')}`, 'ask_public_name');
      }
      return respond(`${tt(lang, 'photoReceived', { count })}\n${photoNextPrompt(lang, count)}`, 'photos');
    }
    return respond(t(lang, 'invalidInput') + '\n\n' + photoNextPrompt(lang, (draft.photos || []).length), 'photos');
  }

  // PUBLIC CONTACT NAME
  if (step === 'ask_public_name') {
    if (cleanBody.length < 2) return respond(t(lang, 'askPublicName'), 'ask_public_name');
    await patchDraft(phone, { lister_name: cleanBody, contact_display_name: cleanBody });
    return respond(t(lang, 'askContactMethod'), 'ask_contact_method');
  }

  // CONTACT METHOD
  if (step === 'ask_contact_method') {
    const normalized = cleanBody.toLowerCase();
    const method = ['2', 'email', 'mail', 'e-mail'].includes(normalized)
      ? 'email'
      : (['1', 'phone', 'whatsapp', 'sms', 'call'].includes(normalized) ? 'phone' : '');
    if (!method) return respond(t(lang, 'invalidInput') + '\n\n' + t(lang, 'askContactMethod'), 'ask_contact_method');
    await patchDraft(phone, { preferred_contact_channel: method, otp_channel: method });
    return respond(method === 'email' ? t(lang, 'askContactValueEmail') : t(lang, 'askContactValuePhone'), 'ask_contact_value');
  }

  // CONTACT VALUE
  if (step === 'ask_contact_value') {
    const method = draft.preferred_contact_channel === 'email' ? 'email' : 'phone';
    if (method === 'email') {
      const email = cleanBody.toLowerCase();
      if (!isValidEmailAddress(email)) return respond(t(lang, 'askContactValueEmail'), 'ask_contact_value');
      await patchDraft(phone, { lister_email: email, owner_email: email, otp_identifier: email, otp_channel: 'email' });
    } else {
      const contactPhone = normalizeContactPhone(cleanBody);
      if (!isValidContactPhone(contactPhone)) return respond(t(lang, 'askContactValuePhone'), 'ask_contact_value');
      await patchDraft(phone, { owner_phone: contactPhone, lister_phone: contactPhone, otp_identifier: contactPhone, otp_channel: 'phone' });
    }
    return respond(t(lang, 'askIDNumber'), 'ask_id_number');
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
    if (draft.otp_identifier) {
      await issueOtp(draft.otp_identifier, { channel: draft.otp_channel || 'phone' });
      return respond(draft.otp_channel === 'email' ? t(lang, 'otpSentEmail') : t(lang, 'otpSent'), 'verify_otp');
    }
    return respond(t(lang, 'askPhone'), 'ask_phone');
  }

  // PHONE
  if (step === 'ask_phone') {
    const cleanPhone = cleanBody.replace(/\s/g, '');
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) return respond(t(lang, 'invalidPhone'), 'ask_phone');
    await patchDraft(phone, { owner_phone: cleanPhone, lister_phone: cleanPhone, otp_identifier: cleanPhone, otp_channel: 'phone' });

    await issueOtp(cleanPhone, { channel: 'phone' });

    return respond(t(lang, 'otpSent'), 'verify_otp');
  }

  // VERIFY OTP
  if (step === 'verify_otp') {
    if (bodyUpper === 'RESEND') {
      const otpIdentifier = draft.otp_identifier || draft.owner_phone || draft.lister_email || phone;
      const otpChannel = draft.otp_channel === 'email' ? 'email' : 'phone';
      await issueOtp(otpIdentifier, { channel: otpChannel });
      return respond(otpChannel === 'email' ? t(lang, 'otpSentEmail') : t(lang, 'otpSent'), 'verify_otp');
    }

    const ownerPhone = draft.otp_identifier || draft.owner_phone || draft.lister_email || phone;
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
          lister_name, lister_phone, lister_email, lister_type, extra_fields,
          status, listed_via, source, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending','whatsapp','whatsapp',$17)
        RETURNING id`,
        [
          d.listing_type, d.title, d.description, d.district, d.area, d.price,
          d.deposit_amount || null, d.contract_months || null, d.bedrooms || null,
          d.nearest_university || null, d.distance_to_uni_km || null,
          d.lister_name || d.contact_display_name || null,
          d.owner_phone || d.lister_phone || null,
          d.lister_email || null,
          d.lister_type || 'owner',
          {
            contact_display_name: d.contact_display_name || d.lister_name || null,
            preferred_contact_channel: d.preferred_contact_channel || 'phone',
            whatsapp_listing_flow: true,
            verification_channel: d.otp_channel || 'phone',
            assisted_by_field_agent: d.assisted_by_field_agent === true,
            field_agent_reference: d.field_agent_reference || null
          },
          expiresAt
        ]
      );

      const propertyId = result.rows[0].id;
      const refCode = String(propertyId).substring(0, 8).toUpperCase();

      if (d.photos && d.photos.length) {
        const photos = d.photos.slice(0, 5);
        const labels = ['front/outside', 'sitting room/main room', 'bedroom', 'kitchen', 'bathroom'];
        const slots = ['front', 'sitting_room', 'bedroom', 'kitchen', 'bathroom'];
        for (let i = 0; i < photos.length; i += 1) {
          await db.query(
            'INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label) VALUES ($1, $2, $3, $4, $5, $6)',
            [propertyId, photos[i], i === 0, i, slots[i] || `extra_${i + 1}`, labels[i] || 'extra photo']
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
    return respond(welcomeMessage(lang, sessionData), 'main_menu');
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
  provider = 'whatsapp',
  metadata = {}
}) {
  const runtimeStartedAt = Date.now();
  logger.info(
    `WhatsApp message from ${phone}: "${String(body || '').substring(0, 50)}"${
      mediaUrl ? ' [media]' : ''
    }${sharedLocation ? ' [location]' : ''} [${provider}]`
  );

  const session = await getSession(phone);
  const sessionLang = session.language || 'en';
  const sessionStep = session.current_step || 'greeting';
  const conversationControl = await getWhatsappConversationControl(phone);
  const inboundMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  const contactName = cleanDisplayName(
    inboundMetadata.contact_name
    || inboundMetadata.contactName
    || inboundMetadata.display_name
    || inboundMetadata.displayName
    || inboundMetadata.profile_name
    || inboundMetadata.chat_title
  );

  if (contactName) {
    await patchSessionData(phone, { contact_name: contactName });
  }

  let effectiveBody = normalizeInput(body);
  let transcriptRecord = null;
  let voiceTranscriptionUnavailable = false;
  const normalizedMediaType = String(mediaType || '').toLowerCase();
  const isAudioNote = mediaUrl && (
    normalizedMediaType.startsWith('audio/')
    || normalizedMediaType === 'voice'
    || normalizedMediaType === 'audio'
    || normalizedMediaType.includes('opus')
    || normalizedMediaType.includes('ogg')
  );

  if (isAudioNote) {
    const providedTranscript = normalizeInput(
      inboundMetadata.transcript
      || inboundMetadata.voice_transcript
      || inboundMetadata.transcription
    );
    if (providedTranscript) {
      transcriptRecord = {
        text: providedTranscript,
        language: normalizeTranscriptionLanguage(
          inboundMetadata.transcript_language
          || inboundMetadata.voice_language
          || inboundMetadata.language
        ) || null,
        model: 'provided_voice_transcript'
      };
    } else {
      voiceTranscriptionUnavailable = !isLlmEnabled();
      const voiceDataUrl = normalizeInput(
        inboundMetadata.voice_audio_data_url
        || inboundMetadata.audio_data_url
        || inboundMetadata.media_data_url
      );
      const voiceMimeType = normalizeInput(
        inboundMetadata.voice_audio_mime_type
        || inboundMetadata.audio_mime_type
        || inboundMetadata.media_mime_type
        || normalizedMediaType
        || 'audio/ogg'
      );
      const transcriptionPromise = voiceTranscriptionUnavailable
        ? Promise.resolve(null)
        : voiceDataUrl
          ? transcribeAudioFromDataUrl(voiceDataUrl, voiceMimeType)
          : (String(mediaUrl || '').startsWith('whatsapp-web://')
            ? Promise.resolve(null)
            : transcribeAudioFromUrl(mediaUrl, normalizedMediaType || 'audio/ogg'));
      transcriptRecord = await withTimeout(
        transcriptionPromise.catch((error) => {
          logger.warn('WhatsApp voice transcription failed:', error.message || String(error));
          return null;
        }),
        Math.max(4000, Number(process.env.WHATSAPP_VOICE_TRANSCRIBE_TIMEOUT_MS || 12000)),
        null,
        'WhatsApp voice transcription'
      );
    }
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
      sharedLocation,
      metadata: inboundMetadata
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

  if (isAudioNote && !transcriptRecord?.text) {
    const voiceLang = sessionLang || 'en';
    await logIntent({
      userPhone: phone,
      waMessageId: inboundMessageId,
      detectedIntent: 'unknown',
      confidence: 0,
      language: voiceLang,
      currentStep: sessionStep,
      rawText: body || '[voice note]',
      transcript: null,
      entities: {
        media_type: normalizedMediaType || 'voice',
        reason: voiceTranscriptionUnavailable ? 'llm_provider_not_configured' : 'transcription_empty'
      },
      modelUsed: voiceTranscriptionUnavailable ? 'voice_transcription_provider_missing' : 'voice_transcription_unavailable'
    });
    return {
      message: t(voiceLang, voiceTranscriptionUnavailable ? 'voiceTranscriptionUnavailable' : 'voiceNotUnderstood'),
      nextStep: sessionStep
    };
  }

  const preliminaryLanguage = transcriptRecord?.text
    ? resolveVoiceDetectedLanguage(transcriptRecord, effectiveBody, sessionLang)
    : resolveDetectedLanguage({
      text: effectiveBody,
      sessionLang,
      intentResult: null
    });
  const aiLanguage = transcriptRecord?.text
    ? null
    : await detectWhatsappLanguage({
      text: effectiveBody,
      sessionLanguage: preliminaryLanguage.code || sessionLang,
      step: sessionStep
    });
  const classifierLanguageResult = mergeAiLanguageDetection(preliminaryLanguage, aiLanguage);
  const classifierLanguage = classifierLanguageResult.code || preliminaryLanguage.code || sessionLang;

  const intentResult = await classifyWhatsappIntent({
    text: effectiveBody,
    language: classifierLanguage,
    step: sessionStep,
    sessionData: session.session_data || {}
  });
  const baseDetectedLanguage = transcriptRecord?.text
    ? resolveVoiceDetectedLanguage(transcriptRecord, effectiveBody, sessionLang)
    : resolveDetectedLanguage({
      text: effectiveBody,
      sessionLang,
      intentResult
    });
  const detectedLanguage = transcriptRecord?.text
    ? baseDetectedLanguage
    : mergeAiLanguageDetection(baseDetectedLanguage, aiLanguage);
  const runtimeLang = detectedLanguage.code || sessionLang;
  const adoptDetectedLanguage = shouldAdoptDetectedLanguage({ sessionLang, sessionStep, detectedLanguage });
  const activeLang = adoptDetectedLanguage ? runtimeLang : sessionLang;
  if (adoptDetectedLanguage) {
    await updateSession(phone, { language: runtimeLang });
  }

  await logIntent({
    userPhone: phone,
    waMessageId: inboundMessageId,
    detectedIntent: intentResult.intent,
    confidence: intentResult.confidence,
    language: activeLang,
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
      preferredLanguage: activeLang,
      metadata: {
        last_intent: intentResult.intent || 'unknown',
        last_step: sessionStep,
        automation_paused: true,
        ...(contactName ? { display_name: contactName } : {})
      }
    });
    await syncWhatsappConversationState({
      phone,
      direction: 'inbound',
      intent: intentResult.intent,
      preferredLanguage: activeLang,
      currentStep: sessionStep,
      provider,
      messageType,
      metadata: {
        automation_paused: true,
        paused_reason: conversationControl?.status || conversationControl?.ai_mode || 'manual_review'
      }
    });

    const transcriptEcho = formatVoiceTranscriptEcho(activeLang, transcriptRecord?.text);
    return {
      message: [transcriptEcho, humanHandoffAck(activeLang)].filter(Boolean).join('\n\n'),
      nextStep: sessionStep
    };
  }

  let { message, nextStep } = await processMessage(
    phone,
    effectiveBody,
    mediaUrl,
    sharedLocation,
    {
      intent: intentResult,
      language: activeLang,
      mediaType: normalizedMediaType,
      mediaCount: Math.max(0, Math.min(10, Number(inboundMetadata.media_count || inboundMetadata.mediaCount || 0) || 0)),
      transcript: transcriptRecord?.text || null
    }
  );

  if (transcriptRecord?.text) {
    const transcriptEcho = formatVoiceTranscriptEcho(activeLang, transcriptRecord.text);
    if (transcriptEcho) message = `${transcriptEcho}\n\n${message}`;
  }

  const runtimeLatencyMs = Math.max(0, Date.now() - runtimeStartedAt);

  await updateSession(phone, { current_step: nextStep, current_intent: intentResult.intent || null });
  const refreshedSession = await getSession(phone);
  await upsertWhatsappUserProfile(phone, {
    preferredLanguage: refreshedSession.language || runtimeLang,
    metadata: {
      last_intent: intentResult.intent || 'unknown',
      last_step: nextStep,
      last_language_source: detectedLanguage.source || null,
      last_runtime_latency_ms: runtimeLatencyMs,
      ...(contactName ? { display_name: contactName } : {})
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
      last_inbound_message_id: inboundMessageId || null,
      runtime_latency_ms: runtimeLatencyMs,
      language_source: detectedLanguage.source || null,
      classifier_language: classifierLanguage,
      intent_model: intentResult.model || null
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
router.post('/web-bridge/inbound', asyncRoute(async (req, res) => {
  if (!isWhatsappWebBridgeAuthorized(req)) return bridgeUnauthorized(res);

  const phone = normalizeBridgeInboundKey(req.body.phone || req.body.chat_key || req.body.contact_key);
  const body = normalizeInput(req.body.body || req.body.text || '');
  let mediaUrl = normalizeInput(req.body.media_url || req.body.mediaUrl);
  const mediaType = normalizeInput(req.body.media_type || req.body.mediaType).toLowerCase();
  const mediaCount = Math.max(0, Math.min(10, Number(req.body.media_count || req.body.mediaCount || 0) || 0));
  const sharedLocation = parseInboundLocation(req.body.shared_location || req.body.location || req.body);
  const dryRun = ['1', 'true', 'yes'].includes(String(req.body.dry_run || req.body.dryRun || '').trim().toLowerCase());
  const inboundMetadata = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  const contactName = cleanDisplayName(req.body.contact_name || req.body.contactName || inboundMetadata.contact_name || inboundMetadata.contactName || inboundMetadata.chat_title);
  const inboundMessageId = createBridgeMessageId({
    phone,
    body,
    createdAt: req.body.created_at || req.body.timestamp || '',
    providerMessageId: req.body.message_id || req.body.provider_message_id || '',
    mediaType
  });
  const bridgeHasMedia = mediaType && mediaType !== 'text' && !mediaType.includes('location');
  if (!mediaUrl && bridgeHasMedia) {
    mediaUrl = `whatsapp-web://${inboundMessageId}`;
  }

  if (!phone) {
    return res.status(400).json({ ok: false, error: 'phone or chat_key is required' });
  }
  if (!body && !mediaUrl && !sharedLocation) {
    return res.status(400).json({ ok: false, error: 'body, media, or location is required' });
  }

  const runtimePhone = dryRun ? createBridgeDryRunKey(phone, req.body.dry_run_session || req.body.dryRunSession || req.body.client_id || '') : phone;
  const runtimeInboundMessageId = dryRun ? `${inboundMessageId}:dryrun:${runtimePhone.split(':').pop()}` : inboundMessageId;
  const runtimeMetadata = {
    ...inboundMetadata,
    media_count: mediaCount,
    ...(contactName && !dryRun ? { contact_name: contactName } : {})
  };

  const alreadySeen = await db.query(
    'SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1',
    [runtimeInboundMessageId]
  );
  if (alreadySeen.rows.length) {
    return res.json({ ok: true, duplicate: true, inbound_message_id: runtimeInboundMessageId });
  }

  if (req.body.client_id && !dryRun) {
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
        ...inboundMetadata,
        ...(contactName ? { contact_name: contactName } : {}),
        last_inbound_message_id: inboundMessageId
      }
    });
  }

  if (dryRun && inboundMetadata.force_idle_minutes) {
    const minutes = Math.max(0, Number(inboundMetadata.force_idle_minutes || 0));
    if (minutes > 0) {
      await db.query(
        "UPDATE whatsapp_sessions SET last_message_at = NOW() - ($2::text || ' minutes')::interval WHERE phone = $1",
        [runtimePhone, String(minutes)]
      );
    }
  }

  const { message, nextStep } = await processInboundRuntime({
    phone: runtimePhone,
    inboundMessageId: runtimeInboundMessageId,
    body,
    mediaUrl: mediaUrl || null,
    mediaType,
    sharedLocation,
    provider: 'web_bridge',
    metadata: runtimeMetadata
  });

  await captureLearningEvent({
    eventName: 'whatsapp_conversation_turn',
    source: 'whatsapp',
    channel: 'whatsapp',
    sessionId: runtimePhone,
    externalUserId: phone,
    language: runtimeMetadata.language || runtimeMetadata.detected_language || 'auto',
    inputText: body || `[${mediaType || (sharedLocation ? 'location' : 'message')}]`,
    responseText: message || '',
    entities: {
      phone,
      media_type: mediaType || null,
      has_media: !!mediaUrl,
      has_location: !!sharedLocation,
      next_step: nextStep || null
    },
    payload: {
      provider: 'web_bridge',
      dry_run: dryRun,
      media_count: mediaCount,
      metadata: runtimeMetadata
    },
    outcome: message ? 'responded' : 'received',
    dedupeKey: `whatsapp:${runtimeInboundMessageId}`
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
      inbound_message_id: runtimeInboundMessageId,
      next_step: nextStep,
      message,
      dry_run: dryRun,
      ...(dryRun ? { dry_run_session: runtimePhone } : {}),
      queued_reply: !!queuedReply,
      queue_id: queuedReply?.id || null
    }
  });
}));

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
