'use strict';

/**
 * The four films in Luganda and Swahili (14 Nov 2026).
 *
 * Each film has a Luganda and a Swahili twin, rendered from the same scenes
 * with the words on screen translated (scripts/films/lang). The chat inside
 * the film is left as it is: it is what the assistant really sends, and the
 * assistant answers agents in English.
 *
 * This file is where a staff member's "| Luganda" becomes a language, where
 * the twin's file name comes from, and where the message that travels with the
 * film is kept in those two languages. English is not here; it stays where it
 * always was, in routes/whatsapp.js, and nothing about it changes.
 */

const FILM_LANGUAGES = { lg: 'Luganda', sw: 'Swahili' };

const WORDS = {
  lg: ['lg', 'lug', 'luganda', 'oluganda', 'ganda', 'l'],
  sw: ['sw', 'swa', 'swahili', 'kiswahili', 'kiswa', 's'],
  en: ['en', 'eng', 'english', 'e']
};

/** 'lg', 'sw', 'en' for a word that names a language, '' for anything else. */
function languageWord(value = '') {
  const word = String(value || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (!word) return '';
  return Object.keys(WORDS).find((code) => WORDS[code].includes(word)) || '';
}

/** 'lg' or 'sw' when the film has a twin in that language, '' for English and everything else. */
function filmLanguage(value = '') {
  const code = String(value || '').trim().toLowerCase();
  if (FILM_LANGUAGES[code]) return code;
  const named = languageWord(value);
  return FILM_LANGUAGES[named] ? named : '';
}

function filmLanguageName(lang = '') {
  return FILM_LANGUAGES[filmLanguage(lang)] || 'English';
}

/** /assets/marketing/film-v5.mp4 → /assets/marketing/film-v5-lg.mp4 */
function filmPath(path = '', lang = '') {
  const code = filmLanguage(lang);
  return code ? String(path).replace(/\.mp4$/, `-${code}.mp4`) : String(path);
}

// What the film is, in one line. The same four keys as EXPLAINER_VIDEOS.
const CAPTIONS = {
  lg: {
    agent: '🎬 *makaug eri ba agenti* — by’ofuna, baani abalaba ebirango byo (Bannayuganda abali eka n’ebweru) n’engeri y’okwegattako.',
    owner: '🎬 *Otunda oba opangisa ennyumba yo oba ettaka lyo?* Vidiyo eno ennyimpi eraga engeri makaug gy’ekolamu eri bannannyini.',
    lister: ({ ownerFee }) => `🎬 *Engeri y’okulanga ennyumba yo oba ettaka ku makaug* — mutendera ku mutendera, eddakiika nga 5: ddamu ebibuuzo bitono, weereza ebifaananyi byo, kakasa nti ggwe era okkirize obukwakkulizo. Ttiimu yaffe ekikebera, n’ofuna linki nga kigenze ku mukutu. ${ownerFee} buli mwezi ku buli kirango — tukuweereza engeri y’okusasula, tewali ssente zikusalibwako ku bwazo.`,
    agent_howto: '🎬 *Engeri y’okuweereza ky’otunda ku makaug, wano wennyini ku WhatsApp* — ekintu kimu okuva ku ntandikwa okutuuka ku nkomerero, mu ddakiika nga emu.'
  },
  sw: {
    agent: '🎬 *makaug kwa mawakala* — unachopata, nani anaona matangazo yako (Waganda walio nyumbani na nje ya nchi) na jinsi ya kujiunga.',
    owner: '🎬 *Unauza au unapangisha mali yako mwenyewe?* Video hii fupi inaonyesha jinsi makaug inavyowafanyia kazi wamiliki.',
    lister: ({ ownerFee }) => `🎬 *Jinsi ya kutangaza mali yako kwenye makaug* — hatua kwa hatua, takriban dakika 5: jibu maswali machache mafupi, tuma picha zako, thibitisha ni wewe na ukubali masharti. Timu yetu inakagua, nawe unapata kiungo tangazo likienda hewani. ${ownerFee} kwa mwezi kwa kila mali — tunakutumia jinsi ya kulipa, hakuna kinachokatwa kiotomatiki.`,
    agent_howto: '🎬 *Jinsi ya kutuma mali kwenye makaug, hapa hapa kwenye WhatsApp* — mali moja mwanzo hadi mwisho, kwa takriban dakika moja.'
  }
};

// The whole message a staff member's send carries: greeting, caption, the points, the word to reply with.
// The words to reply with (AGENT, LIST, SHARE, STATUS, SOLD, HELP) stay as they are: they are what the assistant listens for.
const MESSAGES = {
  lg: {
    hello: (first) => (first ? `Oli otya ${first} 👋` : 'Oli otya 👋'),
    agent: () => [
      '• Oweereza butereevu ku WhatsApp: ebifaananyi n’obubaka bumu, ttiimu yaffe n’ekikebera, ne kigenda ku mukutu mu linnya lyo.',
      '• Buli abuuza ajja butereevu ku WhatsApp yo, n’erinnya lye n’ennamba ye. makaug teggyako komisoni.',
      '• Ofuna olupapula lwo olwa agenti, lipoota ya buli wiiki eraga abaalabye n’abaabuuzizza, ne Morning Brief buli lunaku ku ssaawa 1 ey’oku makya.',
      '• Ebirango biggulwawo mu Uganda n’abantu abali ebweru: Bungereza, Amerika, UAE, Canada, South Africa, Kenya n’awalala. Omukutu gukola mu nnimi 9, nga mw’otwalidde Oluganda n’Oluswayiri.',
      '',
      'Ddamu *AGENT* wano bw’oba oyagala okwegattako, tukuwandiise.'
    ],
    owner: ({ ownerFee }) => [
      '• *Abaguzi n’abapangisa bakubira ggwe butereevu.* Erinnya lyo n’ennamba yo biri ku kirango, era makaug teggyako komisoni.',
      '• *Eddakiika nga 5 ku WhatsApp.* Ebibuuzo bitono n’ebifaananyi byo. Ttiimu yaffe ekikebera, olwo ne kigenda ku mukutu.',
      '• Ebirango biggulwawo mu Uganda n’abantu abali ebweru, mu nnimi 9.',
      `• *${ownerFee} buli mwezi ku buli kirango*, okuva ku lunaku lwe kigenda ku mukutu. Tewali ssente zikusalibwako ku bwazo.`,
      '',
      'Ddamu *LIST* wano nkuyiseemu kati.'
    ],
    lister: () => ['Ddamu *LIST* wano okutandika.'],
    agent_howto: () => [
      'Oluvannyuma mpeereza ekisooka: ebifaananyi oba vidiyo ennyimpi, n’obubaka obugamba kye ki, ekitundu kyennyini n’omuwendo.',
      '',
      '*SHARE* ekuwa linki y’olupapula lwo ne kaadi yo. *STATUS* eraga ebirango byo we bituuse. *SOLD* eraga nti kitundiddwa. *HELP* ekufunira omuntu.'
    ]
  },
  sw: {
    hello: (first) => (first ? `Habari ${first} 👋` : 'Habari 👋'),
    agent: () => [
      '• Unatuma moja kwa moja kutoka WhatsApp: picha na maelezo kwenye ujumbe mmoja, timu yetu inakagua, kisha tangazo linaenda hewani kwa jina lako.',
      '• Kila ulizo linakuja moja kwa moja kwenye WhatsApp yako, likiwa na jina na namba ya mnunuzi. makaug haichukui kamisheni.',
      '• Unapata ukurasa wako wa wakala, ripoti ya kila wiki ya waliotazama na maulizo, na Morning Brief kila siku saa 1 asubuhi.',
      '• Matangazo hufunguliwa na watu walio Uganda na walio nje ya nchi: Uingereza, Marekani, UAE, Kanada, Afrika Kusini, Kenya na kwingineko. Tovuti inatumia lugha 9, zikiwemo Luganda na Kiswahili.',
      '',
      'Jibu *AGENT* hapa ukitaka kujiunga, nasi tutakuandikisha.'
    ],
    owner: ({ ownerFee }) => [
      '• *Wanunuzi na wapangaji wanakupigia wewe moja kwa moja.* Jina na namba yako viko kwenye tangazo, na makaug haichukui kamisheni.',
      '• *Takriban dakika 5 kwenye WhatsApp.* Maswali machache mafupi na picha zako. Timu yetu inakagua, kisha tangazo linaenda hewani.',
      '• Matangazo hufunguliwa na watu walio Uganda na walio nje ya nchi, kwa lugha 9.',
      `• *${ownerFee} kwa mwezi kwa kila mali*, kuanzia siku tangazo linapoenda hewani. Hakuna kinachokatwa kiotomatiki.`,
      '',
      'Jibu *LIST* hapa nami nitakuongoza sasa hivi.'
    ],
    lister: () => ['Jibu *LIST* hapa ili kuanza.'],
    agent_howto: () => [
      'Kisha nitumie ya kwanza: picha au video fupi, na maelezo yanayosema ni nini, eneo kamili na bei.',
      '',
      '*SHARE* inakupa kiungo cha ukurasa wako na kadi yako. *STATUS* inaonyesha mali zako zimefikia wapi. *SOLD* inaweka alama kuwa imeuzwa. *HELP* inakuletea mtu wa kukusaidia.'
    ]
  }
};

/** The film's one-line caption in Luganda or Swahili; '' when the language is English. */
function filmCaption(kind = '', lang = '', { ownerFee = 'UGX 20,000' } = {}) {
  const caption = CAPTIONS[filmLanguage(lang)]?.[kind];
  if (!caption) return '';
  return typeof caption === 'function' ? caption({ ownerFee }) : caption;
}

/**
 * The whole message that goes with a film a staff member sends, in Luganda or
 * Swahili. '' when the language is English, so the caller keeps its own words.
 * kind: agent · owner · lister · agent_howto
 */
function filmMessage(kind = '', lang = '', { first = '', ownerFee = 'UGX 20,000', greet = true } = {}) {
  const code = filmLanguage(lang);
  const words = MESSAGES[code];
  const caption = filmCaption(kind, code, { ownerFee });
  if (!words || !words[kind] || !caption) return '';
  // greet: false when the film follows a message that has already said hello (a new agent's welcome).
  const hello = greet === false ? [] : [words.hello(String(first || '').trim()), ''];
  return [...hello, caption, '', ...words[kind]({ ownerFee })].join('\n');
}

module.exports = {
  FILM_LANGUAGES,
  languageWord,
  filmLanguage,
  filmLanguageName,
  filmPath,
  filmCaption,
  filmMessage
};
