'use strict';

// Self-hosted how-to videos (silent, captions burned in, 720x1280 MP4).
//
// Off by default. Go-live is two steps:
//   1. upload <lang>/<slug>.mp4 and <lang>/<slug>.jpg to HOWTO_VIDEOS_BASE_URL
//      (default https://media.makaug.com/howto/v1)
//   2. set HOWTO_VIDEOS_ENABLED=true
// With the flag off, /config.js sends { enabled: false } and the home and
// About sections stay hidden and empty.

const HOWTO_LANGUAGES = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];

// Languages that have their own video files. Every other site language plays
// the English video.
const HOWTO_VIDEO_LANGUAGES = ['en', 'lg', 'sw', 'am', 'ar'];

// Machine-drafted captions and titles, not yet checked by a native speaker.
// Remove a code from this list once a reviewer has signed it off.
const HOWTO_DRAFT_LANGUAGES = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];

const DEFAULT_HOWTO_VIDEOS_BASE_URL = 'https://media.makaug.com/howto/v1';

const HOW_TO_GUIDES = [
  {
    slug: 'find-a-home', durationSeconds: 50, ctaUrl: '/for-sale',
    titles: {
      en: 'Find a home in under a minute',
      lg: 'Funa ennyumba mu dakiika emu',
      sw: 'Pata nyumba chini ya dakika moja',
      ac: 'Nong ot i dakika acel',
      ny: 'Shanga enju omu dakiika emwe',
      rn: 'Shanga enju omu dakiika emwe',
      sm: 'Noonia enyumba mu dakiika emu',
      am: 'በአንድ ደቂቃ ውስጥ ቤት ያግኙ',
      ar: 'اعثر على منزل في أقل من دقيقة'
    }
  },
  {
    slug: 'ask-ai', durationSeconds: 45, ctaUrl: '/for-sale',
    titles: {
      en: 'Ask AI in your own words',
      lg: 'Buuza AI mu bigambo byo',
      sw: 'Uliza AI kwa maneno yako',
      ac: 'Penj AI ki lok mamegi',
      ny: 'Buuza AI omu bigambo byawe',
      rn: 'Buuza AI omu bigambo byawe',
      sm: 'Buuza AI mu bigambo byo',
      am: 'AIን በራስዎ ቃላት ይጠይቁ',
      ar: 'اسأل الذكاء الاصطناعي بكلماتك'
    }
  },
  {
    slug: 'book-a-viewing', durationSeconds: 55, ctaUrl: '/to-rent',
    titles: {
      en: 'Contact an agent and book a viewing',
      lg: 'Tuukirira agent era osabe okulaba',
      sw: 'Wasiliana na wakala na upange kutembelea',
      ac: 'Kwan agent ka i ket nino me neno',
      ny: 'Teera agent kandi otegyeke okureeba',
      rn: 'Teera agent kandi otegyeke okureeba',
      sm: 'Tuukirira agent era osabe okulaba',
      am: 'ወኪል ያግኙ እና ጉብኝት ያስይዙ',
      ar: 'تواصل مع وكيل واحجز معاينة'
    }
  },
  {
    slug: 'list-your-property', durationSeconds: 60, ctaUrl: '/list-property',
    titles: {
      en: 'List your property',
      lg: 'Teeka ku mukutu ekintu kyo',
      sw: 'Weka mali yako',
      ac: 'Ket jami ni i makaug',
      ny: 'Teeka eby\'obugaiga byawe aha makaug',
      rn: 'Teeka eby\'obugaiga byawe aha makaug',
      sm: 'Teeka ekintu kyo ku makaug',
      am: 'ንብረትዎን ያስመዝግቡ',
      ar: 'أدرج عقارك'
    }
  },
  {
    slug: 'join-as-an-agent', durationSeconds: 50, ctaUrl: '/broker-signup',
    titles: {
      en: 'Join as an agent',
      lg: 'Yingira nga agent',
      sw: 'Jiunge kama wakala',
      ac: 'Bed agent',
      ny: 'Yegaite nka agent',
      rn: 'Yegaite nka agent',
      sm: 'Yingira nga agent',
      am: 'እንደ ወኪል ይቀላቀሉ',
      ar: 'انضم كوكيل'
    }
  },
  {
    slug: 'post-by-whatsapp', durationSeconds: 60, ctaUrl: '/list-property',
    titles: {
      en: 'Post a listing by WhatsApp',
      lg: 'Teeka ekintu ku WhatsApp',
      sw: 'Weka tangazo kwa WhatsApp',
      ac: 'Ket jami ki WhatsApp',
      ny: 'Teeka ekintu aha WhatsApp',
      rn: 'Teeka ekintu aha WhatsApp',
      sm: 'Teeka ekintu ku WhatsApp',
      am: 'በWhatsApp ማስታወቂያ ይለጥፉ',
      ar: 'انشر إعلانًا عبر واتساب'
    }
  },
  {
    slug: 'what-makaug-does', durationSeconds: 35, ctaUrl: '/about',
    titles: {
      en: 'What makaug.com does',
      lg: 'makaug.com ky\'ekola',
      sw: 'makaug.com inafanya nini',
      ac: 'Gin ma makaug.com tiyo',
      ny: 'Ebi makaug.com ekora',
      rn: 'Ebi makaug.com ekora',
      sm: 'makaug.com ky\'ekola',
      am: 'makaug.com ምን ይሰራል',
      ar: 'ماذا يقدّم makaug.com'
    }
  },
  {
    slug: 'language-and-currency', durationSeconds: 30, ctaUrl: '/',
    titles: {
      en: 'Change language and currency',
      lg: 'Kyusa olulimi ne ssente',
      sw: 'Badilisha lugha na sarafu',
      ac: 'Lok leb ki cente',
      ny: 'Hindura orurimi na sente',
      rn: 'Hindura orurimi na sente',
      sm: 'Kyusa olulimi ne sente',
      am: 'ቋንቋ እና ምንዛሬ ይቀይሩ',
      ar: 'غيّر اللغة والعملة'
    }
  },
  {
    slug: 'student-rooms', durationSeconds: 40, ctaUrl: '/student-accommodation',
    titles: {
      en: 'Find a room near your campus',
      lg: 'Funa ekisenge okumpi ne ssettendekero',
      sw: 'Pata chumba karibu na chuo chako',
      ac: 'Nong ot ma cok ki cukul ni',
      ny: 'Shanga ekisiika haihi n\'ettendekero ryawe',
      rn: 'Shanga ekisiika haihi n\'ettendekero ryawe',
      sm: 'Noonia ekisenge okumpi ne ssetendekero',
      am: 'ከካምፓስዎ አጠገብ ክፍል ያግኙ',
      ar: 'اعثر على غرفة قرب جامعتك'
    }
  },
  {
    slug: 'short-stays', durationSeconds: 50, ctaUrl: '/short-term',
    titles: {
      en: 'Short stays: book or list your place',
      lg: 'Okusula ebbanga ttono: kola booking oba teekayo ekifo kyo',
      sw: 'Makazi ya muda mfupi: weka nafasi au orodhesha',
      ac: 'Bedo pi kare manok: cik onyo ket kabedo ni',
      ny: 'Okuraara akaanya kakye: tegyeka nari teekaho ekifo kyawe',
      rn: 'Okuraara akaanya kakye: tegyeka nari teekaho ekifo kyawe',
      sm: 'Okusula ebbanga ettono: kola booking oba teekayo ekifo kyo',
      am: 'አጭር ቆይታ፦ ያስይዙ ወይም ቦታዎን ያስመዝግቡ',
      ar: 'الإقامات القصيرة: احجز أو أدرج مكانك'
    }
  },
  {
    slug: 'boost-a-listing', durationSeconds: 40, ctaUrl: '/advertise',
    titles: {
      en: 'Boost a listing',
      lg: 'Yongera okulabika kw\'ekintu kyo',
      sw: 'Kuza tangazo lako',
      ac: 'Mi jami ni kinen matek',
      ny: 'Yongyera okureebeka kw\'ekintu kyawe',
      rn: 'Yongyera okureebeka kw\'ekintu kyawe',
      sm: 'Yongera okulabika kw\'ekintu kyo',
      am: 'ማስታወቂያዎን ያሳድጉ',
      ar: 'عزّز إعلانك'
    }
  }
];

// Order of the About page row: start with what makaug.com does.
const ABOUT_GUIDE_ORDER = [
  'what-makaug-does', 'find-a-home', 'ask-ai', 'book-a-viewing', 'list-your-property',
  'post-by-whatsapp', 'join-as-an-agent', 'student-rooms', 'short-stays',
  'boost-a-listing', 'language-and-currency'
];

const HOWTO_SECTION_COPY = {
  en: { eyebrow: 'How-to videos', title: 'See how makaug.com works', sub: 'Short guides recorded on the real site. Silent, with captions. Tap a video to play.', draft: 'Draft translation', englishCaptions: 'Captions in English', seconds: 's', prev: 'Previous videos', next: 'More videos' },
  lg: { eyebrow: 'Vidiyo ez\'okuyiga', title: 'Laba makaug.com bw\'ekola', sub: 'Vidiyo ennyimpi ezaakwatibwa ku mukutu gwennyini. Tezirina ddoboozi, zirina ebigambo. Nyiga vidiyo okugizannya.', draft: 'Okuvvuunula okusooka', englishCaptions: 'Ebigambo mu Lungereza', seconds: 's', prev: 'Vidiyo ezaayita', next: 'Vidiyo endala' },
  sw: { eyebrow: 'Video za maelekezo', title: 'Ona jinsi makaug.com inavyofanya kazi', sub: 'Mafunzo mafupi yaliyorekodiwa kwenye tovuti halisi. Bila sauti, yana maandishi. Gusa video ili kucheza.', draft: 'Tafsiri ya awali', englishCaptions: 'Maandishi kwa Kiingereza', seconds: 's', prev: 'Video zilizopita', next: 'Video zaidi' },
  ac: { eyebrow: 'Video me pwonye', title: 'Nen kit ma makaug.com tiyo kwede', sub: 'Video macek ma kimako i kakube kikome. Pe gitye ki dwan, gitye ki coc. Dii video me nyuto.', draft: 'Lok ma pud pe kiroto', englishCaptions: 'Coc i leb Muno', seconds: 's', prev: 'Video ma okato', next: 'Video mukene' },
  ny: { eyebrow: 'Vidiyo z\'okwega', title: 'Reeba oku makaug.com ekora', sub: 'Vidiyo ennyiimpi ezikwatsirwe aha mukura gwa makaug. Tizirikugamba, ziine ebihandiikirwe. Kanda aha vidiyo okugireeba.', draft: 'Okuhindura kw\'okubanza', englishCaptions: 'Ebihandiikirwe omu Rungyereza', seconds: 's', prev: 'Vidiyo ezahingwire', next: 'Vidiyo ezindi' },
  rn: { eyebrow: 'Vidiyo z\'okwega', title: 'Reeba oku makaug.com ekora', sub: 'Vidiyo ennyiimpi ezikwatsirwe aha mukura gwa makaug. Tizirikugamba, ziine ebihandiikirwe. Kanda aha vidiyo okugireeba.', draft: 'Okuhindura kw\'okubanza', englishCaptions: 'Ebihandiikirwe omu Rungyereza', seconds: 's', prev: 'Vidiyo ezahingwire', next: 'Vidiyo ezindi' },
  sm: { eyebrow: 'Vidiyo ez\'okuyiga', title: 'Bona makaug.com bw\'ekola', sub: 'Vidiyo entono ezaakwatibwa ku mukutu gwennyini. Tezirina ddoboozi, zirina ebigambo. Nyiga vidiyo okugizannya.', draft: 'Okuvvuunula okusooka', englishCaptions: 'Ebigambo mu Lungereza', seconds: 's', prev: 'Vidiyo ezaayita', next: 'Vidiyo endala' },
  am: { eyebrow: 'የአጠቃቀም ቪዲዮዎች', title: 'makaug.com እንዴት እንደሚሰራ ይመልከቱ', sub: 'በእውነተኛው ድረ-ገጽ ላይ የተቀረጹ አጫጭር መመሪያዎች። ድምፅ የላቸውም፣ ጽሑፍ አላቸው። ለማጫወት ቪዲዮ ይንኩ።', draft: 'ረቂቅ ትርጉም', englishCaptions: 'ጽሑፍ በእንግሊዝኛ', seconds: 'ሰ', prev: 'ቀዳሚ ቪዲዮዎች', next: 'ተጨማሪ ቪዲዮዎች' },
  ar: { eyebrow: 'فيديوهات إرشادية', title: 'شاهد كيف يعمل makaug.com', sub: 'أدلة قصيرة مسجلة على الموقع الحقيقي. بدون صوت، مع ترجمة مكتوبة. اضغط على الفيديو لتشغيله.', draft: 'ترجمة أولية', englishCaptions: 'الترجمة بالإنجليزية', seconds: 'ث', prev: 'الفيديوهات السابقة', next: 'المزيد من الفيديوهات' }
};

function flagOn(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function cleanBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_HOWTO_VIDEOS_BASE_URL;
  if (/^https:\/\//i.test(raw) || raw.startsWith('/')) return raw;
  return DEFAULT_HOWTO_VIDEOS_BASE_URL;
}

// What /config.js sends to browsers. Nothing but { enabled: false } while off.
function publicHowToVideosConfig(env = process.env, { localBaseUrl = '' } = {}) {
  if (!flagOn(env.HOWTO_VIDEOS_ENABLED)) return { enabled: false };
  return {
    enabled: true,
    version: 'v1',
    baseUrl: localBaseUrl || cleanBaseUrl(env.HOWTO_VIDEOS_BASE_URL),
    languages: HOWTO_LANGUAGES,
    videoLanguages: HOWTO_VIDEO_LANGUAGES,
    draftLanguages: HOWTO_DRAFT_LANGUAGES,
    guides: HOW_TO_GUIDES,
    aboutOrder: ABOUT_GUIDE_ORDER,
    copy: HOWTO_SECTION_COPY
  };
}

module.exports = {
  HOWTO_LANGUAGES,
  HOWTO_VIDEO_LANGUAGES,
  HOWTO_DRAFT_LANGUAGES,
  DEFAULT_HOWTO_VIDEOS_BASE_URL,
  HOW_TO_GUIDES,
  ABOUT_GUIDE_ORDER,
  HOWTO_SECTION_COPY,
  publicHowToVideosConfig
};
