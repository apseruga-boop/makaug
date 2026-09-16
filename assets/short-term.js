/* makaug Short Term stays - client app
 *
 * Loads after assets/makaug-app.js, the same way assets/off-plan.js does.
 * Everything it touches lives inside #page-short-term.
 *
 * The model this code enforces, everywhere: makaug is a DISCOVERY platform.
 * We show the place and the host's own phone number. We do not take bookings,
 * we do not hold money, and we never tell a guest whether a host replied.
 */
(function () {
  'use strict';

  if (window.__makaugShortTermLoaded) return;

  // The server injects window.__makaugShortTerm into every public page when
  // SHORT_TERM_ENABLED is on. No config means the section is dark, so this
  // script does nothing at all: no requests, no DOM changes, no nav entries.
  if (!window.__makaugShortTerm || window.__makaugShortTerm.enabled !== true) return;

  window.__makaugShortTermLoaded = true;

  var API = '/api/short-term';
  var ROOT_ID = 'page-short-term';
  var state = {
    meta: null,
    listings: [],
    total: 0,
    map: null,
    infoWindow: null,
    markers: [],
    mapOn: false,
    rating: 0,
    wizardStep: 1,
    windows: [{ starts_on: '', ends_on: '' }],
    // Set once the listing exists. Photos are attached after submission, not
    // before: that is the only point at which there is a listing to attach
    // them to, and it means a host on a bad connection has already saved the
    // hard part before they start uploading megabytes.
    listingId: null,
    uploadToken: null,
    photos: []
  };

  // ---------------------------------------------------------------- helpers

  function root() { return document.getElementById(ROOT_ID); }

  // -------------------------------------------------------------- language
  // The section reads in all nine languages the site offers, not just its nav
  // item. The bundle keeps the current language in a top-level `currentLang`
  // (reachable by name from another classic script, never off window) and also
  // writes it to <html lang>, which is the more reliable of the two.
  //
  // CONFIDENCE: en, sw, am and ar are solid. lg, ac, ny, rn and sm are best
  // effort in the loanword style this site already uses, and want a native
  // speaker before anyone leans on them.
  var ST_I18N = {
  "ac": {
    "adCtaFind": "Yeny kabedo",
    "adHeadline": "Uganda tye ka gamo welo. Ot rwatte oyot.",
    "adSub": "Kampala, Entebbe ki Jinja pong con ma peya tuko ocake.",
    "checkIn": "Donyo iye",
    "checkOut": "Kato woko",
    "countNote": "Kabedo me nino manok kikwano i wel ducu me makaug.",
    "days": "nino",
    "emptyFilters": "Pe tye gin mo marwate ki magi. Tem yaro nino onyo kabedo.",
    "emptyNone": "Pe tye kabedo me nino manok ma kityeko kete. Ka itye ki kabedo i Uganda ma ipangisa i nino acel acel, kete i makaug.",
    "guests": "Welo",
    "heroSub": "Apartments, cottages ki guest houses ma itwero gamo i nino acel acel. Listing acel acel tye ki namba me cim pa won kabedo, wek itii kwede atir.",
    "heroTitle": "Yeny kabedo me nino manok i Uganda",
    "hideMap": "Kan map",
    "hrs": "cawa",
    "kickOff": "Tuko cake",
    "listOwn": "Ket kabedo mamegi",
    "listPlace": "Ket kabedo mamegi",
    "loading": "Tye ka yeny…",
    "mapFail": "Map pe otwero cako. Lok ma piny nyuto kabedo ducu.",
    "maxNight": "Wel madit i nino acel",
    "min": "dakika",
    "newListing": "Manyen",
    "perNight": "i nino acel",
    "search": "Yeny",
    "sec": "cekon",
    "showMap": "Nyut map",
    "sortHigh": "Wel: malo wa piny",
    "sortLow": "Wel: piny wa malo",
    "sortNewest": "Manyen mukwongo",
    "sortRated": "Ma gimito loyo",
    "stays": "kabedo me nino manok",
    "where": "Kany",
    "wherePh": "Kampala, Entebbe, Jinja…"
  },
  "am": {
    "adCtaFind": "ማረፊያ ይፍልጉ",
    "adHeadline": "ዩጋንዳ ታስተናግዳለች። ክፍሎች በፍጥነት ይዮዛሉ።",
    "adSub": "ካምፓላ፣ እንቴቤ እና ጁንጃ ጨዋታው ከመጀመሩ በፊት ይሞላሉ።",
    "checkIn": "መግባቨያ",
    "checkOut": "መውኘያ",
    "countNote": "የአጭር ጊዜ ማረፊያዎች በmakaug አጠቃላይ ንብረት ውስጥ ይቀጠራሉ።",
    "days": "ቀናት",
    "emptyFilters": "ከእነዚህ ማጣሪያዎች ጋር የሚያይ የለም። ቀኑን ወይም አካባቢውን ያስፋሉ።",
    "emptyNone": "ዘንዱ የታተመ የአጭር ጊዜ ማረፊያ የለም። በዩጋንዳ በአንድ ሌሊት የሚያከሯዩት ቤት ካለዎት፣ በmakaug ይመዘግቡ።",
    "guests": "እንግዶች",
    "heroSub": "በይት እያንዳንዱ መክረየት የሚይዙ አፕርታሞች፣ ጎጀውች እና እንግዳ ማረፊያዎች። የእያንዳንዱ ምዝገባ የአስተናጋጅውን ስልክ ይዘል፣ ስለዚህ በቀጥታ ይነጋገሩ።",
    "heroTitle": "በዩጋንዳ የአጭር ጊዜ ማረፊያ ይፍልጉ",
    "hideMap": "ካርታ ደብቅ",
    "hrs": "ሰዓት",
    "kickOff": "ጨዋታው ይጀምራል",
    "listOwn": "ቤትዎን ይመይበቡ",
    "listPlace": "ቤትዎን ይመይበቡ",
    "loading": "እየጠነተነ ነው…",
    "mapFail": "ካርታው ሊጫን አልቻለም። ከታች ያለው ዝርዝር ሁሉንም ቤት ያሳያል።",
    "maxNight": "በአንድ ሌሊት በከፍተኛ",
    "min": "ደቂቃ",
    "newListing": "አዲስ",
    "perNight": "በአንድ ሌሊት",
    "search": "ፍልግ",
    "sec": "ሰከንድ",
    "showMap": "ካርታ አሳይ",
    "sortHigh": "ዋጋ፡ ክፍተኛ ወደ ዝትተኛ",
    "sortLow": "ዋጋ፡ ክዝትተኛ ወደ ክፍተኛ",
    "sortNewest": "አዲስ ቀድሞ",
    "sortRated": "በተሻል የተገመገሙ",
    "stays": "የአጭር ጊዜ ማረፊያዎች",
    "where": "በደት",
    "wherePh": "Kampala, Entebbe, Jinja…"
  },
  "ar": {
    "adCtaFind": "ابحث عن إقامة",
    "adHeadline": "أوغندا تستضيف. الغرف تنفد مبكراً.",
    "adSub": "كمبالا وإنتيبي وجينجا تمتلئ قبل انطلاق البطولة بوقت طويل.",
    "checkIn": "تاريخ الوصول",
    "checkOut": "تاريخ المغادرة",
    "countNote": "تُحتسب الإقامات القصيرة ضمن إجمالي عقارات makaug.",
    "days": "يوم",
    "emptyFilters": "لا يوجد ما يطابق هذه الفلاتر بعد. جرّب توسيع التواريخ أو المنطقة.",
    "emptyNone": "لم يُنشر أي مكان للإقامة القصيرة بعد. إذا كان لديك مكان في أوغندا تؤجّره بالليلة، أضفه على makaug.",
    "guests": "الضيوف",
    "heroSub": "شقق وبيوت ريفية وبيوت ضيافة يمكنك حجزها بالليلة، وكل إعلان يحمل رقم هاتف المضيف نفسه لتتعامل معه مباشرة.",
    "heroTitle": "ابحث عن إقامة قصيرة في أوغندا",
    "hideMap": "إخفاء الخريطة",
    "hrs": "ساعة",
    "kickOff": "انطلاق البطولة",
    "listOwn": "أضف مكانك",
    "listPlace": "أضف مكانك",
    "loading": "جارٍ التحميل…",
    "mapFail": "تعذّر تحميل الخريطة. القائمة أدناه تعرض كل الأماكن.",
    "maxNight": "أقصى سعر لليلة",
    "min": "دقيقة",
    "newListing": "جديد",
    "perNight": "لليلة",
    "search": "بحث",
    "sec": "ثانية",
    "showMap": "إظهار الخريطة",
    "sortHigh": "السعر: من الأعلى للأقل",
    "sortLow": "السعر: من الأقل للأعلى",
    "sortNewest": "الأحدث أولاً",
    "sortRated": "الأفضل تقييماً",
    "stays": "إقامات قصيرة",
    "where": "أين",
    "wherePh": "Kampala, Entebbe, Jinja…"
  },
  "en": {
    "adCtaFind": "Find a stay",
    "adHeadline": "Uganda hosts. Rooms go early.",
    "adSub": "Kampala, Entebbe and Jinja fill up long before kick-off.",
    "checkIn": "Check in",
    "checkOut": "Check out",
    "countNote": "Short stays are counted in the makaug property total.",
    "days": "days",
    "emptyFilters": "Nothing matches those filters yet. Try widening the dates or the area.",
    "emptyNone": "No short stays are published yet. If you have a place in Uganda that you rent by the night, list it on makaug.",
    "guests": "Guests",
    "heroSub": "Apartments, cottages and guest houses you can take by the night. Every listing carries the host's own phone number, so you deal with them directly.",
    "heroTitle": "Find a short stay in Uganda",
    "hideMap": "Hide map",
    "hrs": "hrs",
    "kickOff": "Kick-off",
    "listOwn": "List your own place",
    "listPlace": "List your place",
    "loading": "Loading short stays…",
    "mapFail": "The map could not load. The list below shows every place.",
    "maxNight": "Max per night",
    "min": "min",
    "newListing": "New listing",
    "perNight": "per night",
    "search": "Search",
    "sec": "sec",
    "showMap": "Show map",
    "sortHigh": "Price: high to low",
    "sortLow": "Price: low to high",
    "sortNewest": "Newest first",
    "sortRated": "Best reviewed",
    "stays": "short stays",
    "where": "Where",
    "wherePh": "Kampala, Entebbe, Jinja…"
  },
  "lg": {
    "adCtaFind": "Noonya we onoosula",
    "adHeadline": "Uganda y'eyakuŋŋaanyiza. Ebifo biggwaawo mangu.",
    "adSub": "Kampala, Entebbe ne Jinja zijjula nga tekinnatuuka.",
    "checkIn": "Lw'oyingira",
    "checkOut": "Lw'ofuluma",
    "countNote": "Ebifo eby'okusula bibalirwa mu muwendo gwa makaug ogw'ebintu byonna.",
    "days": "ennaku",
    "emptyFilters": "Tewali kituukagana na filters zino. Gezaako okugaziya ennaku oba ekitundu.",
    "emptyNone": "Tewannabaawo bifo bya kusula bifulumiziddwa. Bw'oba olina ekifo mu Uganda ky'opangisa buli kiro, kiteeke ku makaug.",
    "guests": "Abagenyi",
    "heroSub": "Apartments, cottages ne guest houses z'oyinza okupangisa buli kiro. Buli listing erina namba ya ssimu ya nnyini kifo, okolagane naye butereevu.",
    "heroTitle": "Noonya we onoosula mu Uganda",
    "hideMap": "Kweka maapu",
    "hrs": "essaawa",
    "kickOff": "Omuzannyo gutandika",
    "listOwn": "Teeka ekifo kyo",
    "listPlace": "Teeka ekifo kyo",
    "loading": "Tunoonya…",
    "mapFail": "Maapu tezikoze. Olukalala wansi lulaga ebifo byonna.",
    "maxNight": "Ssente ku kiro",
    "min": "eddakiika",
    "newListing": "Empya",
    "perNight": "buli kiro",
    "search": "Noonya",
    "sec": "obutikitiki",
    "showMap": "Laga maapu",
    "sortHigh": "Ssente: okuva waggulu",
    "sortLow": "Ssente: okuva wansi",
    "sortNewest": "Empya sooka",
    "sortRated": "Ezisiimibwa ennyo",
    "stays": "ebifo eby'okusula",
    "where": "Wa",
    "wherePh": "Kampala, Entebbe, Jinja…"
  },
  "ny": {
    "adCtaFind": "Sherura ekyanya",
    "adHeadline": "Uganda niyo erikwakiira. Ebyanya nibihwaho juba.",
    "adSub": "Kampala, Entebbe na Jinja nibijura obutakaba omuzaano gutandika.",
    "checkIn": "Okutaaha",
    "checkOut": "Okuruga",
    "countNote": "Ebyanya by'okuraara nibibariirwa omu muhendo gwa makaug gwona.",
    "days": "ebiro",
    "emptyFilters": "Tihariho ekirikuhikaana n'ebi. Gyezaho kwongyera ebiro nari ekicweka.",
    "emptyNone": "Tihariho byanya by'okuraara ebitairwe. Ku oine ekyanya omu Uganda eki orikupangisa buri kiro, kite aha makaug.",
    "guests": "Abashuhuki",
    "heroSub": "Apartments, cottages na guest houses ez'orikubaasa kutwara buri kiro. Buri listing eine namba ya esimu ya nyineeka, orikukora nawe butunguuka.",
    "heroTitle": "Sherura ekyanya ky'okuraara omu Uganda",
    "hideMap": "Shereka mapu",
    "hrs": "eshaaha",
    "kickOff": "Omuzaano nigutandika",
    "listOwn": "Ta ekyanya kyawe",
    "listPlace": "Ta ekyanya kyawe",
    "loading": "Nitusherura…",
    "mapFail": "Mapu tiyabaasa kwija. Orutindo rw'ahansi nirworeka ebyanya byona.",
    "maxNight": "Esente aha kiro",
    "min": "edakiika",
    "newListing": "Ensya",
    "perNight": "aha kiro",
    "search": "Sherura",
    "sec": "obucweka",
    "showMap": "Yoreka mapu",
    "sortHigh": "Esente: haiguru kuza ahansi",
    "sortLow": "Esente: ahansi kuza haiguru",
    "sortNewest": "Ensya z'okubanza",
    "sortRated": "Ezirikukundwa munonga",
    "stays": "ebyanya by'okuraara",
    "where": "Nkahi",
    "wherePh": "Kampala, Entebbe, Jinja…"
  },
  "rn": {
    "adCtaFind": "Sherura ahantu",
    "adHeadline": "Uganda niyo erikwakiira. Ahantu nihahwaho juba.",
    "adSub": "Kampala, Entebbe na Jinja nibijura obutakaba omuzaano gutandika.",
    "checkIn": "Okutaaha",
    "checkOut": "Okuruga",
    "countNote": "Ahantu h'okuraara nihabariirwa omu muhendo gwa makaug gwona.",
    "days": "ebiro",
    "emptyFilters": "Tihariho ekirikuhikaana n'ebi. Gyezaho kwongyera ebiro nari ekicweka.",
    "emptyNone": "Tihariho hantu h'okuraara hataairwe. Ku oine ahantu omu Uganda ho orikupangisa buri kiro, hate aha makaug.",
    "guests": "Abagyenyi",
    "heroSub": "Apartments, cottages na guest houses ezi orikubaasa kutwara buri kiro. Buri listing eine namba ya esimu ya nyineeka, okore nawe butunguuka.",
    "heroTitle": "Sherura ahantu h'okuraara omu Uganda",
    "hideMap": "Shereka mapu",
    "hrs": "eshaaha",
    "kickOff": "Omuzaano nigutandika",
    "listOwn": "Ta ahantu hawe",
    "listPlace": "Ta ahantu hawe",
    "loading": "Nitusherura…",
    "mapFail": "Mapu tiyabaasa kwija. Orutindo rw'ahansi nirworeka ahantu hoona.",
    "maxNight": "Esente aha kiro",
    "min": "edakiika",
    "newListing": "Ensya",
    "perNight": "aha kiro",
    "search": "Sherura",
    "sec": "obucweka",
    "showMap": "Yoreka mapu",
    "sortHigh": "Esente: haiguru kuza ahansi",
    "sortLow": "Esente: ahansi kuza haiguru",
    "sortNewest": "Ensya z'okubanza",
    "sortRated": "Ezirikukundwa munonga",
    "stays": "ahantu h'okuraara",
    "where": "Nkahi",
    "wherePh": "Kampala, Entebbe, Jinja…"
  },
  "sm": {
    "adCtaFind": "Noonya ekifo",
    "adHeadline": "Uganda y'eyakuŋŋaanyiza. Ebifo biggwaawo mangu.",
    "adSub": "Kampala, Entebbe ni Jinja zijjula nga tekinnatuuka.",
    "checkIn": "Lw'oyingira",
    "checkOut": "Lw'ofuluma",
    "countNote": "Ebifo eby'okusula bibalirwa mu muwendo gwa makaug ogw'ebintu byonna.",
    "days": "ennaku",
    "emptyFilters": "Tewali kituukagana n'ebyo. Gezaako okugaziya ennaku oba ekitundu.",
    "emptyNone": "Tewannabaawo bifo bya kusula bifulumiziddwa. Bw'oba olina ekifo mu Uganda ky'opangisa buli kiro, kiteeke ku makaug.",
    "guests": "Abagenyi",
    "heroSub": "Apartments, cottages ni guest houses ez'osobola okutwala buli kiro. Buli listing erina namba y'essimu ya nnyini kifo, okolagane naye butereevu.",
    "heroTitle": "Noonya aw'okusula mu Uganda",
    "hideMap": "Kweka maapu",
    "hrs": "essaawa",
    "kickOff": "Omuzannyo gutandika",
    "listOwn": "Teeka ekifo kyo",
    "listPlace": "Teeka ekifo kyo",
    "loading": "Tunoonya…",
    "mapFail": "Maapu tezikoze. Olukalala wansi lulaga ebifo byonna.",
    "maxNight": "Ssente ku kiro",
    "min": "eddakiika",
    "newListing": "Empya",
    "perNight": "buli kiro",
    "search": "Noonya",
    "sec": "obutikitiki",
    "showMap": "Laga maapu",
    "sortHigh": "Ssente: okuva waigulu",
    "sortLow": "Ssente: okuva wansi",
    "sortNewest": "Empya zisoke",
    "sortRated": "Ezisiimibwa eno",
    "stays": "ebifo eby'okusula",
    "where": "Hai",
    "wherePh": "Kampala, Entebbe, Jinja…"
  },
  "sw": {
    "adCtaFind": "Tafuta malazi",
    "adHeadline": "Uganda inakaribisha. Vyumba vinaisha mapema.",
    "adSub": "Kampala, Entebbe na Jinja hujaa muda mrefu kabla ya mechi.",
    "checkIn": "Kuingia",
    "checkOut": "Kutoka",
    "countNote": "Malazi ya muda yanahesabiwa katika jumla ya mali za makaug.",
    "days": "siku",
    "emptyFilters": "Hakuna kinacholingana na vichujio hivi. Jaribu kupanua tarehe au eneo.",
    "emptyNone": "Hakuna malazi ya muda yaliyochapishwa bado. Kama una mahali Uganda unapopangisha kwa usiku, liweke kwenye makaug.",
    "guests": "Wageni",
    "heroSub": "Apartments, cottages na guest houses unazoweza kuchukua kwa usiku. Kila tangazo lina namba ya simu ya mwenyeji, hivyo unashughulika naye moja kwa moja.",
    "heroTitle": "Tafuta malazi ya muda Uganda",
    "hideMap": "Ficha ramani",
    "hrs": "saa",
    "kickOff": "Mchezo unaanza",
    "listOwn": "Weka mahali pako",
    "listPlace": "Weka mahali pako",
    "loading": "Inapakia malazi…",
    "mapFail": "Ramani haikupakia. Orodha hapa chini inaonyesha kila mahali.",
    "maxNight": "Kiwango kwa usiku",
    "min": "dakika",
    "newListing": "Mpya",
    "perNight": "kwa usiku",
    "search": "Tafuta",
    "sec": "sekunde",
    "showMap": "Onyesha ramani",
    "sortHigh": "Bei: juu kwenda chini",
    "sortLow": "Bei: chini kwenda juu",
    "sortNewest": "Mpya kwanza",
    "sortRated": "Zilizopendwa zaidi",
    "stays": "malazi ya muda",
    "where": "Wapi",
    "wherePh": "Kampala, Entebbe, Jinja…"
  }
};

  function stLang() {
    var code = '';
    try { code = document.documentElement.getAttribute('lang') || ''; } catch (_error) {}
    if (!code) {
      try { code = (typeof currentLang !== 'undefined' && currentLang) || ''; } catch (_error) {}
    }
    code = String(code || 'en').toLowerCase().split('-')[0];
    return ST_I18N[code] ? code : 'en';
  }

  function t(key) {
    var table = ST_I18N[stLang()] || ST_I18N.en;
    var value = table[key];
    if (value === undefined) value = ST_I18N.en[key];
    return value === undefined ? '' : value;
  }

  // Re-render when the language changes. <html lang> is set by setLang() on
  // every switch, so watching it needs no hook into the bundle.
  try {
    if (window.MutationObserver) {
      var lastLang = stLang();
      new window.MutationObserver(function () {
        var now = stLang();
        if (now === lastLang) return;
        lastLang = now;
        try { repaintCurrentView(); } catch (_error) {}
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }
  } catch (_error) {}


  function $(sel) { var r = root(); return r ? r.querySelector(sel) : null; }
  function $$(sel) { var r = root(); return r ? Array.prototype.slice.call(r.querySelectorAll(sel)) : []; }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ugx(amount) {
    var n = Number(amount || 0);
    if (!isFinite(n)) return 'UGX 0';
    return 'UGX ' + Math.round(n).toLocaleString('en-UG');
  }

  function api(path, options) {
    var opts = options || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ Accept: 'application/json' }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok || payload.ok === false) {
          var err = new Error(payload.error || 'Something went wrong');
          err.details = payload.details || [];
          err.status = res.status;
          throw err;
        }
        return payload;
      });
    });
  }

  function currentPath() {
    return (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  }

  function qs() {
    var out = {};
    new URLSearchParams(window.location.search || '').forEach(function (v, k) { out[k] = v; });
    return out;
  }

  function go(path, replace) {
    if (window.history && window.history.pushState) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
      route();
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      window.location.href = path;
    }
  }

  function stars(rating) {
    var full = Math.round(Number(rating) || 0);
    var out = '';
    for (var i = 1; i <= 5; i += 1) out += i <= full ? '★' : '☆';
    return out;
  }

  function todayIso(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }

  // ------------------------------------------------------------ google maps
  // This used OpenStreetMap tiles and they were being refused outright - 403,
  // "App is not following the tile usage policy of OpenStreetMap's
  // volunteer-run servers" - so every tile came back as an error image. Their
  // tile servers are a volunteer service and a commercial marketplace pulling
  // from them is what that policy exists to stop.
  //
  // Google Maps is already configured on this site (window.MAKAUG_CONFIG) and
  // the bundle already has a loader, so this waits for that rather than
  // injecting a second Maps script that would race it.
  function loadGoogleMaps(attempt) {
    if (window.google && window.google.maps) return Promise.resolve(true);
    if (typeof window.ensureGoogleMapsApi === 'function') {
      return window.ensureGoogleMapsApi().then(function (ok) {
        return !!(ok && window.google && window.google.maps);
      });
    }
    // The bundle may not be in yet; this file loads in parallel with it.
    var tries = (attempt || 0) + 1;
    if (tries > 40) return Promise.resolve(false);
    return new Promise(function (resolve) {
      window.setTimeout(function () { resolve(loadGoogleMaps(tries)); }, 250);
    });
  }

  function priceLabel(listing) {
    var n = Number(listing.price_per_night || 0);
    if (!isFinite(n) || n <= 0) return '';
    if (n >= 1000000) return Math.round(n / 100000) / 10 + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return String(n);
  }

  function paintMap() {
    var host = document.getElementById('st-map');
    if (!host) return;
    loadGoogleMaps().then(function (ok) {
      if (!ok) {
        host.innerHTML = '<div class="st-empty"><i class="fas fa-map"></i>' + esc(t('mapFail')) + '</div>';
        return;
      }
      var g = window.google.maps;

      if (!state.map) {
        state.map = new g.Map(host, {
          center: { lat: 0.3476, lng: 32.5825 },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          scrollwheel: false,
          gestureHandling: 'cooperative'
        });
        state.infoWindow = new g.InfoWindow();
      }

      (state.markers || []).forEach(function (m) { m.setMap(null); });
      state.markers = [];

      var placed = (state.listings || []).filter(function (l) {
        return l && isFinite(Number(l.latitude)) && isFinite(Number(l.longitude));
      });

      if (!placed.length) {
        // Nothing to pin yet, so show the country rather than an empty grey square.
        state.map.setCenter({ lat: 1.3733, lng: 32.2903 });
        state.map.setZoom(7);
        return;
      }

      var bounds = new g.LatLngBounds();
      placed.forEach(function (listing) {
        var position = { lat: Number(listing.latitude), lng: Number(listing.longitude) };
        // The price IS the pin. That is the thing people scan a map for.
        var marker = new g.Marker({
          position: position,
          map: state.map,
          title: listing.title || '',
          label: priceLabel(listing)
            ? { text: priceLabel(listing), fontSize: '11px', fontWeight: '700', color: '#ffffff' }
            : undefined,
          icon: {
            path: 'M -22 -11 H 22 A 8 8 0 0 1 22 11 H -22 A 8 8 0 0 1 -22 -11 Z',
            fillColor: '#8a3a12',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 1.5,
            scale: 1,
            labelOrigin: new g.Point(0, 0)
          }
        });
        marker.addListener('click', function () {
          state.infoWindow.setContent(
            '<div style="font-family:inherit;max-width:220px">'
            + '<strong>' + esc(listing.title || '') + '</strong><br>'
            + esc([listing.area, listing.district].filter(Boolean).join(', '))
            + (priceLabel(listing) ? '<br>UGX ' + esc(String(listing.price_per_night)) + ' ' + esc(t('perNight')) : '')
            + '<br><a href="' + esc(listing.url || '#') + '" data-st-link>' + esc(t('search')) + '</a>'
            + '</div>'
          );
          state.infoWindow.open({ anchor: marker, map: state.map });
        });
        state.markers.push(marker);
        bounds.extend(position);
      });

      if (placed.length === 1) {
        state.map.setCenter(bounds.getCenter());
        state.map.setZoom(14);
      } else {
        state.map.fitBounds(bounds, 40);
      }
    });
  }

  function disclaimerBlock() {
    return ''
      + '<section class="st-disclaimer" id="st-disclaimer">'
      + '<h2><i class="fas fa-triangle-exclamation"></i> Read this before you contact anyone</h2>'
      + '<ul>'
      + '<li><b>makaug does not take bookings and does not handle money.</b> Every short stay here is arranged directly between you and the host. We are not an agent, a broker or a party to your stay.</li>'
      + '<li><b>Never send a deposit to someone you have not verified.</b> If a host asks for money before you have seen the place or confirmed who they are, stop. That is the single most common way people get cheated.</li>'
      + '<li><b>Hosts write their own listings.</b> makaug does not inspect every property, does not check every photo and cannot guarantee that a place is as described, is legally let, or is available.</li>'
      + '<li><b>Prices shown are the host’s.</b> Any total you see on this site is worked out from the host’s published rate and the dates you typed. It is an estimate, not a quote and not a contract.</li>'
      + '<li><b>Agree the terms in writing.</b> Check-in, check-out, what is included, the deposit and the refund rules should all be written down before you pay anything.</li>'
      + '<li><b>Report anything that looks wrong.</b> Use the report link on any listing. We take listings down.</li>'
      + '</ul>'
      + '</section>';
  }

  function guestInfoBlock() {
    return ''
      + '<section style="margin:26px 0">'
      + '<h2 style="font-size:1.15rem;font-weight:900;margin:0 0 12px">Coming to Uganda? Worth knowing.</h2>'
      + '<div class="st-info-grid">'
      + '<div class="st-info-card"><h3><i class="fas fa-passport"></i> Visas and entry</h3>'
      + '<p>Most visitors need a visa, and Uganda issues them online before travel. Check the current rules and apply on the official government portal.</p>'
      + '<a href="https://visas.immigration.go.ug" target="_blank" rel="noopener noreferrer">Uganda immigration e-visa portal <i class="fas fa-arrow-up-right-from-square"></i></a></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-umbrella-beach"></i> Uganda Tourism Board</h3>'
      + '<p>The official source for what to see and do across the country.</p>'
      + '<a href="https://utb.go.ug" target="_blank" rel="noopener noreferrer">Visit utb.go.ug <i class="fas fa-arrow-up-right-from-square"></i></a></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-money-bill-wave"></i> Paying for things</h3>'
      + '<p>The shilling (UGX) is cash and mobile money country. MTN Mobile Money and Airtel Money are accepted almost everywhere. Cards work in larger hotels and malls, less so elsewhere.</p></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-car"></i> Getting around</h3>'
      + '<p>Kampala traffic is heavy. Ride-hailing apps and boda bodas are the quickest way across town. For Entebbe airport runs, agree the fare or book the car before you travel.</p></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-plug"></i> Power and water</h3>'
      + '<p>Cuts happen. This is why the filters here include backup power, a water tank and a borehole. If you need to work while you are here, look for those and for Wi-Fi.</p></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-receipt"></i> Local hotel tax</h3>'
      + '<p>Short stay accommodation in Uganda can attract a local hotel tax per room per night, collected by the local authority. Ask your host whether their rate includes it.</p></div>'
      + '</div></section>';
  }

  // ---------------------------------------------------------------- search view

  function searchViewHtml() {
    var q = qs();
    return ''
      // The section's own content comes first, as it does on every other page.
      + '<section class="st-hero">'
      + '<div class="st-wrap">'
      + '<h1>' + esc(t('heroTitle')) + '</h1>'
      + '<p class="st-hero-sub">' + esc(t('heroSub')) + '</p>'
      + '<form class="st-search" id="st-search-form">'
      + '<div class="st-field"><label for="st-q">' + esc(t('where')) + '</label>'
      + '<input class="st-input" id="st-q" name="q" placeholder="' + esc(t('wherePh')) + '" value="' + esc(q.q || '') + '"></div>'
      + '<div class="st-field"><label for="st-in">' + esc(t('checkIn')) + '</label>'
      + '<input class="st-input" id="st-in" name="check_in" type="date" value="' + esc(q.check_in || '') + '"></div>'
      + '<div class="st-field"><label for="st-out">' + esc(t('checkOut')) + '</label>'
      + '<input class="st-input" id="st-out" name="check_out" type="date" value="' + esc(q.check_out || '') + '"></div>'
      + '<div class="st-field"><label for="st-guests">' + esc(t('guests')) + '</label>'
      + '<input class="st-input" id="st-guests" name="guests" type="number" min="1" max="30" value="' + esc(q.guests || '') + '" placeholder="2"></div>'
      + '<div class="st-field"><label for="st-max">' + esc(t('maxNight')) + '</label>'
      + '<input class="st-input" id="st-max" name="max_price" type="number" min="0" step="10000" value="' + esc(q.max_price || '') + '" placeholder="UGX"></div>'
      + '<button class="st-search-go" type="submit"><i class="fas fa-search"></i> ' + esc(t('search')) + '</button>'
      + '</form>'
      + '</div></section>'

      // Then the banner, in the site's own ad format.
      + adBannerHtml()

      // Then Ask AI. mountSearch moves the real shell in here.
      + '<div id="st-ai-slot"></div>'

      + '<div class="st-wrap">'
      + '<div class="st-toolbar" id="st-results-top">'
      + '<div class="st-count" id="st-count">' + esc(t('loading'))
      + '<small>' + esc(t('countNote')) + '</small></div>'
      + '<div class="st-toolbar-actions">'
      + '<select class="st-btn" id="st-sort" aria-label="' + esc(t('sortNewest')) + '">'
      + '<option value="">' + esc(t('sortNewest')) + '</option>'
      + '<option value="price_asc">' + esc(t('sortLow')) + '</option>'
      + '<option value="price_desc">' + esc(t('sortHigh')) + '</option>'
      + '<option value="rating">' + esc(t('sortRated')) + '</option>'
      + '</select>'
      + '<button class="st-btn" id="st-map-toggle" type="button"><i class="fas fa-map-location-dot"></i> ' + esc(t('showMap')) + '</button>'
      + '<a class="st-btn st-btn-primary" href="/short-term/list-your-place" data-st-link><i class="fas fa-plus"></i> ' + esc(t('listPlace')) + '</a>'
      + '</div></div>'

      + '<div class="st-split" id="st-split">'
      + '<div id="st-results"><div class="st-grid">'
      + '<div class="st-skeleton"></div><div class="st-skeleton"></div><div class="st-skeleton"></div><div class="st-skeleton"></div>'
      + '</div></div>'
      + '<div class="st-map-shell" id="st-map-shell" hidden><div id="st-map"></div></div>'
      + '</div>'

      + disclaimerBlock()
      + guestInfoBlock()
      + '</div>';
  }

  function cardHtml(listing) {
    var score = listing.review_count > 0 && listing.review_average != null
      ? '<p class="st-card-score"><i class="fas fa-star"></i> ' + listing.review_average.toFixed(1)
        + ' <span>(' + listing.review_count + ')</span></p>'
      : '<p class="st-card-score">New listing</p>';

    return ''
      + '<article class="st-card">'
      + '<a class="st-card-media" href="' + esc(listing.url) + '" data-st-link>'
      + (listing.primary_image
        ? '<img src="' + esc(listing.primary_image) + '" alt="' + esc(listing.title) + '" loading="lazy">'
        : '<div class="st-noimg"><i class="fas fa-house"></i></div>')
      + (listing.is_private_listing ? '<span class="st-badge">Private host</span>' : '<span class="st-badge">Partner</span>')
      + '</a>'
      + '<div class="st-card-body">'
      + '<h3 class="st-card-title"><a href="' + esc(listing.url) + '" data-st-link>' + esc(listing.title) + '</a></h3>'
      + '<p class="st-card-where">' + esc(listing.area) + ', ' + esc(listing.district) + '</p>'
      + '<p class="st-card-spec">' + esc(listing.place_type_label) + ' &middot; ' + listing.bedrooms + ' bed'
      + (listing.bedrooms === 1 ? '' : 's') + ' &middot; sleeps ' + listing.max_guests + '</p>'
      + '<p class="st-card-price"><b>' + esc(listing.nightly_display) + '</b> <span>per night</span></p>'
      + score
      + '</div></article>';
  }

  function runSearch() {
    var form = document.getElementById('st-search-form');
    var params = new URLSearchParams();
    if (form) {
      ['q', 'check_in', 'check_out', 'guests', 'max_price'].forEach(function (name) {
        var el = form.querySelector('[name="' + name + '"]');
        if (el && String(el.value).trim()) params.set(name, String(el.value).trim());
      });
    }
    var sort = document.getElementById('st-sort');
    if (sort && sort.value) params.set('sort', sort.value);

    var target = document.getElementById('st-results');
    if (target) {
      target.innerHTML = '<div class="st-grid"><div class="st-skeleton"></div><div class="st-skeleton"></div>'
        + '<div class="st-skeleton"></div><div class="st-skeleton"></div></div>';
    }

    var search = params.toString();
    // Only the search view owns the address bar. Rewriting it from a listing
    // page or the host wizard is how a deep link loses its path.
    if (window.history && window.history.replaceState && currentPath() === '/short-term') {
      window.history.replaceState({}, '', '/short-term' + (search ? '?' + search : ''));
    }

    return api('/search' + (search ? '?' + search : '')).then(function (payload) {
      state.listings = payload.listings || [];
      state.total = payload.total || 0;
      renderResults();
      if (state.mapOn) paintMap();
    }).catch(function (error) {
      if (target) {
        target.innerHTML = '<div class="st-empty"><i class="fas fa-triangle-exclamation"></i>'
          + esc(error.message || 'Short stays could not be loaded') + '</div>';
      }
    });
  }

  function renderResults() {
    var count = document.getElementById('st-count');
    if (count) {
      count.innerHTML = '<span>' + state.total + ' ' + esc(t('stays'))
        + '</span><small>' + esc(t('countNote')) + '</small>';
    }
    var target = document.getElementById('st-results');
    if (!target) return;
    if (!state.listings.length) {
      target.innerHTML = '<div class="st-empty"><i class="fas fa-magnifying-glass"></i>'
        + esc(t('emptyFilters')) + '<br><br>'
        + '<a class="st-btn st-btn-primary" href="/short-term/list-your-place" data-st-link>'
        + esc(t('listOwn')) + '</a></div>';
      return;
    }
    target.innerHTML = '<div class="st-grid">' + state.listings.map(cardHtml).join('') + '</div>';
  }

  function countdownUnitsHtml(diff) {
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);
    var secs = Math.floor((diff % 60000) / 1000);
    return [[days, 'days'], [hours, 'hrs'], [mins, 'min'], [secs, 'sec']].map(function (pair) {
      return '<div class="st-cd-unit"><b>' + String(pair[0]).padStart(2, '0') + '</b>'
        + '<span>' + esc(t(pair[1])) + '</span></div>';
    }).join('');
  }

  function adBannerHtml() {
    var config = window.__makaugShortTerm || {};
    if (!config.countdown) return '';
    var label = String(config.countdownLabel || 'AFCON 2027');
    // Same markup as the site's house ad placements, so it reads as one of
    // them. --st is a dark scrim: the stadium photograph is a night shot and
    // the default white scrim would leave the copy unreadable.
    return '<div class="mk-house-band-wrap max-w-7xl mx-auto st-ad-wrap">'
      + '<section class="mk-house-band mk-house-band--st" id="st-countdown" data-copy-side="left" aria-label="' + esc(label) + '">'
      + '<picture>'
      + '<img class="mk-house-band__image" src="/assets/img/hoima-stadium.jpg" alt="" '
      + 'style="object-position:center 42%" loading="lazy" decoding="async">'
      + '</picture>'
      + '<div class="mk-house-band__scrim" aria-hidden="true"></div>'
      + '<div class="mk-house-band__copy">'
      + '<h2 class="mk-house-band__headline">' + esc(t('adHeadline')) + '</h2>'
      + '<p class="st-ad-sub">' + esc(t('adSub')) + '</p>'
      + '<div class="st-cd-units" id="st-countdown-units"></div>'
      + '<p class="st-cd-date" id="st-countdown-date"></p>'
      + '<div class="st-ad-actions">'
      + '<a class="st-cd-btn st-cd-btn-primary" href="/short-term/list-your-place" data-st-link>' + esc(t('listPlace')) + '</a>'
      + '<a class="st-cd-btn" href="#st-results-top">' + esc(t('adCtaFind')) + '</a>'
      + '</div>'
      + '</div>'
      + '<span class="mk-house-band__tag">' + esc(label) + '</span>'
      + '</section></div>';
  }

  function startCountdown() {
    var config = window.__makaugShortTerm || {};
    var shell = document.getElementById('st-countdown');
    var units = document.getElementById('st-countdown-units');
    var dateEl = document.getElementById('st-countdown-date');
    if (!shell || !units) return;

    if (!config.countdown) { shell.remove(); return; }
    var target = new Date(config.countdown).getTime();
    if (!isFinite(target)) { shell.remove(); return; }

    if (dateEl) {
      var locale = stLang() === 'en' ? 'en-GB' : stLang();
      var when;
      try {
        when = new Date(target).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (_error) {
        when = new Date(target).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      }
      dateEl.textContent = t('kickOff') + ' ' + when;
    }

    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) {
        units.innerHTML = '<div class="st-cd-unit is-live"><b>LIVE</b><span>now</span></div>';
        if (state.countdownTimer) clearInterval(state.countdownTimer);
        return;
      }
      units.innerHTML = countdownUnitsHtml(diff);
    }
    tick();
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = setInterval(tick, 1000);
  }


  // Suggestions come from the same canonical location endpoint and the same
  // panel the homepage search uses, so they look and behave identically.
  function wireLocationTypeahead(input, attempt) {
    if (!input || input.dataset.stTypeahead === '1') return;
    // This file now loads in parallel with the main bundle, so its typeahead
    // helpers may not exist yet. Wait for them rather than leaving the field
    // bare for the rest of the visit.
    if (typeof window.renderTypeahead !== 'function'
      || typeof window.heroCanonicalSuggestionItems !== 'function') {
      var tries = (attempt || 0) + 1;
      if (tries <= 40) {
        window.setTimeout(function () { wireLocationTypeahead(input, tries); }, 250);
      }
      return;
    }
    input.dataset.stTypeahead = '1';
    input.setAttribute('autocomplete', 'off');

    var timer = null;
    var seq = 0;

    function close() {
      try { if (typeof window.closeTypeahead === 'function') window.closeTypeahead(); } catch (_error) {}
    }

    function ask() {
      var q = (input.value || '').trim();
      window.clearTimeout(timer);
      // One letter matches most of Uganda; two is where it starts being useful.
      if (q.length < 2) { close(); return; }
      timer = window.setTimeout(function () {
        var mine = ++seq;
        fetch('/api/properties/locations/suggest?q=' + encodeURIComponent(q) + '&limit=8', {
          headers: { Accept: 'application/json' }
        })
          .then(function (response) { return response.ok ? response.json() : null; })
          .then(function (body) {
            // A slow reply for an older keystroke must not overwrite a newer one.
            if (!body || mine !== seq) return;
            var items = window.heroCanonicalSuggestionItems(body) || [];
            if (!items.length) { close(); return; }
            window.renderTypeahead(input, items, function () {}, { preRanked: true });
          })
          .catch(function () { close(); });
      }, 180);
    }

    input.addEventListener('input', ask);
    input.addEventListener('focus', ask);
    input.addEventListener('blur', function () { window.setTimeout(close, 150); });
    input.addEventListener('keydown', function (event) {
      if (typeof window.handleTypeaheadKeydown !== 'function') return;
      // typeaheadState is a top-level const in the bundle, so it is reachable
      // by name from another classic script but never off window.
      var items = [];
      try { items = (typeof typeaheadState !== 'undefined' && typeaheadState.items) || []; } catch (_error) {}
      window.handleTypeaheadKeydown(event, function () { return items; }, function () {});
    });
  }

  function wireShortTermLocationFields() {
    ['st-q', 'f-district', 'f-area'].forEach(function (id) {
      wireLocationTypeahead(document.getElementById(id));
    });
  }

  function mountSearch() {
    var r = root();
    if (!r) return;
    var view = r.querySelector('.st-view-search');
    if (!view) return;
    // The Ask AI box is MOVED, never rebuilt: the main bundle wires that
    // markup, and re-creating it would leave a dead box behind. It now lives
    // inside this view, so it has to be parked somewhere safe before the wipe
    // or this render would delete it - the same way the section ended up
    // showing two different pages before.
    var shell = document.getElementById('short-term-ai-shell');
    if (shell && shell.parentNode !== r) r.appendChild(shell);

    view.innerHTML = searchViewHtml();

    var slot = document.getElementById('st-ai-slot');
    if (slot && shell) slot.appendChild(shell);

    startCountdown();
    wireShortTermLocationFields();
    refreshAskAiCopy();

    var form = document.getElementById('st-search-form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); runSearch(); });
    var sort = document.getElementById('st-sort');
    if (sort) sort.addEventListener('change', runSearch);

    var toggle = document.getElementById('st-map-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        state.mapOn = !state.mapOn;
        var shell = document.getElementById('st-map-shell');
        var split = document.getElementById('st-split');
        if (shell) shell.hidden = !state.mapOn;
        if (split) split.classList.toggle('is-map', state.mapOn);
        toggle.classList.toggle('is-on', state.mapOn);
        toggle.innerHTML = state.mapOn
          ? '<i class="fas fa-list"></i> ' + esc(t('hideMap'))
          : '<i class="fas fa-map-location-dot"></i> ' + esc(t('showMap'));
        if (state.mapOn) paintMap();
      });
    }

    runSearch();
  }

  // ---------------------------------------------------------------- detail view

  function quoteHtml(quote) {
    if (!quote) {
      return '<p class="st-help">Add your dates above to see what the host’s rate works out at.</p>';
    }
    var rows = ''
      + '<div class="st-quote-row"><span>' + quote.nights + ' night' + (quote.nights === 1 ? '' : 's')
      + ' at ' + esc(quote.per_night_display) + '</span><span>' + esc(ugx(quote.nights_subtotal_ugx)) + '</span></div>';
    if (quote.discount_ugx > 0) {
      rows += '<div class="st-quote-row"><span>' + esc(quote.discount_label) + ' (' + quote.discount_pct + '%)</span><span>-'
        + esc(ugx(quote.discount_ugx)) + '</span></div>';
    }
    if (quote.cleaning_fee_ugx > 0) {
      rows += '<div class="st-quote-row"><span>Cleaning fee</span><span>' + esc(ugx(quote.cleaning_fee_ugx)) + '</span></div>';
    }
    rows += '<div class="st-quote-row is-total"><span>Estimated total</span><span>' + esc(quote.total_display) + '</span></div>';

    var warn = '';
    if (!quote.meets_min_nights) {
      warn += '<p class="st-help" style="color:#b45309"><i class="fas fa-circle-info"></i> This host asks for at least '
        + quote.min_nights + ' nights.</p>';
    }
    if (quote.over_capacity) {
      warn += '<p class="st-help" style="color:#b45309"><i class="fas fa-circle-info"></i> That is more guests than this place sleeps.</p>';
    }
    return '<div class="st-quote">' + rows + '</div>' + warn
      + '<p class="st-help">' + esc(quote.disclaimer) + '</p>';
  }

  function availabilityHtml(availability) {
    if (!availability) return '';
    if (availability.available === true) {
      return '<p class="st-help" style="color:#15803d"><i class="fas fa-circle-check"></i> The host has these dates open on their calendar.</p>';
    }
    if (availability.available === false) {
      return '<p class="st-help" style="color:#b91c1c"><i class="fas fa-circle-xmark"></i> Those dates are not open on the host’s calendar. Ask them anyway if you are flexible.</p>';
    }
    return '<p class="st-help"><i class="fas fa-circle-info"></i> This host has not published a calendar. Ask them what is free.</p>';
  }

  function reviewsHtml(reviews, listing, open) {
    if (!listing.is_private_listing) return '';
    var body = reviews.length
      ? reviews.map(function (review) {
        return '<div class="st-review"><div class="st-review-head">'
          + '<span class="st-review-name">' + esc(review.reviewer_name) + '</span>'
          + '<span class="st-review-stars">' + stars(review.rating) + '</span></div>'
          + (review.stayed_on ? '<span class="st-review-date">Stayed ' + esc(review.stayed_on) + '</span>' : '')
          + '<p>' + esc(review.comment) + '</p></div>';
      }).join('')
      : '<p class="st-help">No reviews yet. If you have stayed here, you can be the first.</p>';

    var form = open ? ''
      + '<h3>Been here? Score it.</h3>'
      + '<form id="st-review-form">'
      + '<div class="st-stars-input" id="st-stars">'
      + [1, 2, 3, 4, 5].map(function (n) {
        return '<button type="button" data-star="' + n + '" aria-label="' + n + ' out of 5">★</button>';
      }).join('')
      + '</div>'
      + '<div class="st-form-grid" style="margin-top:10px">'
      + '<div><label class="st-label" for="st-rev-name">Your name</label><input class="st-input" id="st-rev-name" required></div>'
      + '<div><label class="st-label" for="st-rev-contact">Phone or email</label><input class="st-input" id="st-rev-contact" placeholder="Not shown publicly"></div>'
      + '<div><label class="st-label" for="st-rev-stayed">When you stayed</label><input class="st-input" id="st-rev-stayed" type="date"></div>'
      + '</div>'
      + '<div style="margin-top:10px"><label class="st-label" for="st-rev-comment">Your review</label>'
      + '<textarea class="st-input" id="st-rev-comment" required placeholder="What was it actually like?"></textarea></div>'
      + '<div id="st-review-feedback"></div>'
      + '<button class="st-btn st-btn-primary" type="submit" style="margin-top:10px">Post review</button>'
      + '<p class="st-help">Reviews go to a moderator before they appear. We ask for a contact so we can tell a real stay from a rival.</p>'
      + '</form>'
      : '';

    return '<div class="st-panel"><h2>Reviews and scores</h2>' + body + form + '</div>';
  }

  function detailViewHtml(payload) {
    var listing = payload.listing;
    var contact = listing.contact || {};
    var q = qs();

    var gallery = listing.images && listing.images.length
      ? '<div class="st-gallery">' + listing.images.slice(0, 6).map(function (img) {
        return '<img src="' + esc(img.url) + '" alt="' + esc(img.caption || listing.title) + '" loading="lazy">';
      }).join('') + '</div>'
      : '<div class="st-empty"><i class="fas fa-image"></i>This host has not added photos yet.</div>';

    var amenities = (listing.amenities || []).length && state.meta
      ? '<div class="st-panel"><h2>What this place has</h2><ul class="st-amenities">'
        + listing.amenities.map(function (slug) {
          var found = (state.meta.amenities || []).find(function (a) { return a.slug === slug; });
          return '<li><i class="fas fa-check"></i>' + esc(found ? found.label : slug.replace(/_/g, ' ')) + '</li>';
        }).join('') + '</ul></div>'
      : '';

    return ''
      + '<div class="st-wrap">'
      + '<p class="st-crumb"><a href="/short-term" data-st-link><i class="fas fa-arrow-left"></i> All short stays</a></p>'
      + '<h1 style="font-size:clamp(1.4rem,3.4vw,2rem);font-weight:900;margin:10px 0 4px">' + esc(listing.title) + '</h1>'
      + '<p style="color:#5b6b63;margin:0 0 14px">' + esc(listing.area) + ', ' + esc(listing.district)
      + (listing.review_count > 0 ? ' &nbsp;&middot;&nbsp; <span style="color:#f59e0b">' + stars(listing.review_average)
        + '</span> ' + listing.review_average.toFixed(1) + ' (' + listing.review_count + ')' : '')
      + '</p>'
      + gallery
      + '<div class="st-detail-grid" style="margin-top:20px">'
      + '<div>'
      + '<div class="st-facts">'
      + '<div class="st-fact"><b>' + listing.max_guests + '</b><span>Guests</span></div>'
      + '<div class="st-fact"><b>' + listing.bedrooms + '</b><span>Bedrooms</span></div>'
      + '<div class="st-fact"><b>' + listing.beds + '</b><span>Beds</span></div>'
      + '<div class="st-fact"><b>' + listing.bathrooms + '</b><span>Bathrooms</span></div>'
      + '</div>'
      + '<div class="st-panel"><h2>' + esc(listing.place_type_label) + '</h2>'
      + '<p class="st-prose">' + esc(listing.description) + '</p></div>'
      + amenities
      + '<div class="st-panel"><h2>Arriving and leaving</h2>'
      + '<p><b>Check in from</b> ' + esc(listing.check_in_from || '—')
      + ' &nbsp;&middot;&nbsp; <b>Check out by</b> ' + esc(listing.check_out_by || '—') + '</p>'
      + '<p><b>Minimum stay</b> ' + listing.min_nights + ' night' + (listing.min_nights === 1 ? '' : 's') + '</p>'
      + '<p><b>Cancellation</b> ' + esc(listing.cancellation_policy_label) + '</p>'
      + (listing.house_rules ? '<h3>House rules</h3><p class="st-prose">' + esc(listing.house_rules) + '</p>' : '')
      + (listing.terms_text ? '<h3>The host’s terms</h3><p class="st-prose">' + esc(listing.terms_text) + '</p>'
        + '<p class="st-help">These terms are written by the host, not by makaug. Read them before you agree anything.</p>' : '')
      + '</div>'
      + reviewsHtml(payload.reviews || [], listing, payload.reviews_open)
      + '<div class="st-panel"><h2>Something wrong with this listing?</h2>'
      + '<form id="st-report-form" class="st-form-grid">'
      + '<div><label class="st-label" for="st-report-reason">What is wrong</label>'
      + '<select class="st-input" id="st-report-reason">'
      + '<option>It is not available / does not exist</option>'
      + '<option>The price is wrong</option>'
      + '<option>The photos are not of this place</option>'
      + '<option>I think this is a scam</option>'
      + '<option>The host does not have the right to let it</option>'
      + '<option>Something else</option></select></div>'
      + '<div><label class="st-label" for="st-report-contact">Your contact (optional)</label>'
      + '<input class="st-input" id="st-report-contact"></div>'
      + '<div style="grid-column:1/-1"><label class="st-label" for="st-report-details">Details</label>'
      + '<textarea class="st-input" id="st-report-details" style="min-height:70px"></textarea></div>'
      + '<div style="grid-column:1/-1"><button class="st-btn" type="submit">Report this listing</button>'
      + '<span id="st-report-feedback"></span></div>'
      + '</form></div>'
      + '</div>'

      // ---- contact rail ----
      + '<aside>'
      + '<div class="st-book">'
      + '<div class="st-book-price">' + esc(listing.nightly_display) + ' <span>per night</span></div>'
      + '<div class="st-form-grid" style="margin-top:12px">'
      + '<div><label class="st-label" for="st-d-in">Check in</label><input class="st-input" id="st-d-in" type="date" value="' + esc(q.check_in || '') + '"></div>'
      + '<div><label class="st-label" for="st-d-out">Check out</label><input class="st-input" id="st-d-out" type="date" value="' + esc(q.check_out || '') + '"></div>'
      + '</div>'
      + '<div id="st-quote">' + quoteHtml(payload.quote) + '</div>'
      + '<div id="st-availability">' + availabilityHtml(payload.availability) + '</div>'

      + '<hr style="border:0;border-top:1px solid #dfe8e3;margin:14px 0">'
      + '<p style="font-weight:800;margin:0 0 2px">' + esc(listing.host_name || 'The host') + '</p>'
      + '<p class="st-help" style="margin:0 0 10px">You arrange this stay directly with them. makaug is not involved in the booking or the payment.</p>'
      + (contact.whatsapp_href
        ? '<a class="st-contact-btn st-contact-wa" href="' + esc(contact.whatsapp_href) + '" target="_blank" rel="noopener noreferrer" data-st-contact="whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp the host</a>'
        : '')
      + (contact.tel_href
        ? '<a class="st-contact-btn st-contact-tel" href="' + esc(contact.tel_href) + '" data-st-contact="phone"><i class="fas fa-phone"></i> Call ' + esc(contact.phone_display || '') + '</a>'
        : '')
      + (listing.external_booking_url
        ? '<a class="st-contact-btn st-contact-form" href="' + esc(listing.external_booking_url) + '" target="_blank" rel="noopener noreferrer nofollow sponsored"><i class="fas fa-arrow-up-right-from-square"></i> See it on ' + esc(listing.partner_name || 'the partner site') + '</a>'
        : '')
      + '<button class="st-contact-btn st-contact-form" type="button" id="st-enquire-open"><i class="fas fa-envelope"></i> Send your dates instead</button>'
      + '<div id="st-enquire-shell"></div>'
      + '</div>'
      + '</aside>'
      + '</div>'
      + disclaimerBlock()
      + '</div>';
  }

  function enquiryFormHtml() {
    return '<form id="st-enquire-form" style="margin-top:12px;border-top:1px solid #dfe8e3;padding-top:12px">'
      + '<div><label class="st-label" for="st-e-name">Your name</label><input class="st-input" id="st-e-name" required></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-phone">Phone</label><input class="st-input" id="st-e-phone" placeholder="0780 000 000"></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-email">Email</label><input class="st-input" id="st-e-email" type="email"></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-guests">Guests</label><input class="st-input" id="st-e-guests" type="number" min="1" max="30"></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-msg">Message</label><textarea class="st-input" id="st-e-msg" style="min-height:70px" placeholder="What you need to know"></textarea></div>'
      + '<div id="st-enquire-feedback"></div>'
      + '<button class="st-btn st-btn-primary" type="submit" style="width:100%;margin-top:10px">Send to the host</button>'
      + '<p class="st-help">This saves your details against the listing and shows you the host’s number. makaug does not pass the message on for you and does not chase a reply.</p>'
      + '</form>';
  }

  function bindDetail(payload) {
    var listing = payload.listing;

    function refreshQuote() {
      var from = document.getElementById('st-d-in');
      var to = document.getElementById('st-d-out');
      if (!from || !to || !from.value || !to.value) return;
      api('/listings/' + encodeURIComponent(listing.slug)
        + '?check_in=' + encodeURIComponent(from.value)
        + '&check_out=' + encodeURIComponent(to.value)).then(function (next) {
        var quoteEl = document.getElementById('st-quote');
        var availEl = document.getElementById('st-availability');
        if (quoteEl) quoteEl.innerHTML = quoteHtml(next.quote);
        if (availEl) availEl.innerHTML = availabilityHtml(next.availability);
      }).catch(function () {});
    }

    ['st-d-in', 'st-d-out'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', refreshQuote);
    });

    var open = document.getElementById('st-enquire-open');
    if (open) {
      open.addEventListener('click', function () {
        var shell = document.getElementById('st-enquire-shell');
        if (!shell || shell.innerHTML) return;
        shell.innerHTML = enquiryFormHtml();
        var form = document.getElementById('st-enquire-form');
        if (!form) return;
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var feedback = document.getElementById('st-enquire-feedback');
          var from = document.getElementById('st-d-in');
          var to = document.getElementById('st-d-out');
          api('/listings/' + encodeURIComponent(listing.id) + '/enquiries', {
            method: 'POST',
            body: {
              guest_name: (document.getElementById('st-e-name') || {}).value,
              guest_phone: (document.getElementById('st-e-phone') || {}).value,
              guest_email: (document.getElementById('st-e-email') || {}).value,
              party_size: (document.getElementById('st-e-guests') || {}).value,
              message: (document.getElementById('st-e-msg') || {}).value,
              check_in: from ? from.value : null,
              check_out: to ? to.value : null
            }
          }).then(function (payloadOut) {
            var c = payloadOut.contact || {};
            form.innerHTML = '<div class="st-ok"><b>Saved.</b> Now contact '
              + esc(payloadOut.host_name || 'the host') + ' directly:<br><br>'
              + (c.whatsapp_href ? '<a class="st-contact-btn st-contact-wa" href="' + esc(c.whatsapp_href)
                + '" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp"></i> WhatsApp</a>' : '')
              + (c.tel_href ? '<a class="st-contact-btn st-contact-tel" href="' + esc(c.tel_href)
                + '"><i class="fas fa-phone"></i> Call ' + esc(c.phone_display || '') + '</a>' : '')
              + '<p class="st-help" style="margin-top:8px">' + esc(payloadOut.next_step || '') + '</p></div>';
          }).catch(function (error) {
            if (feedback) {
              feedback.innerHTML = '<ul class="st-errors">'
                + ((error.details && error.details.length ? error.details : [error.message])
                  .map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('')) + '</ul>';
            }
          });
        });
      });
    }

    var starsEl = document.getElementById('st-stars');
    if (starsEl) {
      starsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-star]');
        if (!btn) return;
        state.rating = Number(btn.getAttribute('data-star'));
        Array.prototype.forEach.call(starsEl.querySelectorAll('button'), function (b) {
          b.classList.toggle('is-on', Number(b.getAttribute('data-star')) <= state.rating);
        });
      });
    }

    var reviewForm = document.getElementById('st-review-form');
    if (reviewForm) {
      reviewForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var feedback = document.getElementById('st-review-feedback');
        api('/listings/' + encodeURIComponent(listing.id) + '/reviews', {
          method: 'POST',
          body: {
            reviewer_name: (document.getElementById('st-rev-name') || {}).value,
            reviewer_contact: (document.getElementById('st-rev-contact') || {}).value,
            stayed_on: (document.getElementById('st-rev-stayed') || {}).value,
            comment: (document.getElementById('st-rev-comment') || {}).value,
            rating: state.rating
          }
        }).then(function (out) {
          reviewForm.innerHTML = '<div class="st-ok">' + esc(out.message || 'Thanks.') + '</div>';
        }).catch(function (error) {
          if (feedback) {
            feedback.innerHTML = '<ul class="st-errors">'
              + ((error.details && error.details.length ? error.details : [error.message])
                .map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('')) + '</ul>';
          }
        });
      });
    }

    var reportForm = document.getElementById('st-report-form');
    if (reportForm) {
      reportForm.addEventListener('submit', function (e) {
        e.preventDefault();
        api('/listings/' + encodeURIComponent(listing.id) + '/reports', {
          method: 'POST',
          body: {
            reason: (document.getElementById('st-report-reason') || {}).value,
            details: (document.getElementById('st-report-details') || {}).value,
            reporter_contact: (document.getElementById('st-report-contact') || {}).value
          }
        }).then(function () {
          reportForm.innerHTML = '<div class="st-ok">Thanks. Our team will look at this listing.</div>';
        }).catch(function (error) {
          var feedback = document.getElementById('st-report-feedback');
          if (feedback) feedback.innerHTML = ' <span style="color:#b91c1c;font-size:.82rem">' + esc(error.message) + '</span>';
        });
      });
    }
  }

  function mountDetail(slug) {
    var view = $('.st-view-detail');
    if (!view) return;
    view.innerHTML = '<div class="st-wrap"><div class="st-skeleton" style="height:340px;margin-top:20px"></div></div>';
    api('/listings/' + encodeURIComponent(slug)).then(function (payload) {
      view.innerHTML = detailViewHtml(payload);
      bindDetail(payload);
      document.title = payload.listing.title + ' | Short stay on makaug.com';
    }).catch(function (error) {
      view.innerHTML = '<div class="st-wrap"><div class="st-empty"><i class="fas fa-house-circle-xmark"></i>'
        + esc(error.status === 404 ? 'This short stay is no longer listed.' : error.message)
        + '<br><br><a class="st-btn st-btn-primary" href="/short-term" data-st-link>See what is available</a></div></div>';
    });
  }

  // ---------------------------------------------------------------- list your place

  function listViewHtml() {
    var meta = state.meta || {};
    var amenities = meta.amenities || [];
    var fee = meta.fee || { display: 'UGX 50,000', term_months: 3 };

    return ''
      + '<section class="st-hero"><div class="st-wrap">'
      + '<h1>List your short stay on makaug</h1>'
      + '<p class="st-hero-sub">Flat fee of <b>' + esc(fee.display) + ' for ' + esc(fee.term_months)
      + ' months</b>. No commission on any stay, ever. Guests contact you directly on your own number — we never sit in the middle.</p>'
      + '</div></section>'

      + '<div class="st-wrap" style="padding-top:22px;padding-bottom:40px">'
      + '<div class="st-steps">'
      + '<span class="st-step is-on" data-step="1">1. The place</span>'
      + '<span class="st-step" data-step="2">2. Price and dates</span>'
      + '<span class="st-step" data-step="3">3. Rules and terms</span>'
      + '<span class="st-step" data-step="4">4. You and payment</span>'
      + '</div>'

      + '<form id="st-list-form">'

      // step 1
      + '<div class="st-panel" data-panel="1">'
      + '<h2>What are you listing?</h2>'
      + '<div class="st-form-grid">'
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-title">Title</label>'
      + '<input class="st-input" id="f-title" required placeholder="Quiet 2-bed apartment in Naguru"></div>'
      + '<div><label class="st-label" for="f-place">Type of place</label><select class="st-input" id="f-place">'
      + '<option value="entire_place">Entire place</option><option value="private_room">Private room</option>'
      + '<option value="shared_room">Shared room</option></select></div>'
      + '<div><label class="st-label" for="f-ptype">Property type</label>'
      + '<input class="st-input" id="f-ptype" placeholder="Apartment, cottage, guest house"></div>'
      + '<div><label class="st-label" for="f-district">District</label><input class="st-input" id="f-district" required placeholder="Kampala"></div>'
      + '<div><label class="st-label" for="f-area">Area / neighbourhood</label><input class="st-input" id="f-area" required placeholder="Naguru"></div>'
      + '<div><label class="st-label" for="f-guests">Sleeps</label><input class="st-input" id="f-guests" type="number" min="1" value="2"></div>'
      + '<div><label class="st-label" for="f-beds">Bedrooms</label><input class="st-input" id="f-bedrooms" type="number" min="0" value="1"></div>'
      + '<div><label class="st-label" for="f-bedcount">Beds</label><input class="st-input" id="f-beds" type="number" min="1" value="1"></div>'
      + '<div><label class="st-label" for="f-baths">Bathrooms</label><input class="st-input" id="f-bathrooms" type="number" min="0" value="1"></div>'
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-desc">Describe it</label>'
      + '<textarea class="st-input" id="f-desc" required placeholder="What is it actually like? What is nearby? What should a guest know before they arrive?"></textarea></div>'
      + '</div>'
      + '<h3>Amenities</h3>'
      + '<div class="st-amenity-pick">'
      + amenities.map(function (a) {
        return '<label><input type="checkbox" value="' + esc(a.slug) + '" data-amenity> ' + esc(a.label) + '</label>';
      }).join('')
      + '</div>'
      + '<button class="st-btn st-btn-primary" type="button" data-next="2" style="margin-top:14px">Next</button>'
      + '</div>'

      // step 2
      + '<div class="st-panel" data-panel="2" hidden>'
      + '<h2>Your price and your dates</h2>'
      + '<div class="st-form-grid">'
      + '<div><label class="st-label" for="f-nightly">Price per night (UGX)</label>'
      + '<input class="st-input" id="f-nightly" type="number" min="1000" step="1000" required placeholder="200000"></div>'
      + '<div><label class="st-label" for="f-clean">Cleaning fee (UGX)</label><input class="st-input" id="f-clean" type="number" min="0" step="1000" value="0"></div>'
      + '<div><label class="st-label" for="f-deposit">Refundable deposit (UGX)</label><input class="st-input" id="f-deposit" type="number" min="0" step="1000" value="0"></div>'
      + '<div><label class="st-label" for="f-min">Minimum nights</label><input class="st-input" id="f-min" type="number" min="1" value="1"></div>'
      + '<div><label class="st-label" for="f-week">Weekly discount %</label><input class="st-input" id="f-week" type="number" min="0" max="90" value="0"></div>'
      + '<div><label class="st-label" for="f-month">Monthly discount %</label><input class="st-input" id="f-month" type="number" min="0" max="90" value="0"></div>'
      + '<div><label class="st-label" for="f-cin">Check in from</label><input class="st-input" id="f-cin" type="time" value="14:00"></div>'
      + '<div><label class="st-label" for="f-cout">Check out by</label><input class="st-input" id="f-cout" type="time" value="10:00"></div>'
      + '</div>'
      + '<h3>When is it free?</h3>'
      + '<p class="st-help">Add the date ranges you can take guests. Leave it blank if you would rather people just ask — we will say so on your listing.</p>'
      + '<div id="st-windows" style="margin-top:10px"></div>'
      + '<button class="st-btn" type="button" id="st-add-window"><i class="fas fa-plus"></i> Add another range</button>'
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="1">Back</button> '
      + '<button class="st-btn st-btn-primary" type="button" data-next="3">Next</button></div>'
      + '</div>'

      // step 3
      + '<div class="st-panel" data-panel="3" hidden>'
      + '<h2>House rules and your terms</h2>'
      + '<div><label class="st-label" for="f-rules">House rules</label>'
      + '<textarea class="st-input" id="f-rules" placeholder="No parties. No smoking indoors. Quiet after 10pm. Gate is locked at midnight."></textarea></div>'
      + '<div style="margin-top:12px"><label class="st-label" for="f-terms">Your terms and conditions</label>'
      + '<textarea class="st-input" id="f-terms" style="min-height:130px" placeholder="What the deposit covers and when you return it. What happens if a guest cancels. What is included in the price: water, power, Wi-Fi, cleaning. Anything a guest must agree before they arrive."></textarea>'
      + '<p class="st-help">These are your terms, shown on your listing as yours. makaug does not write them and is not a party to them.</p></div>'
      + '<div style="margin-top:12px"><label class="st-label" for="f-cancel">Cancellation policy</label>'
      + '<select class="st-input" id="f-cancel">'
      + Object.keys(meta.cancellation_policies || { moderate: 'Moderate' }).map(function (key) {
        return '<option value="' + esc(key) + '"' + (key === 'moderate' ? ' selected' : '') + '>'
          + esc((meta.cancellation_policies || {})[key] || key) + '</option>';
      }).join('')
      + '</select></div>'
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="2">Back</button> '
      + '<button class="st-btn st-btn-primary" type="button" data-next="4">Next</button></div>'
      + '</div>'

      // step 4
      + '<div class="st-panel" data-panel="4" hidden>'
      + '<h2>You, and how you want to be paid</h2>'
      + '<div class="st-form-grid">'
      + '<div><label class="st-label" for="f-hname">Name guests should ask for</label><input class="st-input" id="f-hname" required></div>'
      + '<div><label class="st-label" for="f-hphone">Phone</label><input class="st-input" id="f-hphone" required placeholder="0780 863 394"></div>'
      + '<div><label class="st-label" for="f-hwa">WhatsApp (if different)</label><input class="st-input" id="f-hwa"></div>'
      + '<div><label class="st-label" for="f-hemail">Email</label><input class="st-input" id="f-hemail" type="email"></div>'
      + '<div><label class="st-label" for="f-htype">You are the</label><select class="st-input" id="f-htype">'
      + '<option value="owner">Owner</option><option value="manager">Manager</option><option value="agent">Agent</option></select></div>'
      + '<div><label class="st-label" for="f-pay">How you prefer to be paid</label><select class="st-input" id="f-pay">'
      + '<option value="">Choose one</option>'
      + Object.keys(meta.payment_methods || {}).map(function (key) {
        return '<option value="' + esc(key) + '">' + esc((meta.payment_methods || {})[key]) + '</option>';
      }).join('')
      + '</select><p class="st-help">This is how guests pay <b>you</b>. makaug never receives or holds guest money.</p></div>'
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-titleref">Title or tenancy reference (optional)</label>'
      + '<input class="st-input" id="f-titleref" placeholder="Helps us verify you faster">'
      + '<p class="st-help">If you have a land title reference or a tenancy agreement number, adding it gets your listing through review quicker.</p></div>'
      + '</div>'

      + '<div class="st-disclaimer" style="margin:18px 0">'
      + '<h2><i class="fas fa-file-signature"></i> What you are agreeing to</h2>'
      + '<ul>'
      + '<li>You have the legal right to let this property out for short stays, and letting it does not breach a lease, mortgage or landlord’s condition.</li>'
      + '<li>The listing is accurate. The photos are of this property. The price is real.</li>'
      + '<li>You deal with guests directly. makaug is a place to be found, not your agent. We do not take bookings, hold deposits or guarantee guests.</li>'
      + '<li>You are responsible for your own tax and licences, including any local hotel tax on short stay accommodation and any income tax due.</li>'
      + '<li>The fee is <b>' + esc(fee.display) + ' for ' + esc(fee.term_months) + ' months</b>, payable once we approve the listing. We take no commission on any stay.</li>'
      + '<li>We can take a listing down if it is reported, inaccurate, or we cannot reach you.</li>'
      + '</ul></div>'

      + '<label class="st-check"><input type="checkbox" id="f-right" required> '
      + '<span>I confirm I have the right to let this property out for short stays.</span></label>'
      + '<label class="st-check"><input type="checkbox" id="f-tax"> '
      + '<span>I understand I am responsible for my own tax and any local hotel tax on short stays.</span></label>'
      + '<label class="st-check"><input type="checkbox" id="f-terms-ok" required> '
      + '<span>I accept the makaug listing terms above.</span></label>'

      + '<div id="st-list-feedback"></div>'
      + '<p class="st-help" style="margin-top:8px"><i class="fas fa-floppy-disk"></i> '
      + '<span id="st-draft-note">This form saves itself on this device as you type.</span></p>'
      + '<p class="st-help" style="margin-top:12px"><i class="fas fa-camera"></i> '
      + 'Photos come next, once the listing is saved. Have a few ready — the outside, the beds, the bathroom and the kitchen.</p>'
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="3">Back</button> '
      + '<button class="st-btn st-btn-primary" type="submit">Submit my place</button></div>'
      + '</div>'
      + '</form>'
      + '</div>';
  }


  // ---------------------------------------------------------------- draft rescue
  //
  // A host filling this in is on a phone, on Kampala mobile data, and the
  // connection WILL drop. Losing ten minutes of typing is how you lose a
  // listing and never get a second attempt. So the wizard writes itself to
  // localStorage as they go and offers it back when they return.
  //
  // Every access is wrapped: private mode, blocked site data and quota errors
  // all have to degrade to "no draft", never to a broken form.

  var DRAFT_KEY = 'makaug.short-term.draft.v1';
  var DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  var draftTimer = null;

  var DRAFT_FIELDS = [
    'f-title', 'f-place', 'f-ptype', 'f-district', 'f-area', 'f-guests',
    'f-bedrooms', 'f-beds', 'f-bathrooms', 'f-desc',
    'f-nightly', 'f-clean', 'f-deposit', 'f-min', 'f-week', 'f-month', 'f-cin', 'f-cout',
    'f-rules', 'f-terms', 'f-cancel',
    'f-hname', 'f-hphone', 'f-hwa', 'f-hemail', 'f-htype', 'f-pay', 'f-titleref'
  ];

  function readDraft() {
    try {
      var raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.savedAt) return null;
      if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
        clearDraft();
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function writeDraft() {
    try {
      var fields = {};
      DRAFT_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && String(el.value || '').trim()) fields[id] = el.value;
      });
      var amenities = $$('[data-amenity]:checked').map(function (el) { return el.value; });
      var hasSomething = Object.keys(fields).length || amenities.length
        || state.windows.some(function (w) { return w.starts_on || w.ends_on; });
      if (!hasSomething) return;

      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        step: state.wizardStep,
        fields: fields,
        amenities: amenities,
        windows: state.windows
      }));
      var note = document.getElementById('st-draft-note');
      if (note) note.textContent = 'Saved on this device';
    } catch (_error) {
      // Storage unavailable. The form still works; there is just no rescue.
    }
  }

  function queueDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 600);
  }

  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (_error) {}
  }

  function applyDraft(draft) {
    if (!draft) return;
    Object.keys(draft.fields || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = draft.fields[id];
    });
    (draft.amenities || []).forEach(function (slug) {
      var box = document.querySelector('[data-amenity][value="' + slug + '"]');
      if (box) box.checked = true;
    });
    if (Array.isArray(draft.windows) && draft.windows.length) {
      state.windows = draft.windows;
      renderWindows();
    }
  }

  function draftBannerHtml(draft) {
    if (!draft) return '';
    var when = new Date(draft.savedAt);
    var title = (draft.fields && draft.fields['f-title']) ? draft.fields['f-title'] : 'an unfinished listing';
    return '<div class="st-ok" style="margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">'
      + '<span style="flex:1;min-width:200px"><b>You left off part way through.</b> '
      + esc(title) + ', saved ' + esc(when.toLocaleString('en-GB')) + ' on this device.</span>'
      + '<button class="st-btn st-btn-primary" type="button" id="st-draft-restore">Pick up where I left off</button>'
      + '<button class="st-btn" type="button" id="st-draft-discard">Start fresh</button>'
      + '</div>';
  }

  // The share link carries ?ref=<whoever brought this host in>.
  //
  // This MUST run before any router touches the address bar. The main bundle's
  // showPage rewrites the URL to a page's canonical route, so by the time the
  // wizard submits, ?ref= is long gone. Captured once at boot, read from
  // storage from then on.
  function captureReferralCode() {
    try {
      var fromUrl = (new URLSearchParams(window.location.search || '').get('ref') || '').trim();
      if (fromUrl) window.sessionStorage.setItem('makaug.short-term.ref', fromUrl.slice(0, 40));
    } catch (_error) {
      // Session storage blocked. The listing still submits, just without a
      // referral code attached.
    }
  }
  captureReferralCode();

  function referralCode() {
    try { return window.sessionStorage.getItem('makaug.short-term.ref') || ''; } catch (_error) { return ''; }
  }

  // ---------------------------------------------------------------- photos

  // Phone cameras produce 4MB+ files. Sending one over Kampala mobile data is
  // slow enough that hosts give up, so the image is drawn into a canvas at a
  // sane size before it ever leaves the device. The server resizes and strips
  // metadata again on arrival - this is about the host's data bundle, not
  // about trusting the browser.
  var CLIENT_MAX_EDGE = 1600;
  var CLIENT_QUALITY = 0.82;

  function shrinkImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//i.test(file.type || '')) {
        reject(new Error(file.name + ' is not an image.'));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error(file.name + ' could not be opened as an image.')); };
        img.onload = function () {
          try {
            var scale = Math.min(1, CLIENT_MAX_EDGE / Math.max(img.width, img.height));
            var w = Math.max(1, Math.round(img.width * scale));
            var h = Math.max(1, Math.round(img.height * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve({
              name: file.name,
              data_url: canvas.toDataURL('image/jpeg', CLIENT_QUALITY),
              status: 'ready'
            });
          } catch (error) {
            // A canvas can be tainted or the file can be a format the browser
            // will not decode. Fall back to the original bytes and let the
            // server judge it.
            resolve({ name: file.name, data_url: reader.result, status: 'ready' });
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPhotoTray() {
    var tray = document.getElementById('st-photo-tray');
    if (!tray) return;
    if (!state.photos.length) {
      tray.innerHTML = '<p class="st-help">No photos yet. Guests skip listings with no photo, so add at least three.</p>';
      return;
    }
    tray.innerHTML = '<div class="st-photo-grid">' + state.photos.map(function (photo, i) {
      var badge = photo.status === 'done'
        ? '<span class="st-photo-state is-done"><i class="fas fa-check"></i></span>'
        : photo.status === 'uploading'
          ? '<span class="st-photo-state is-busy"><i class="fas fa-spinner fa-spin"></i></span>'
          : photo.status === 'error'
            ? '<span class="st-photo-state is-error" title="' + esc(photo.error || 'Failed') + '"><i class="fas fa-triangle-exclamation"></i></span>'
            : '<span class="st-photo-state"><i class="fas fa-clock"></i></span>';
      var remove = photo.status === 'done' ? ''
        : '<button type="button" class="st-photo-remove" data-photo-remove="' + i + '" aria-label="Remove photo"><i class="fas fa-xmark"></i></button>';
      return '<figure class="st-photo' + (i === 0 ? ' is-cover' : '') + '">'
        + '<img src="' + esc(photo.data_url) + '" alt="">'
        + badge + remove
        + (i === 0 ? '<figcaption>Cover photo</figcaption>' : '')
        + '</figure>';
    }).join('') + '</div>';
  }

  function addPhotoFiles(files) {
    var meta = (state.meta && state.meta.photos) || {};
    var max = Number(meta.max_per_listing || 12);
    var room = Math.max(0, max - state.photos.length);
    var chosen = Array.prototype.slice.call(files || []).slice(0, room);
    var feedback = document.getElementById('st-photo-feedback');

    if (!room) {
      if (feedback) feedback.innerHTML = '<ul class="st-errors"><li>That is the maximum of ' + max + ' photos.</li></ul>';
      return Promise.resolve();
    }
    if (feedback) feedback.innerHTML = '';

    return Promise.all(chosen.map(function (file) {
      return shrinkImageFile(file).catch(function (error) {
        return { name: file.name, error: error.message, status: 'error', data_url: '' };
      });
    })).then(function (prepared) {
      prepared.filter(function (p) { return p.data_url; }).forEach(function (p) { state.photos.push(p); });
      var failed = prepared.filter(function (p) { return !p.data_url; });
      if (failed.length && feedback) {
        feedback.innerHTML = '<ul class="st-errors">'
          + failed.map(function (p) { return '<li>' + esc(p.error) + '</li>'; }).join('') + '</ul>';
      }
      renderPhotoTray();
    });
  }

  // One request per photo. The host watches them land instead of staring at a
  // single request that either all works or all fails, and a connection that
  // drops halfway leaves the photos that did upload in place.
  function uploadPendingPhotos() {
    var pending = state.photos.filter(function (p) { return p.status === 'ready' || p.status === 'error'; });
    if (!pending.length || !state.listingId) return Promise.resolve();

    var progress = document.getElementById('st-photo-progress');
    var done = 0;

    function step(index) {
      if (index >= pending.length) return Promise.resolve();
      var photo = pending[index];
      photo.status = 'uploading';
      photo.error = null;
      renderPhotoTray();

      return api('/listings/' + encodeURIComponent(state.listingId) + '/photos', {
        method: 'POST',
        body: { data_url: photo.data_url, upload_token: state.uploadToken }
      }).then(function (out) {
        photo.status = 'done';
        photo.url = out.photo.url;
        done += 1;
      }).catch(function (error) {
        photo.status = 'error';
        photo.error = (error.details && error.details[0]) || error.message;
      }).then(function () {
        renderPhotoTray();
        if (progress) {
          progress.textContent = done + ' of ' + pending.length + ' uploaded';
        }
        return step(index + 1);
      });
    }

    if (progress) progress.textContent = 'Uploading…';
    return step(0).then(function () {
      var failed = state.photos.filter(function (p) { return p.status === 'error'; });
      if (progress) {
        progress.textContent = failed.length
          ? done + ' uploaded, ' + failed.length + ' failed. Tap Upload to retry the rest.'
          : done + ' photo' + (done === 1 ? '' : 's') + ' uploaded.';
      }
    });
  }

  function photoStageHtml(listing) {
    var meta = (state.meta && state.meta.photos) || {};
    var ready = meta.ready !== false;
    return '<div class="st-wrap" style="padding:30px 16px 48px">'
      + '<div class="st-ok" style="margin-bottom:18px">'
      + '<h2 style="margin:0 0 6px;font-size:1.2rem;font-weight:900">Your place is in.</h2>'
      + '<p style="margin:0">Reference <b>' + esc(listing.reference) + '</b>. It is with our team for review.</p>'
      + '</div>'

      + (ready
        ? '<div class="st-panel">'
          + '<h2>Now add photos</h2>'
          + '<p class="st-help" style="margin-bottom:12px">This is the part that decides whether anyone contacts you. '
          + 'The first photo becomes the cover. Up to ' + esc(meta.max_per_listing || 12) + ' photos.</p>'
          + '<label class="st-photo-drop" for="st-photo-input">'
          + '<i class="fas fa-camera"></i><span>Choose photos from this device</span>'
          + '<input id="st-photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>'
          + '</label>'
          + '<div id="st-photo-tray" style="margin-top:14px"></div>'
          + '<div id="st-photo-feedback"></div>'
          + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">'
          + '<button class="st-btn st-btn-primary" type="button" id="st-photo-upload"><i class="fas fa-cloud-arrow-up"></i> Upload photos</button>'
          + '<span class="st-help" id="st-photo-progress"></span>'
          + '</div>'
          + '<p class="st-help" style="margin-top:12px"><i class="fas fa-shield-halved"></i> '
          + esc(meta.note || 'Photos are resized and re-encoded on upload, which removes the location data a phone stores inside them.')
          + '</p>'
          + '</div>'
        : '<div class="st-panel"><h2>Photos</h2>'
          + '<p class="st-help">Photo uploads are temporarily unavailable on this server. Your listing is saved '
          + 'and our team will be in touch about adding pictures.</p></div>')

      + '<div class="st-panel">'
      + '<h2>What happens next</h2>'
      + '<p>Our team checks the listing. Once it is approved you pay the flat listing fee and it goes live for three months.</p>'
      + '<p class="st-help">makaug takes no commission on any stay. Guests will contact you directly on the number you gave us.</p>'
      + '</div>'
      + '<p><a class="st-btn st-btn-primary" href="/short-term" data-st-link>See other short stays</a></p>'
      + '</div>';
  }

  function bindPhotoStage() {
    renderPhotoTray();

    var input = document.getElementById('st-photo-input');
    if (input) {
      input.addEventListener('change', function () {
        addPhotoFiles(input.files).then(function () { input.value = ''; });
      });
    }

    var uploadBtn = document.getElementById('st-photo-upload');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', function () {
        uploadBtn.disabled = true;
        uploadPendingPhotos().then(function () { uploadBtn.disabled = false; });
      });
    }

    var tray = document.getElementById('st-photo-tray');
    if (tray) {
      tray.addEventListener('click', function (e) {
        var remove = e.target.closest('[data-photo-remove]');
        if (!remove) return;
        state.photos.splice(Number(remove.getAttribute('data-photo-remove')), 1);
        renderPhotoTray();
      });
    }
  }

  function renderWindows() {
    var host = document.getElementById('st-windows');
    if (!host) return;
    host.innerHTML = state.windows.map(function (w, i) {
      return '<div class="st-window">'
        + '<div><label class="st-label">Free from</label><input class="st-input" type="date" data-win-from="' + i + '" value="' + esc(w.starts_on) + '" min="' + todayIso() + '"></div>'
        + '<div><label class="st-label">Until</label><input class="st-input" type="date" data-win-to="' + i + '" value="' + esc(w.ends_on) + '" min="' + todayIso() + '"></div>'
        + (state.windows.length > 1 ? '<button class="st-btn" type="button" data-win-remove="' + i + '"><i class="fas fa-trash"></i></button>' : '<span></span>')
        + '</div>';
    }).join('');
  }

  function mountList() {
    var view = $('.st-view-list');
    if (!view) return;

    var render = function () {
      var draft = readDraft();
      view.innerHTML = listViewHtml();
      renderWindows();
      wireShortTermLocationFields();

      if (draft) {
        var steps = view.querySelector('.st-steps');
        if (steps) steps.insertAdjacentHTML('beforebegin', draftBannerHtml(draft));
        var restore = document.getElementById('st-draft-restore');
        var discard = document.getElementById('st-draft-discard');
        if (restore) {
          restore.addEventListener('click', function () {
            applyDraft(draft);
            var banner = restore.closest('.st-ok');
            if (banner) banner.remove();
          });
        }
        if (discard) {
          discard.addEventListener('click', function () {
            clearDraft();
            var banner = discard.closest('.st-ok');
            if (banner) banner.remove();
          });
        }
      }

      // Autosave. Debounced, so typing a description is not 400 writes.
      view.addEventListener('input', queueDraftSave);
      view.addEventListener('change', queueDraftSave);

      view.addEventListener('click', function (e) {
        var next = e.target.closest('[data-next]');
        if (next) {
          var step = Number(next.getAttribute('data-next'));
          $$('[data-panel]').forEach(function (p) { p.hidden = Number(p.getAttribute('data-panel')) !== step; });
          $$('.st-step').forEach(function (s) {
            var n = Number(s.getAttribute('data-step'));
            s.classList.toggle('is-on', n === step);
            s.classList.toggle('is-done', n < step);
          });
          state.wizardStep = step;
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (e.target.closest('#st-add-window')) {
          state.windows.push({ starts_on: '', ends_on: '' });
          renderWindows();
          return;
        }
        var remove = e.target.closest('[data-win-remove]');
        if (remove) {
          state.windows.splice(Number(remove.getAttribute('data-win-remove')), 1);
          if (!state.windows.length) state.windows.push({ starts_on: '', ends_on: '' });
          renderWindows();
        }
      });

      view.addEventListener('change', function (e) {
        var from = e.target.getAttribute && e.target.getAttribute('data-win-from');
        var to = e.target.getAttribute && e.target.getAttribute('data-win-to');
        if (from != null) state.windows[Number(from)].starts_on = e.target.value;
        if (to != null) state.windows[Number(to)].ends_on = e.target.value;
      });

      var form = document.getElementById('st-list-form');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
          var checked = function (id) { var el = document.getElementById(id); return !!(el && el.checked); };
          var feedback = document.getElementById('st-list-feedback');

          api('/listings', {
            method: 'POST',
            body: {
              title: val('f-title'),
              description: val('f-desc'),
              district: val('f-district'),
              area: val('f-area'),
              place_type: val('f-place'),
              property_type: val('f-ptype'),
              bedrooms: val('f-bedrooms'),
              beds: val('f-beds'),
              bathrooms: val('f-bathrooms'),
              max_guests: val('f-guests'),
              base_nightly_ugx: val('f-nightly'),
              cleaning_fee_ugx: val('f-clean'),
              security_deposit_ugx: val('f-deposit'),
              min_nights: val('f-min'),
              weekly_discount_pct: val('f-week'),
              monthly_discount_pct: val('f-month'),
              check_in_from: val('f-cin'),
              check_out_by: val('f-cout'),
              house_rules: val('f-rules'),
              terms_text: val('f-terms'),
              cancellation_policy: val('f-cancel'),
              host_name: val('f-hname'),
              host_phone: val('f-hphone'),
              host_whatsapp: val('f-hwa'),
              host_email: val('f-hemail'),
              host_type: val('f-htype'),
              preferred_payment_method: val('f-pay'),
              right_to_let_reference: val('f-titleref'),
              right_to_let_declared: checked('f-right'),
              local_hotel_tax_ack: checked('f-tax'),
              terms_accepted: checked('f-terms-ok'),
              referral_code: referralCode(),
              amenities: $$('[data-amenity]:checked').map(function (el) { return el.value; }),
              availability: state.windows.filter(function (w) { return w.starts_on && w.ends_on; })
            }
          }).then(function (out) {
            // Saved on the server, so the local rescue copy has done its job.
            clearDraft();
            state.listingId = out.listing.id;
            state.uploadToken = out.upload_token || null;
            if (state.meta && state.meta.photos) {
              state.meta.photos.ready = out.photos_ready !== false && state.meta.photos.ready !== false;
            }
            view.innerHTML = photoStageHtml(out.listing);
            bindPhotoStage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }).catch(function (error) {
            if (feedback) {
              feedback.innerHTML = '<ul class="st-errors">'
                + ((error.details && error.details.length ? error.details : [error.message])
                  .map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('')) + '</ul>';
              feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          });
        });
      }
    };

    if (state.meta) return render();
    api('/meta').then(function (meta) { state.meta = meta; render(); }).catch(render);
  }

  // ---------------------------------------------------------------- routing


  // Everything this section needs in order to render. index.html ships the
  // same markup for the server-rendered view; this is here because the main
  // bundle can replace the whole page block with an empty one, and depending
  // on markup another script owns is how the section ended up blank.
  function scaffoldHtml() {
    return ''
      + '<div id="short-term-ai-shell" class="st-wrap" style="padding-top:18px">'
      + '<div class="ask-ai-search-shell" data-ai-search-shell data-ai-scope="short-term">'
      + '<div class="flex items-center justify-between gap-3 flex-wrap">'
      + '<div class="min-w-0">'
      + '<h2 data-ai-title class="ask-ai-search-title">Describe what you want</h2>'
      + '<p data-ai-subtitle class="ask-ai-search-subtitle">Search in any language — makaug AI finds real listings.</p>'
      + '</div>'
      + '<p data-ai-scope-hint class="ask-ai-scope-chip">Searching Short Term</p>'
      + '</div>'
      + '<form data-ai-search-form data-ai-scope="short-term" onsubmit="submitAskAiSearchPrompt(event)" class="mt-3">'
      + '<input data-ai-intent type="hidden" value="search_short_term">'
      + '<label data-ai-label class="sr-only">Ask makaug AI</label>'
      + '<div class="ask-ai-search-row">'
      + '<span class="ask-ai-search-icon" aria-hidden="true">✨</span>'
      + '<input data-ai-message autocomplete="off" class="ask-ai-search-input" aria-label="Ask makaug AI" placeholder="Try: short stay in Kampala">'
      + '<button data-ai-submit type="submit" class="ask-ai-search-submit">✨ Ask AI</button>'
      + '</div>'
      + '</form>'
      + '<div data-ai-response class="mt-4 hidden rounded-2xl border border-blue-100 bg-white p-4 text-gray-900"></div>'
      + '</div>'
      + '</div>'
      + '<section class="st-view st-view-search is-active"><div id="short-term-ssr" class="st-wrap" style="padding-top:12px"></div></section>'
      + '<section class="st-view st-view-detail"></section>'
      + '<section class="st-view st-view-list"></section>';
  }

  function ensureScaffold(r) {
    if (!r || r.querySelector('.st-view-search')) return;
    r.innerHTML = scaffoldHtml();
    refreshAskAiCopy();
  }

  // The bundle owns the Ask AI copy - title, subtitle, scope chip, rotating
  // placeholder, and all of it per language. Freshly injected markup carries
  // the English defaults until it runs again.
  //
  // It is applied more than once on purpose: the chip is derived from the page
  // the bundle thinks is current, and on the first transition into the section
  // it has not caught up, so the chip reads "Searching all properties" until
  // it does.
  function refreshAskAiCopy() {
    [0, 60, 250, 700].forEach(function (delay) {
      window.setTimeout(function () {
        try {
          if (typeof window.updateHomeAskAiLanguageCopy === 'function') {
            window.updateHomeAskAiLanguageCopy();
          }
        } catch (_error) {}
        pinShortTermScope();
      }, delay);
    });
  }

  // updateHomeAskAiLanguageCopy rebuilds the shell from the scope the bundle
  // derives from its own current page, and on the first transition that is
  // still the page the visitor came from - so it overwrites data-ai-scope and
  // the chip says "Searching all properties". Pinning it back afterwards, with
  // the bundle's own text function so the wording stays right in every
  // language rather than being hard-coded to English here.
  function pinShortTermScope() {
    try {
      var shell = document.getElementById('short-term-ai-shell');
      if (!shell) return;
      ['[data-ai-search-shell]', '[data-ai-search-form]'].forEach(function (sel) {
        var el = shell.querySelector(sel);
        if (el) el.setAttribute('data-ai-scope', 'short-term');
      });
      var chip = shell.querySelector('[data-ai-scope-hint]');
      if (chip && typeof window.aiAssistantScopeHintText === 'function') {
        chip.textContent = window.aiAssistantScopeHintText('short_term');
      }
      var intent = shell.querySelector('[data-ai-intent]');
      if (intent) intent.value = 'search_short_term';
    } catch (_error) {}
  }

  function setView(name) {
    var r = root();
    if (!r) return;
    r.classList.add('st-hydrated');
    ['search', 'detail', 'list'].forEach(function (key) {
      var el = r.querySelector('.st-view-' + key);
      if (el) el.classList.toggle('is-active', key === name);
    });
    // The Ask AI box lives outside the views so that re-rendering the search
    // view cannot delete it. It belongs to searching, so it is hidden while a
    // host is filling in the wizard or a guest is reading one listing.
    var ai = document.getElementById('short-term-ai-shell');
    if (ai) ai.hidden = (name !== 'search');
  }

  function route() {
    var r = root();
    if (!r) return;
    var path = currentPath();
    // The main bundle reveals this page the instant the nav is clicked, which
    // can happen before the address bar says /short-term. If the page is on
    // screen it renders - a visible page must never be left showing the shell.
    if (path !== '/short-term' && path.indexOf('/short-term/') !== 0) {
      if (!r.classList.contains('active')) return;
      path = '/short-term';
    }

    if (typeof window.showPage === 'function') {
      // showPage rewrites the address bar to this page's canonical route, which
      // throws away /list-your-place, a listing slug and any query string. Put
      // the real one back immediately so refresh, share and back all work.
      var intended = (window.location.pathname || '') + (window.location.search || '');
      try { window.showPage('short-term', { scroll: false }); } catch (_e) {}
      try {
        if (window.history && window.history.replaceState
          && (window.location.pathname + window.location.search) !== intended) {
          window.history.replaceState({}, '', intended);
        }
      } catch (_e) {}
    } else {
      document.querySelectorAll('.page.active').forEach(function (p) {
        if (p !== r) p.classList.remove('active');
      });
      r.classList.add('active');
    }

    ensureScaffold(r);

    if (path === '/short-term/list-your-place') {
      setView('list');
      mountList();
      return;
    }
    if (path.indexOf('/short-term/') === 0) {
      setView('detail');
      mountDetail(path.slice('/short-term/'.length));
      return;
    }
    setView('search');
    if (!r.querySelector('#st-search-form')) mountSearch();
  }

  // Internal links stay in the single page app.
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[data-st-link], a[href^="/short-term"]') : null;
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (link.target === '_blank') return;
    var href = link.getAttribute('href') || '';
    if (href.indexOf('/short-term') !== 0) return;
    // This page's block only ships on short-term routes. Without it there is
    // nothing to render into, and cancelling the navigation would strand the
    // visitor on the page they were already on.
    if (!root()) return;
    e.preventDefault();
    go(href);
  });

  window.addEventListener('popstate', route);

  // showPage() can reveal this page from the desktop nav, the mobile menu, a
  // back button or any route the main bundle owns, and none of them tell this
  // file. So watch the page's own class: however it becomes visible, it
  // renders. This is what stops the shell ever being left on screen.
  var hydrating = false;
  function hydrateIfVisible() {
    if (hydrating) return;
    var r = root();
    if (!r || !r.classList.contains('active')) return;
    hydrating = true;
    try { route(); } catch (_error) {}
    // Re-arm on the next tick. route() calls showPage, which touches the same
    // class this observer watches, and without the flag that loops.
    setTimeout(function () { hydrating = false; }, 0);
  }

  // Attach to the page block the moment it exists, however late that is.
  // Returns true once it is watching, so the callers below can stop asking.
  function ensureObserver() {
    var r = root();
    if (!r) return false;
    if (!r.__stObserved) {
      r.__stObserved = true;
      try {
        if (window.MutationObserver) {
          // Class changes on the block: it being shown or hidden.
          new window.MutationObserver(hydrateIfVisible)
            .observe(r, { attributes: true, attributeFilter: ['class'] });

          // And its parent, because the main bundle swaps this whole block for
          // a fresh one from its own template. An observer on the block itself
          // cannot survive the block being replaced - it just sits on the
          // detached node while the visitor looks at an empty new one.
          var parent = r.parentNode;
          if (parent && !parent.__stChildObserved) {
            parent.__stChildObserved = true;
            new window.MutationObserver(function () {
              var current = root();
              if (current && !current.__stObserved) ensureObserver();
            }).observe(parent, { childList: true });
          }
        }
      } catch (_error) {}
    }
    hydrateIfVisible();
    return true;
  }

  // The bundle builds the block in response to the nav click, so look again
  // just after one. Capture phase, so this runs before the link handler below
  // whatever else is bound to the page.
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest
      ? e.target.closest('a[data-short-term-entry], a[href^="/short-term"]')
      : null;
    if (!link) return;
    [0, 80, 250, 600].forEach(function (delay) {
      window.setTimeout(ensureObserver, delay);
    });
  }, true);

  if (!ensureObserver()) {
    // Covers any other route into the section - a back button, a deep link the
    // bundle resolves itself. Bounded: the click hook above is the real path.
    var observerTries = 0;
    var observerPoll = window.setInterval(function () {
      if (ensureObserver() || ++observerTries > 40) window.clearInterval(observerPoll);
    }, 250);
  }

  // A language change has to rebuild the view, not just re-route to it.
  // route() deliberately leaves an existing search form alone, which is right
  // for navigation and wrong here.
  function repaintCurrentView() {
    var r = root();
    if (!r || !r.classList.contains('active')) return;
    var path = currentPath();
    if (path === '/short-term/list-your-place') { mountList(); return; }
    if (path !== '/short-term' && path.indexOf('/short-term/') === 0) {
      mountDetail(path.slice('/short-term/'.length));
      return;
    }
    mountSearch();
    renderResults();
    if (state.mapOn) paintMap();
  }

  function boot() {
    if (!root()) return;
    api('/meta').then(function (meta) { state.meta = meta; }).catch(function () {});
    route();
    // Covers the case where the page was already revealed before this file
    // finished loading.
    hydrateIfVisible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }


  // rehydrate() is called by the loader once the main bundle has finished,
  // which is when it has had its chance to replace the page block.
  window.makaugShortTerm = { route: route, search: runSearch, rehydrate: ensureObserver };
})();
