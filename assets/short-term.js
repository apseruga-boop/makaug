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
    partners: [],
    bookingOffers: [],
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
    "d1Body": "Kabedo ducu ka ki yubu atir i kin in ki won ot. Wan pe agent, pe broker, dok pe watye i cikke mamegi.",
    "d1Lead": "makaug pe gamo booking dok pe tiyo ki cente.",
    "d2Body": "Ka won ot penyi cente ma peya ineno kabedo onyo iniang ni en anga, cung woko. Man aye yoo ma dano gi kwalo iye jo mapol.",
    "d2Lead": "Pe icwal deposit bot ngat ma peya i niang kit ma en tye kwede.",
    "d3Body": "makaug pe neno ot acel acel, pe neno cal acel acel, dok pe twero moko ni kabedo tye kit ma kiwacco, ni kipangisa i yo ma cik oyee, onyo ni tye.",
    "d3Lead": "Wegi ot aye gicoyo listing gi kengi.",
    "d4Body": "Wel ducu ma ineno i kany kikwano ki i wel ma won ot oketo ki nino ma icoyo. Obedo tam keken, pe quote dok pe cikke.",
    "d4Lead": "Wel ma kinyuto obedo pa won ot.",
    "d5Body": "Donyo iye, kato woko, gin ma tye iye, deposit ki cik me dwoko cente ducu myero kicoo con ma peya icula gin mo.",
    "d5Lead": "Wurwate i kom cik i coc.",
    "d6Body": "Tii ki report link i listing mo keken. Wan wagolo listing woko.",
    "d6Lead": "Tit pi gin mo keken ma nen marac.",
    "days": "nino",
    "discTitle": "Pe i cul peya ineno kabedo",
    "safetyMore": "Kwano lok ducu me gwoko kwo",
    "infoLead": "Jami abicel ma mite ngeyo.",
    "extrasPartnersNamed": "Nying keken. makaug pe keto logo gi. Kakube yabo kakube pa lawot.",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "Pe tye gin mo marwate ki magi. Tem yaro nino onyo kabedo.",
    "emptyNone": "Pe tye kabedo me nino manok ma kityeko kete. Ka itye ki kabedo i Uganda ma ipangisa i nino acel acel, kete i makaug.",
    "guests": "Welo",
    "heroSub": "Apartments, cottages ki guest houses ma itwero gamo i nino acel acel. Listing pa won kabedo tye ki namba me cim mere, wek itii kwede atir.",
    "heroTitle": "Yeny kabedo me nino manok i Uganda",
    "hideMap": "Kan map",
    "hrs": "cawa",
    "i1B": "Welo mapol mito visa, dok Uganda miyo i internet ma peya i wot. Nen cik ma tye kombedi dok ipeny i portal pa gamente.",
    "i1L": "Portal me e-visa pa Uganda immigration",
    "i1T": "Visa ki donyo",
    "i2B": "Ka ma kimiyo iye lok ada i kom gin ma myero ineno ki tim i lobo ducu.",
    "i2L": "Lim utb.go.ug",
    "i2T": "Uganda Tourism Board",
    "i3B": "Shilling (UGX) obedo lobo pa cente macalo ki mobile money. MTN Mobile Money ki Airtel Money kigamo kabedo ducu. Card tiyo i hotel madito ki mall, pe kabedo ducu.",
    "i3T": "Culo gin mo",
    "i4B": "Mutoka pong i Kampala. App me lwongo mutoka ki boda boda aye yoo ma oyot i gang. Pi wot me Entebbe airport, wurwate i kom wel onyo ibook mutoka con.",
    "i4T": "Wot i lobo",
    "i5B": "Ngolo timme. Peny won ot pi backup power, tank pa pii ki borehole. Ka imito tic ka itye kany, peny pi magi ki Wi-Fi. Potbuk man pe yeko ki jami magi.",
    "i5T": "Mac ki pii",
    "i6B": "Kabedo me nino manok i Uganda romo gamo mucoro me hotel pi ot acel i nino acel, ma lutela me kabedo gi cokko. Peny won ot ka wel mere tye ki mucoro-ni.",
    "i6T": "Mucoro me hotel pa kabedo",
    "infoTitle": "Ibino i Uganda? Man mite ngeyo.",
    "kickOff": "Tuko cake",
    "listOwn": "Ket kabedo mamegi",
    "listPlace": "Ket kabedo mamegi",
    "loading": "Tye ka yeny…",
    "mapFail": "Map pe otwero cako. Lok ma piny nyuto kabedo ducu.",
    "maxNight": "Wel madit i nino acel",
    "min": "dakika",
    "newListing": "Manyen",
    "partnerBadge": "Otel",
    "partnerHeading": "Hotel i Uganda",
    "partnerNote": "Otel magi oa ki bot lawot me wot, ki nyuto calo tyen lok. makaug pe keto, pe neno, pe booko dok pe keto wel. Namba cim pe tye kany. Check prices nen keken ka brand me hotel oyabe.",
    "partnerPriceAsk": "Tyen lok keken. Wel ma tye kombedi pe nyut kany.",
    "partnerReviews": "ngec",
    "partnerVisit": "Kabedo pa hotel kikome",
    "bookingCta": "Yeny kabedo i",
    "bookingNote": "Hotel ki ot mukene i Uganda ducu ki bot lawote me wot. Booking itimo i kakube gi, pe ki makaug.",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "Pe tye kabedo i {town} pud",
    "comparePrices": "Por wel",
    "checkPrices": "Nen wel",
    "affiliateDisclosure": "makaug twero nongo komishon; ibuk ki i cul i kakube pa lawote, ma tye ka time booking ni",
    "indicative": "ma nyutu",
    "hotelsTown": "Tyen lok pa otel i {town}",
    "hotelsFallback": "Tyen lok pa otel · Kampala ki Entebbe",
    "showMore": "Nyut mapol",
    "alertWhatsapp": "Mii ngec i WhatsApp ka kabedo oket",
    "searchHotels": "Yeny otel",
    "adLabel": "Cato",
    "requestDates": "Leg nino magi",
    "paymentDirect": "Cul kimoko atir ikin in ki won ot. makaug pe kwanyo dok pe gwoko cente.",
    "feeAwaiting": "Kiyee, tye ka kuro cul me UGX 20,000 dwe ki dwe. Peke nino ma nono. Kakube me culo bino. Listing cako nen ka cul otyeko time.",
    "listFee": "Jo ma pe agent culo UGX 20,000 dwe ki dwe, peke nino ma nono. Short stay pa agent ma oyee tye i plan pa agent (UGX 50,000 dwe ki dwe).",
    "termsTitle": "Cik me nino manok",
    "termsBody": "makaug keto kabedo, neno gin ma twero, dok ryeyo welo ki won ot. Won ot aye tye ki tic pi bedo, gwoko, layicens, musolo ki dwoko cente.",
    "termsLawyer": "Lukwena pa Uganda myero onen cik magi ma peya kimako ni gin aye agiki.",
    "verifiedStay": "Nino ma kikakaso",
    "safetyView": "Nen kabedo dok iniang nga ma iculo bot en ma peya iculo.",
    "safetyName": "Pe icul i akaunt ma nyinge pat.",
    "safetyReport": "Nong peko ki i listing ka tye gin ma pe atir.",
    "extrasTitle": "Plan me wot ni",
    "extrasLead": "Yabe i kakube pa lawote. makaug pe time booking onyo cul.",
    "extrasNote": "Kube me lawote: MakaUG twero nongo komishon",
    "extrasTransfers": "Wot ki i airport",
    "extrasEsims": "esimu eSIM",
    "extrasTours": "Wot ki tic",
    "extrasCars": "Kango motoka",
    "extrasFlights": "Ndege"
  },
  "am": {
    "adCtaFind": "ማረፊያ ይፍልጉ",
    "adHeadline": "ዩጋንዳ ታስተናግዳለች። ክፍሎች በፍጥነት ይዮዛሉ።",
    "adSub": "ካምፓላ፣ እንቴቤ እና ጁንጃ ጨዋታው ከመጀመሩ በፊት ይሞላሉ።",
    "checkIn": "መግባቨያ",
    "checkOut": "መውኘያ",
    "countNote": "የአጭር ጊዜ ማረፊያዎች በmakaug አጠቃላይ ንብረት ውስጥ ይቀጠራሉ።",
    "d1Body": "እያንዳንዱ ማረፊያ በእርስዎና በአስተናጋጁ መካከል በቀጥታ ይዘጋጃል። እኛ ወኪል፣ ደላላ ወይም የቆይታዎ አካል አይደለንም።",
    "d1Lead": "makaug ቦታ አያስይዝም እንዲሁም ገንዘብ አይዝም።",
    "d2Body": "አስተናጋጅ ቦታውን ከማየትዎ ወይም ማንነቱን ከማረጋገጥዎ በፊት ገንዘብ ከጠየቀ፣ ያቁሙ። ሰዎች የሚታለሉበት ዋነኛ መንገድ ይህ ነው።",
    "d2Lead": "ያላረጋገጡትን ሰው ቀብድ አይላኩ።",
    "d3Body": "makaug እያንዳንዱን ንብረት አይመረምርም፣ እያንዳንዱን ፎቶ አያረጋግጥም፣ እና ቦታው እንደተገለጸው መሆኑን፣ በሕጋዊ መንገድ መከራየቱን ወይም መገኘቱን ማረጋገጥ አይችልም።",
    "d3Lead": "አስተናጋጆች ማስታወቂያቸውን ራሳቸው ይጽፋሉ።",
    "d4Body": "በዚህ ጣቢያ የሚያዩት ማንኛውም ድምር አስተናጋጁ ካስቀመጠው ዋጋና እርስዎ ካስገቡት ቀን ተሰልቶ ነው። ግምት ነው፣ ዋጋ ማቅረቢያም ውልም አይደለም።",
    "d4Lead": "የሚታዩት ዋጋዎች የአስተናጋጁ ናቸው።",
    "d5Body": "መግቢያ፣ መውጫ፣ የተካተተው ነገር፣ ቀብዱና የተመላሽ ገንዘብ ደንቦች ሁሉ ከመክፈልዎ በፊት በጽሑፍ ይቀመጡ።",
    "d5Lead": "ሁኔታዎቹን በጽሑፍ ይስማሙ።",
    "d6Body": "በማንኛውም ማስታወቂያ ላይ ያለውን የማሳወቂያ አገናኝ ይጠቀሙ። ማስታወቂያዎችን እናነሳለን።",
    "d6Lead": "የተሳሳተ የሚመስል ማንኛውንም ነገር ያሳውቁ።",
    "days": "ቀናት",
    "discTitle": "ቦታውን ከማየትዎ በፊት በጭራሽ አይክፈሉ",
    "safetyMore": "ሁሉንም የደህንነት ምክሮች ያንብቡ",
    "infoLead": "ማወቅ የሚገቡ ስድስት ነገሮች።",
    "extrasPartnersNamed": "ስሞች ብቻ። makaug አርማዎቻቸውን አይጠቀምም። አገናኙ የአጋሩን ጣቢያ ይከፍታል።",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "ከእነዚህ ማጣሪያዎች ጋር የሚያይ የለም። ቀኑን ወይም አካባቢውን ያስፋሉ።",
    "emptyNone": "ዘንዱ የታተመ የአጭር ጊዜ ማረፊያ የለም። በዩጋንዳ በአንድ ሌሊት የሚያከሯዩት ቤት ካለዎት፣ በmakaug ይመዘግቡ።",
    "guests": "እንግዶች",
    "heroSub": "በይት እያንዳንዱ መክረየት የሚይዙ አፕርታሞች፣ ጎጀውች እና እንግዳ ማረፊያዎች። የአስተናጋጅ ምዝገባ ሁሉ ስልኩን ይዘል፣ ስለዚህ በቀጥታ ይነጋገሩ።",
    "heroTitle": "በዩጋንዳ የአጭር ጊዜ ማረፊያ ይፍልጉ",
    "hideMap": "ካርታ ደብቅ",
    "hrs": "ሰዓት",
    "i1B": "አብዛኞቹ ጎብኚዎች ቪዛ ያስፈልጋቸዋል፣ ዩጋንዳም ከጉዞ በፊት በመስመር ላይ ትሰጣለች። ወቅታዊ ደንቦችን ይመልከቱ እና በመንግሥት ኦፊሴላዊ ገጽ ያመልክቱ።",
    "i1L": "የዩጋንዳ ኢሚግሬሽን e-visa ገጽ",
    "i1T": "ቪዛና መግቢያ",
    "i2B": "በአገሪቱ ውስጥ ስለሚታዩና ስለሚደረጉ ነገሮች ኦፊሴላዊ ምንጭ።",
    "i2L": "utb.go.ug ይጎብኙ",
    "i2T": "Uganda Tourism Board",
    "i3B": "ሺሊንግ (UGX) የጥሬ ገንዘብና የሞባይል ገንዘብ አገር ነው። MTN Mobile Money እና Airtel Money ከሞላ ጎደል በሁሉም ቦታ ተቀባይነት አላቸው። ካርዶች በትላልቅ ሆቴሎችና ሞሎች ይሠራሉ፣ በሌላ ቦታ ግን ብዙም አይደለም።",
    "i3T": "ክፍያ መፈጸም",
    "i4B": "የካምፓላ ትራፊክ ከባድ ነው። የመኪና መጥሪያ መተግበሪያዎችና ቦዳ ቦዳዎች በከተማው ውስጥ ፈጣኑ መንገድ ናቸው። ለኢንቴቤ አውሮፕላን ማረፊያ ጉዞ፣ ዋጋውን ይስማሙ ወይም ከጉዞ በፊት መኪና ያስይዙ።",
    "i4T": "መዘዋወር",
    "i5B": "መቋረጥ ይከሰታል። አስተናጋጁን ስለ ተጠባባቂ ኃይል፣ የውሃ ታንክና የውሃ ጉድጓድ ይጠይቁ። እዚህ እያሉ መሥራት ካስፈለገዎት እነዚያንና Wi-Fi ይጠይቁ። ይህ ገጽ በእነዚህ አገልግሎቶች አያጣራም።",
    "i5T": "ኃይልና ውሃ",
    "i6B": "በዩጋንዳ የአጭር ጊዜ ማረፊያ በአንድ ክፍል በአንድ ሌሊት የአካባቢ ሆቴል ግብር ሊጣልበት ይችላል፣ በአካባቢው አስተዳደር ይሰበሰባል። ዋጋው ያካተተ መሆኑን አስተናጋጅዎን ይጠይቁ።",
    "i6T": "የአካባቢ ሆቴል ግብር",
    "infoTitle": "ወደ ዩጋንዳ ይመጣሉ? ማወቅ የሚገባ።",
    "kickOff": "ጨዋታው ይጀምራል",
    "listOwn": "ቤትዎን ይመይበቡ",
    "listPlace": "ቤትዎን ይመይበቡ",
    "loading": "እየጠነተነ ነው…",
    "mapFail": "ካርታው ሊጫን አልቻለም። ከታች ያለው ዝርዝር ሁሉንም ቤት ያሳያል።",
    "maxNight": "በአንድ ሌሊት በከፍተኛ",
    "min": "ደቂቃ",
    "newListing": "አዲስ",
    "partnerBadge": "ሆቴል",
    "partnerHeading": "በዩጋንዳ ያሉ ሆቴሎች",
    "partnerNote": "እነዚህ ሆቴሎች ከጉዞ አጋር የመጡ ሲሆን እንደ መመሪያ ይታያሉ። makaug አይዘርዝራቸውም፣ አይመረምራቸውም፣ አያስይዛቸውም፣ ዋጋም አያስቀምጥም። እዚህ ስልክ ቁጥር የለም። ዋጋ ይመልከቱ የሚለው ቁልፍ የሆቴል ቦታ ማስያዣ ምርት ሲበራ ብቻ ይታያል።",
    "partnerPriceAsk": "መመሪያ ብቻ። የቀጥታ ዋጋ እዚህ አይታይም።",
    "partnerReviews": "ግምገማዎች",
    "partnerVisit": "የሆቴሉ ድረ-ገጽ",
    "bookingCta": "ማረፊያ ይፈልጉ በ",
    "bookingNote": "በመላው ኡጋንዳ ተጨማሪ ሆቴሎችና አፓርታማዎች ከጉዞ አጋሮቻችን። ቦታ የሚይዙት በእነሱ ድረ-ገጽ ላይ ነው እንጂ ከmakaug ጋር አይደለም።",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "በ{town} እስካሁን ቦታ የለም",
    "comparePrices": "ዋጋዎችን ያወዳድሩ",
    "checkPrices": "ዋጋ ይመልከቱ",
    "affiliateDisclosure": "makaug ኮሚሽን ሊያገኝ ይችላል፤ ማስያዝና ክፍያውን በአጋር ጣቢያው ላይ ያደርጋሉ፣ እሱም ማስያዝዎን ያስተናግዳል",
    "indicative": "አመላካች",
    "hotelsTown": "የሆቴል መመሪያ · {town}",
    "hotelsFallback": "የሆቴል መመሪያ · ካምፓላ እና ኢንቴቤ",
    "showMore": "ተጨማሪ አሳይ",
    "alertWhatsapp": "ቦታ ሲዘረዝር በWhatsApp አሳውቀኝ",
    "searchHotels": "ሆቴሎችን ፈልግ",
    "adLabel": "ማስታወቂያ",
    "requestDates": "እነዚህን ቀናት ይጠይቁ",
    "paymentDirect": "ክፍያ በቀጥታ በእርስዎና በአስተናጋጁ መካከል ይስማማል። makaug ክፍያ አይወስድም አያቆይምም።",
    "feeAwaiting": "ጸድቋል፣ የወር UGX 20,000 ክፍያን ይጠብቃል። ነፃ ቀናት የሉም። የክፍያ አገናኝ ይከተላል። ክፍያው ሲከፈል ማስታወቂያው ይታያል።",
    "listFee": "ለተራ አስተዋዋቂዎች በወር UGX 20,000 ይከፈላል፣ ነፃ ቀናት የሉም። በተፈቀደ ወኪል የተዘረዘሩ አጭር ጊዜ ማረፊያዎች በወኪል ፓኬጅ (በወር UGX 50,000) ውስጥ ይካተታሉ።",
    "termsTitle": "የአጭር ቆይታ ውሎች",
    "termsBody": "makaug ቦታውን ይዘረዝራል፣ የሚችለውን ይመረምራል፣ እንግዳውንና አስተናጋጁን ያገናኛል። አስተናጋጁ ለቆይታው፣ ለደህንነት፣ ለፈቃድ፣ ለግብርና ለተመላሽ ገንዘብ ተጠያቂ ነው።",
    "termsLawyer": "እነዚህ ውሎች እንደ መጨረሻ ከመቆጠራቸው በፊት የኡጋንዳ ጠበቃ ሊገመግማቸው ይገባል።",
    "verifiedStay": "የተረጋገጠ ቆይታ",
    "safetyView": "ቦታውን ይመልከቱ እና ከመክፈልዎ በፊት ለማን እንደሚከፍሉ ያረጋግጡ።",
    "safetyName": "ወደ ሌላ ስም ወዳለው አካውንት በጭራሽ አይክፈሉ።",
    "safetyReport": "የተሳሳተ ነገር ካለ ከማስታወቂያው ላይ ችግሩን ያሳውቁ።",
    "extrasTitle": "ቀሪውን ጉዞ ያቅዱ",
    "extrasLead": "በአጋር ጣቢያው ላይ ይከፈታል። makaug ቦታ አያስይዝም እንዲሁም ክፍያ አይቀበልም።",
    "extrasNote": "የአጋር አገናኞች፦ MakaUG ኮሚሽን ሊያገኝ ይችላል",
    "extrasTransfers": "የአየር ማረፊያ መጓጓዣ",
    "extrasEsims": "ኢሲም ካርዶች",
    "extrasTours": "ጉብኝቶች እና እንቅስቃሴዎች",
    "extrasCars": "የመኪና ኪራይ",
    "extrasFlights": "በረራዎች"
  },
  "ar": {
    "adCtaFind": "ابحث عن إقامة",
    "adHeadline": "أوغندا تستضيف. الغرف تنفد مبكراً.",
    "adSub": "كمبالا وإنتيبي وجينجا تمتلئ قبل انطلاق البطولة بوقت طويل.",
    "checkIn": "تاريخ الوصول",
    "checkOut": "تاريخ المغادرة",
    "countNote": "تُحتسب الإقامات القصيرة ضمن إجمالي عقارات makaug.",
    "d1Body": "كل إقامة هنا تُرتَّب مباشرة بينك وبين المضيف. نحن لسنا وكيلاً ولا وسيطاً ولا طرفاً في إقامتك.",
    "d1Lead": "makaug لا تتلقى الحجوزات ولا تتعامل بالأموال.",
    "d2Body": "إذا طلب منك المضيف مالاً قبل أن ترى المكان أو تتأكد من هويته، توقف. هذه أكثر الطرق شيوعاً لخداع الناس.",
    "d2Lead": "لا ترسل عربوناً لشخص لم تتحقق منه.",
    "d3Body": "makaug لا تعاين كل عقار، ولا تفحص كل صورة، ولا يمكنها ضمان أن المكان كما وُصف، أو أنه مؤجَّر بشكل قانوني، أو أنه متاح.",
    "d3Lead": "المضيفون يكتبون إعلاناتهم بأنفسهم.",
    "d4Body": "أي إجمالي تراه على هذا الموقع محسوب من السعر الذي نشره المضيف والتواريخ التي أدخلتها. هو تقدير، وليس عرض سعر ولا عقداً.",
    "d4Lead": "الأسعار المعروضة هي أسعار المضيف.",
    "d5Body": "موعد الوصول والمغادرة، وما هو مشمول، والعربون، وقواعد الاسترداد، كلها يجب أن تُكتب قبل أن تدفع أي شيء.",
    "d5Lead": "اتفقا على الشروط كتابةً.",
    "d6Body": "استخدم رابط الإبلاغ في أي إعلان. نحن نزيل الإعلانات.",
    "d6Lead": "أبلغ عن أي شيء يبدو غير صحيح.",
    "days": "يوم",
    "discTitle": "لا تدفع أبداً قبل أن ترى المكان",
    "safetyMore": "اقرأ كل نصائح السلامة",
    "infoLead": "ستة أمور تستحق أن تعرفها.",
    "extrasPartnersNamed": "الأسماء فقط. makaug لا تستخدم شعاراتهم. الرابط يفتح موقع الشريك.",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "لا يوجد ما يطابق هذه الفلاتر بعد. جرّب توسيع التواريخ أو المنطقة.",
    "emptyNone": "لم يُنشر أي مكان للإقامة القصيرة بعد. إذا كان لديك مكان في أوغندا تؤجّره بالليلة، أضفه على makaug.",
    "guests": "الضيوف",
    "heroSub": "شقق وبيوت ريفية وبيوت ضيافة يمكنك حجزها بالليلة، وكل إعلان من مضيف يحمل رقم هاتفه لتتعامل معه مباشرة.",
    "heroTitle": "ابحث عن إقامة قصيرة في أوغندا",
    "hideMap": "إخفاء الخريطة",
    "hrs": "ساعة",
    "i1B": "معظم الزوار يحتاجون تأشيرة، وأوغندا تصدرها عبر الإنترنت قبل السفر. راجع القواعد الحالية وقدّم الطلب على البوابة الحكومية الرسمية.",
    "i1L": "بوابة التأشيرة الإلكترونية للهجرة الأوغندية",
    "i1T": "التأشيرات والدخول",
    "i2B": "المصدر الرسمي لما يمكن رؤيته وعمله في أنحاء البلاد.",
    "i2L": "زر utb.go.ug",
    "i2T": "Uganda Tourism Board",
    "i3B": "الشلن (UGX) بلد النقد والمحفظة عبر الهاتف. MTN Mobile Money و Airtel Money مقبولان في كل مكان تقريباً. البطاقات تعمل في الفنادق والمولات الكبيرة، وأقل من ذلك في غيرها.",
    "i3T": "الدفع",
    "i4B": "الازدحام في كمبالا شديد. تطبيقات طلب السيارات والبودا بودا أسرع وسيلة للتنقل في المدينة. لرحلات مطار إنتيبي، اتفق على الأجرة أو احجز السيارة قبل السفر.",
    "i4T": "التنقل",
    "i5B": "الانقطاعات تحدث. اسأل المضيف عن مولد احتياطي وخزان ماء وبئر. إذا كنت تحتاج للعمل أثناء وجودك، فاسأل عن ذلك وعن الواي فاي. هذه الصفحة لا تصفّي حسب هذه الخدمات.",
    "i5T": "الكهرباء والماء",
    "i6B": "قد تخضع أماكن الإقامة القصيرة في أوغندا لضريبة فنادق محلية لكل غرفة لكل ليلة، تجبيها السلطة المحلية. اسأل مضيفك إن كان سعره يشملها.",
    "i6T": "ضريبة الفنادق المحلية",
    "infoTitle": "قادم إلى أوغندا؟ يستحق أن تعرفه.",
    "kickOff": "انطلاق البطولة",
    "listOwn": "أضف مكانك",
    "listPlace": "أضف مكانك",
    "loading": "جارٍ التحميل…",
    "mapFail": "تعذّر تحميل الخريطة. القائمة أدناه تعرض كل الأماكن.",
    "maxNight": "أقصى سعر لليلة",
    "min": "دقيقة",
    "newListing": "جديد",
    "partnerBadge": "فندق",
    "partnerHeading": "فنادق في أوغندا",
    "partnerNote": "هذه فنادق من شريك سفر وتُعرض كدليل فقط. makaug لا تدرجها ولا تعاينها ولا تحجزها ولا تحدد سعرها. لا يظهر رقم هاتف هنا. يظهر زر تحقق من الأسعار فقط عندما تُفعَّل علامة تجارية لحجز الفنادق.",
    "partnerPriceAsk": "دليل فقط. لا يُعرض سعر مباشر هنا.",
    "partnerReviews": "تقييم",
    "partnerVisit": "موقع الفندق",
    "bookingCta": "ابحث عن إقامة على",
    "bookingNote": "مزيد من الفنادق والشقق في أنحاء أوغندا من شركائنا في السفر. الحجز يتم على موقعهم وليس مع makaug.",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "لا أماكن في {town} بعد",
    "comparePrices": "قارن الأسعار",
    "checkPrices": "تحقق من الأسعار",
    "affiliateDisclosure": "قد تربح makaug عمولة؛ تحجز وتدفع على موقع الشريك، وهو الذي يتولى حجزك",
    "indicative": "إرشادي",
    "hotelsTown": "دليل فنادق · {town}",
    "hotelsFallback": "دليل فنادق · كمبالا وإنتيبي",
    "showMore": "أظهر المزيد",
    "alertWhatsapp": "نبهني على واتساب عند إدراج مكان",
    "searchHotels": "ابحث عن فنادق",
    "adLabel": "إعلان",
    "requestDates": "اطلب هذه التواريخ",
    "paymentDirect": "يُتفق على الدفع مباشرة بينك وبين المضيف. makaug لا تقبض المدفوعات ولا تحتجزها.",
    "feeAwaiting": "مقبول، بانتظار رسوم UGX 20,000 الشهرية. لا أيام مجانية. يلي ذلك رابط الدفع. يظهر الإعلان عند دفع الرسوم.",
    "listFee": "المعلنون العاديون يدفعون UGX 20,000 شهرياً، بلا أيام مجانية. الإقامات القصيرة لوكيل معتمد مشمولة في باقة الوكيل (UGX 50,000 شهرياً).",
    "termsTitle": "شروط الإقامة القصيرة",
    "termsBody": "تعرض makaug المكان وتراجع ما تستطيع وتعرّف الضيف بالمضيف. المضيف مسؤول عن الإقامة والسلامة والتراخيص والضريبة والاسترداد.",
    "termsLawyer": "ينبغي لمحامٍ أوغندي مراجعة هذه الشروط قبل اعتبارها نهائية.",
    "verifiedStay": "إقامة موثّقة",
    "safetyView": "عاين المكان وتأكد ممن تدفع له قبل أن تدفع.",
    "safetyName": "لا تدفع إلى حساب باسم مختلف.",
    "safetyReport": "أبلغ عن مشكلة من صفحة الإعلان إذا كان هناك خطأ.",
    "extrasTitle": "خطط لبقية رحلتك",
    "extrasLead": "يفتح على موقع الشريك. makaug لا تتولى الحجز ولا الدفع.",
    "extrasNote": "روابط تابعة: قد تربح MakaUG عمولة",
    "extrasTransfers": "توصيلات المطار",
    "extrasEsims": "شرائح eSIM",
    "extrasTours": "جولات وأنشطة",
    "extrasCars": "تأجير سيارات",
    "extrasFlights": "رحلات جوية"
  },
  "en": {
    "adCtaFind": "Find a stay",
    "adHeadline": "Uganda hosts. Rooms go early.",
    "adSub": "Kampala, Entebbe and Jinja fill up long before kick-off.",
    "checkIn": "Check in",
    "checkOut": "Check out",
    "countNote": "Short stays are counted in the makaug property total.",
    "d1Body": "Every short stay here is arranged directly between you and the host. We are not an agent, a broker or a party to your stay.",
    "d1Lead": "makaug does not take bookings and does not handle money.",
    "d2Body": "If a host asks for money before you have seen the place or confirmed who they are, stop. That is the single most common way people get cheated.",
    "d2Lead": "Never send a deposit to someone you have not verified.",
    "d3Body": "makaug does not inspect every property, does not check every photo and cannot guarantee that a place is as described, is legally let, or is available.",
    "d3Lead": "Hosts write their own listings.",
    "d4Body": "Any total you see on this site is worked out from the host's published rate and the dates you typed. It is an estimate, not a quote and not a contract.",
    "d4Lead": "Prices shown are the host's.",
    "d5Body": "Check-in, check-out, what is included, the deposit and the refund rules should all be written down before you pay anything.",
    "d5Lead": "Agree the terms in writing.",
    "d6Body": "Use the report link on any listing. We take listings down.",
    "d6Lead": "Report anything that looks wrong.",
    "days": "days",
    "discTitle": "Never pay before you've seen the place",
    "safetyMore": "Read all safety tips",
    "infoLead": "Six things worth knowing.",
    "extrasPartnersNamed": "Partner names only. makaug does not use their logos. A link opens the partner site.",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "Nothing matches those filters yet. Try widening the dates or the area.",
    "emptyNone": "No short stays are published yet. If you have a place in Uganda that you rent by the night, list it on makaug.",
    "guests": "Guests",
    "heroSub": "Apartments, cottages and guest houses you can take by the night. Every listing from a host carries their own phone number, so you deal with them directly.",
    "heroTitle": "Find a short stay in Uganda",
    "hideMap": "Hide map",
    "hrs": "hrs",
    "i1B": "Most visitors need a visa, and Uganda issues them online before travel. Check the current rules and apply on the official government portal.",
    "i1L": "Uganda immigration e-visa portal",
    "i1T": "Visas and entry",
    "i2B": "The official source for what to see and do across the country.",
    "i2L": "Visit utb.go.ug",
    "i2T": "Uganda Tourism Board",
    "i3B": "The shilling (UGX) is cash and mobile money country. MTN Mobile Money and Airtel Money are accepted almost everywhere. Cards work in larger hotels and malls, less so elsewhere.",
    "i3T": "Paying for things",
    "i4B": "Kampala traffic is heavy. Ride-hailing apps and boda bodas are the quickest way across town. For Entebbe airport runs, agree the fare or book the car before you travel.",
    "i4T": "Getting around",
    "i5B": "Cuts happen. Ask the host about backup power, a water tank and a borehole. If you need to work while you are here, ask about those and about Wi-Fi. This page does not filter by those amenities.",
    "i5T": "Power and water",
    "i6B": "Short stay accommodation in Uganda can attract a local hotel tax per room per night, collected by the local authority. Ask your host whether their rate includes it.",
    "i6T": "Local hotel tax",
    "infoTitle": "Coming to Uganda? Worth knowing.",
    "kickOff": "Kick-off",
    "listOwn": "List your own place",
    "listPlace": "List your place",
    "loading": "Loading short stays…",
    "mapFail": "The map could not load. The list below shows every place.",
    "maxNight": "Max per night",
    "min": "min",
    "newListing": "New listing",
    "partnerBadge": "Hotel",
    "partnerHeading": "Hotels in Uganda",
    "partnerNote": "These hotels come from a travel partner and are shown as a guide. makaug does not list, inspect, book or set their price. No phone number is shown here. Check prices appears only when a hotel booking brand is switched on.",
    "partnerPriceAsk": "Guide only. A live price is not shown here.",
    "partnerReviews": "reviews",
    "partnerVisit": "Hotel's own site",
    "bookingCta": "Search stays on",
    "bookingNote": "More hotels and apartments across Uganda from our travel partners. You book on their site, not with makaug.",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "No places in {town} yet",
    "comparePrices": "Compare prices",
    "checkPrices": "Check prices",
    "affiliateDisclosure": "makaug may earn a commission; you book and pay on the partner site, which handles your booking",
    "indicative": "indicative",
    "hotelsTown": "Hotel guide · {town}",
    "hotelsFallback": "Hotel guide · Kampala & Entebbe",
    "showMore": "Show more",
    "alertWhatsapp": "Alert me on WhatsApp when a place is listed",
    "searchHotels": "Search hotels",
    "adLabel": "Ad",
    "requestDates": "Request these dates",
    "paymentDirect": "Payment is agreed directly between you and the host. makaug does not take or hold payments.",
    "feeAwaiting": "Approved, awaiting the UGX 20,000 monthly fee. No free days. A pay link follows. The listing goes live when that fee is paid.",
    "listFee": "Ordinary listers pay UGX 20,000 a month, with no free days. Short stays listed by an approved agent are included in the agent plan (UGX 50,000 a month).",
    "termsTitle": "Short stay terms",
    "termsBody": "makaug lists the place, checks what it can, and introduces the guest and the host. The host is responsible for the stay, for safety, for licences, for tax and for refunds.",
    "termsLawyer": "A Ugandan lawyer should review these terms before they are treated as final.",
    "verifiedStay": "Verified stay",
    "safetyView": "View the place and confirm who you are paying before you pay.",
    "safetyName": "Never pay into an account in a different name.",
    "safetyReport": "Report a problem from the listing if something is wrong.",
    "extrasTitle": "Plan the rest of your trip",
    "extrasLead": "Opens on the partner site. makaug does not take the booking or the payment.",
    "extrasNote": "Affiliate links: MakaUG may earn a commission",
    "extrasTransfers": "Airport transfers",
    "extrasEsims": "eSIMs",
    "extrasTours": "Tours and activities",
    "extrasCars": "Car rental",
    "extrasFlights": "Flights"
  },
  "lg": {
    "adCtaFind": "Noonya we onoosula",
    "adHeadline": "Uganda y'eyakuŋŋaanyiza. Ebifo biggwaawo mangu.",
    "adSub": "Kampala, Entebbe ne Jinja zijjula nga tekinnatuuka.",
    "checkIn": "Lw'oyingira",
    "checkOut": "Lw'ofuluma",
    "countNote": "Ebifo eby'okusula bibalirwa mu muwendo gwa makaug ogw'ebintu byonna.",
    "d1Body": "Buli kifo eky'okusula kiteekebwateekebwa wakati wo ne nnyini kifo. Tetuli agent, broker oba omuntu ali mu ndagaano yammwe.",
    "d1Lead": "makaug tekkiriza booking era tekwata ssente.",
    "d2Body": "Singa nnyini kifo akusaba ssente nga tonnalaba kifo oba nga tonnakakasa gw'ali, yimirira. Eno y'engeri esinga abantu gye babbibwamu.",
    "d2Lead": "Toweereza deposit eri omuntu gw'otakakakasa.",
    "d3Body": "makaug tekebera buli kifo, tekebera buli kifaananyi, era tesobola kukakasa nti ekifo kiri nga bwe kyogeddwa, kipangisibwa mu mateeka, oba nti kiriwo.",
    "d3Lead": "Bannyini bifo be bawandiika listing zaabwe.",
    "d4Body": "Omuwendo gwonna gw'olaba ku mukutu guno gubalirwa okuva ku muwendo nnyini kifo gwe yateeka n'ennaku z'owandiise. Gwe gwa kuteebereza, si quote era si ndagaano.",
    "d4Lead": "Emiwendo egiraga gya nnyini kifo.",
    "d5Body": "Lw'oyingira, lw'ofuluma, ebiri mu, deposit n'amateeka g'okuzzaayo ssente byonna biwandiikibwe nga tonnasasula.",
    "d5Lead": "Mukkiriziganye ku miteeka mu buwandiike.",
    "d6Body": "Kozesa report link ku listing yonna. Tuggyawo listing.",
    "d6Lead": "Tutegeeze ku buli kintu ekitali kituufu.",
    "days": "ennaku",
    "discTitle": "Totuusa nga tonnalaba ekifo",
    "safetyMore": "Soma ebyokwerinda byonna",
    "infoLead": "Ebintu mukaaga ebikulu okumanya.",
    "extrasPartnersNamed": "Amanya gokka. makaug tekozesebwa logo zaabwe. Link egulawo ekibanja ky'omukago.",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "Tewali kituukagana na filters zino. Gezaako okugaziya ennaku oba ekitundu.",
    "emptyNone": "Tewannabaawo bifo bya kusula bifulumiziddwa. Bw'oba olina ekifo mu Uganda ky'opangisa buli kiro, kiteeke ku makaug.",
    "guests": "Abagenyi",
    "heroSub": "Apartments, cottages ne guest houses z'oyinza okupangisa buli kiro. Buli listing ya nnyini kifo erina namba ya ssimu ye, okolagane naye butereevu.",
    "heroTitle": "Noonya we onoosula mu Uganda",
    "hideMap": "Kweka maapu",
    "hrs": "essaawa",
    "i1B": "Abagenyi abasinga beetaaga viza, era Uganda egiwa ku mutimbagano nga tonnatambula. Kebera amateeka agaliwo kati osabire ku mukutu gwa gavumenti.",
    "i1L": "Omukutu gwa Uganda immigration ogwa e-visa",
    "i1T": "Viza n'okuyingira",
    "i2B": "Ensibuko entongole ey'ebyo by'oyinza okulaba n'okukola mu ggwanga.",
    "i2L": "Genda ku utb.go.ug",
    "i2T": "Uganda Tourism Board",
    "i3B": "Ssiringi (UGX) y'ekozesebwa mu ssente enkalu ne mobile money. MTN Mobile Money ne Airtel Money bikkirizibwa wonna awantu. Cards zikola mu wooteeri n'amaduuka amanene, so si wonna.",
    "i3T": "Okusasula",
    "i4B": "Kampala erimu traffic nnyingi. Apps z'okuyita emmotoka ne boda boda ze zisinga obwangu mu kibuga. Ku lugendo lw'e Entebbe airport, mukkiriziganye ku muwendo oba obooke emmotoka nga tonnatambula.",
    "i4T": "Okutambula",
    "i5B": "Amasanyalaze gasalibwako. Buuza nnyini kifo ku masanyalaze ag'eddagala, ttanka y'amazzi ne borehole. Bw'oba oyagala okukola ng'oli wano, buuza ku ebyo ne Wi-Fi. Omuko guno tegusunsula ku bikozesebwa ebyo.",
    "i5T": "Amasannyalaze n'amazzi",
    "i6B": "Ebifo eby'okusula mu Uganda biyinza okusasulirwa omusolo gwa hotel buli kisenge buli kiro, ogusoloozebwa ab'ekitundu. Buuza nnyini kifo oba omuwendo gwe gugutwalidde.",
    "i6T": "Omusolo gwa hotel ogw'ekitundu",
    "infoTitle": "Ojja mu Uganda? Bino bikulu okumanya.",
    "kickOff": "Omuzannyo gutandika",
    "listOwn": "Teeka ekifo kyo",
    "listPlace": "Teeka ekifo kyo",
    "loading": "Tunoonya…",
    "mapFail": "Maapu tezikoze. Olukalala wansi lulaga ebifo byonna.",
    "maxNight": "Ssente ku kiro",
    "min": "eddakiika",
    "newListing": "Empya",
    "partnerBadge": "Wooteeri",
    "partnerHeading": "Wooteeri mu Uganda",
    "partnerNote": "Bino wooteeri okuva ku mukago gw'okutambula, era biragibwa nga ekkubo. makaug tebiteeka, tebikebera, tebibooka era tebissa ebiwendo. Tewali namba ya ssimu wano. Akabumba ka Check prices kalabika brand ya wooteeri bw'eba nga eyaka.",
    "partnerPriceAsk": "Kkubo kwokka. Omuwendo ogulabika tegulagibwa wano.",
    "partnerReviews": "endowooza",
    "partnerVisit": "Omukutu gwa wooteeri",
    "bookingCta": "Noonya ebifo ku",
    "bookingNote": "Wooteeri n'ennyumba endala mu Uganda yonna okuva mu bakolagana naffe. Okukwata ekifo okikola ku mukutu gwabwe, si ne makaug.",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "Tewali bifo mu {town} kaakano",
    "comparePrices": "Geraageranya ebiwendo",
    "checkPrices": "Kebera ebiwendo",
    "affiliateDisclosure": "makaug eyinza okufuna komissioni; booka era osasule ku mukutu gw'omukago, ogukola booking yo",
    "indicative": "ogulaga",
    "hotelsTown": "Ekkubo lya wooteeri · {town}",
    "hotelsFallback": "Ekkubo lya wooteeri · Kampala ne Entebbe",
    "showMore": "Laba ebirala",
    "alertWhatsapp": "Mpulize ku WhatsApp nga ekifo kiteekeddwa",
    "searchHotels": "Noonya wooteeri",
    "adLabel": "Katale",
    "requestDates": "Saba ennaku zino",
    "paymentDirect": "Okusasula mukkiriziganya wakati wo n’omunyumba. makaug tewamba era tewakuma ssente.",
    "feeAwaiting": "Kikkiriziddwa, kussuubira ssente eza UGX 20,000 buli mwezi. Tewali nnaku za bwereere. Akayungirizi k’okusasula kajja. Listing egenda ku lwebbanga ssente bwe zisasulwa.",
    "listFee": "Abateeka abatali ba agent basasula UGX 20,000 buli mwezi, tewali nnaku za bwereere. Short stays ez'agent eyakkirizibwa ziri mu pulani ya agent (UGX 50,000 buli mwezi).",
    "termsTitle": "Obukwakkulizo bw’okusula okumpi",
    "termsBody": "makaug ewandiika ekifo, ekebera ky’esobola, n’ateeka omugenyi n’omunyumba awamu. Omunyumba ye alina obuvunaanyizibwa ku kusula, obukuumi, layisinsi, musolo n’okuzza ssente.",
    "termsLawyer": "Munnamateeka wa Uganda asaanye akebere obukwakkulizo buno nga tebunnakolebwa nga bwe bujjuvu.",
    "verifiedStay": "Okusula okukakasiddwa",
    "safetyView": "Labako ekifo era okakase ani gw’osasula nga tonnasasula.",
    "safetyName": "Tosasula ku akawunti erina erinnya eddala.",
    "safetyReport": "Loopa ekizibu okuva ku listing singa waliwo ekikyamu.",
    "extrasTitle": "Tekateeka olugendo olusigadde",
    "extrasLead": "Gulawo ku mukutu gw'omukago. makaug tewera booking era tefuna ssente.",
    "extrasNote": "Link za affiliate: MakaUG eyinza okufuna komissioni",
    "extrasTransfers": "Okutwalibwa okuva ku kisaawe ky'ennyonyi",
    "extrasEsims": "ekaada eSIM",
    "extrasTours": "Obulambuzi n'emirimu",
    "extrasCars": "Okupangisa emmotoka",
    "extrasFlights": "Ennyonyi"
  },
  "ny": {
    "adCtaFind": "Sherura ekyanya",
    "adHeadline": "Uganda niyo erikwakiira. Ebyanya nibihwaho juba.",
    "adSub": "Kampala, Entebbe na Jinja nibijura obutakaba omuzaano gutandika.",
    "checkIn": "Okutaaha",
    "checkOut": "Okuruga",
    "countNote": "Ebyanya by'okuraara nibibariirwa omu muhendo gwa makaug gwona.",
    "d1Body": "Buri kyanya ky'okuraara nikiteekwa ahagati yaawe na nyineeka. Titurikuba agent, broker nari orikwejumba omu ndagaano yaanyu.",
    "d1Lead": "makaug tetwakira booking kandi tetukwata sente.",
    "d2Body": "Ku nyineeka arikukushaba sente otakareebire ekyanya nari otakahamize ou ari, hagarara. Egi niyo mihanda erikukiraho abantu ei barikubibwamu.",
    "d2Lead": "Otatumira deposit omuntu ou otakahamize.",
    "d3Body": "makaug tekyebera buri nju, tekyebera buri kishushani, kandi tekibaasa kuhamya ngu ekyanya kiri nk'oku kyagambirwe, nikipangisibwa omu mateeka, nari ngu kiriho.",
    "d3Lead": "Banyineeka nibo barikuhandiika listing zaabo.",
    "d4Body": "Omuhendo gwoona ogu orikureeba aha rubaju oru nigubariirwa kuruga aha muhendo ogu nyineeka yateireho n'ebiro ebi ohandiise. Ni kuteekateeka, ti quote kandi ti ndagaano.",
    "d4Lead": "Emiheendo erikworekwa n'eya nyineeka.",
    "d5Body": "Okutaaha, okuruga, ebirimu, deposit n'ebiragiro by'okugarura sente byona bihandiikwe otakashashuriire kintu.",
    "d5Lead": "Mwikirizanise aha mateeka omu buhandiike.",
    "d6Body": "Koresa report link aha listing yoona. Nitwihaho listing.",
    "d6Lead": "Tugambire aha kintu kyoona ekitari kirungi.",
    "days": "ebiro",
    "discTitle": "Otarashashura otarareeba ekifo",
    "safetyMore": "Shoma eby'okwerinda byona",
    "infoLead": "Ebintu mukaaga ebikuru okumanya.",
    "extrasPartnersNamed": "Amaziina goka. makaug tekoresa logo zaabo. Link neihura orubaju rw'omunywani.",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "Tihariho ekirikuhikaana n'ebi. Gyezaho kwongyera ebiro nari ekicweka.",
    "emptyNone": "Tihariho byanya by'okuraara ebitairwe. Ku oine ekyanya omu Uganda eki orikupangisa buri kiro, kite aha makaug.",
    "guests": "Abashuhuki",
    "heroSub": "Apartments, cottages na guest houses ez'orikubaasa kutwara buri kiro. Buri listing ya nyineeka eine namba ya esimu ye, orikukora nawe butunguuka.",
    "heroTitle": "Sherura ekyanya ky'okuraara omu Uganda",
    "hideMap": "Shereka mapu",
    "hrs": "eshaaha",
    "i1B": "Abashuhuki baingi nibetenga viza, kandi Uganda neegiheereza aha internet otakagyenzire. Reeba ebiragiro ebiriho hati oshabire aha rubaju rwa gavumenti.",
    "i1L": "Orubaju rwa Uganda immigration orwa e-visa",
    "i1T": "Viza n'okutaaha",
    "i2B": "Enshuruuro ya gavumenti y'ebi orikubaasa kureeba n'okukora omu ihanga ryoona.",
    "i2L": "Genda aha utb.go.ug",
    "i2T": "Uganda Tourism Board",
    "i3B": "Shilingi (UGX) n'eihanga rya sente n'eza mobile money. MTN Mobile Money na Airtel Money nibyakiirwa hoona. Card nizikora omu hotel enkuru n'omu mall, kwonka ti hoona.",
    "i3T": "Okushashura",
    "i4B": "Kampala eine emotoka nyingi. App z'okweta emotoka na boda boda nizo zirikukira obwangu omu rurembo. Aha rugyendo rwa Entebbe airport, mwikirizanise aha muhendo nari obooke emotoka otakagyenzire.",
    "i4T": "Okugyenda",
    "i5B": "Nibicwekyerera. Buuza nyineeka aha backup power, itanka ry'amaizi na borehole. Ku orikwenda kukora ori aha, buuza ebyo na Wi-Fi. Orupapura oru tirukusherura na ebyo.",
    "i5T": "Amasyanyarazi n'amaizi",
    "i6B": "Ebyanya by'okuraara omu Uganda nibibaasa kushashura omushoro gwa hotel aha kyumba buri kiro, ogurikukwatwa abakuru b'ekicweka. Buuza nyineeka ku omuhendo gwe gurimu.",
    "i6T": "Omushoro gwa hotel ogw'ekicweka",
    "infoTitle": "Noija omu Uganda? Ebi nibimanywa.",
    "kickOff": "Omuzaano nigutandika",
    "listOwn": "Ta ekyanya kyawe",
    "listPlace": "Ta ekyanya kyawe",
    "loading": "Nitusherura…",
    "mapFail": "Mapu tiyabaasa kwija. Orutindo rw'ahansi nirworeka ebyanya byona.",
    "maxNight": "Esente aha kiro",
    "min": "edakiika",
    "newListing": "Ensya",
    "partnerBadge": "Hoteeri",
    "partnerHeading": "Hotel omu Uganda",
    "partnerNote": "Ebi n'ehotel kuruga aha munywani w'orugyendo, kandi nizoreka nk'ekiragiro. makaug tekizita, tekizyebera, tekizibooka kandi tekita omuhendo. Enamba y'esimu tiri aha. Akabumba ka Check prices nikareeba brand y'ehotel yaba eyashweirwe.",
    "partnerPriceAsk": "Ekiragiro kyoka. Omuhendo oguriho tigurikworeka aha.",
    "partnerReviews": "ebiteekateeko",
    "partnerVisit": "Orubaju rwa hotel",
    "bookingCta": "Shaka ahu kuraara aha",
    "bookingNote": "Hoteeri n'amaju agandi omuri Uganda yoona okuruga aha bagenzi baitu. Okukwata omwanya nokukora aha rubaju rwabo, tikiri na makaug.",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "Tihariho bifo omu {town} hati",
    "comparePrices": "Gyeragyerania emihendo",
    "checkPrices": "Rora emihendo",
    "affiliateDisclosure": "makaug neyija kutunga komishoni; obooka kandi oshashure aha mukutu gw'omunywani, ogukora booking yaawe",
    "indicative": "ogurikworeka",
    "hotelsTown": "Ekiragiro ky'ehotel · {town}",
    "hotelsFallback": "Ekiragiro ky'ehotel · Kampala na Entebbe",
    "showMore": "Yoreka ebindi",
    "alertWhatsapp": "Mmanyise aha WhatsApp ahakuba ekifo kikateekwa",
    "searchHotels": "Sherura ehotel",
    "adLabel": "Katale ya ny",
    "requestDates": "Saba ebiro ebi",
    "paymentDirect": "Okuhereza nikwikirizanwa ahagati yawe n’omunyini. makaug teyakira era teyakwata sente.",
    "feeAwaiting": "Kwikirizibwe, nikurinda sente eza UGX 20,000 buri kwezi. Tihari ebiro bya busha. Akakwate k’okuhereza nikija. Listing neegenda omumaisho sente zihereirwe.",
    "listFee": "Abatari agent baherera UGX 20,000 buri kwezi, tihari ebiro bya busha. Short stays z'agent eyikirizibwe ziri omu plan ya agent (UGX 50,000 buri kwezi).",
    "termsTitle": "Ebiragiro by’okuraara okuhango",
    "termsBody": "makaug nehandiika ahantu, nekebera eky’esobora, n’egaita omugenyi n’omunyini. Omunyini niwe aine obuvunanyizibwa aha kuraara, obukuumi, layisensi, omusolo n’okugarura sente.",
    "termsLawyer": "Munnamateeka wa Uganda asaana akeberere ebiragiro ebi otarikubikozesa nk’ebyaheru.",
    "verifiedStay": "Okuraara okukakasibwe",
    "safetyView": "Rora ahantu kandi okakase ou orikuha sente otaraherereza.",
    "safetyName": "Otarahereza aha akaunti eine izina rindi.",
    "safetyReport": "Tebeeka ekizibu kuruga aha listing ku orikureeba ekitarikwikiriza.",
    "extrasTitle": "Teekateeka orugyendo orusigaire",
    "extrasLead": "Ahingurwa aha mukutu gw'omunywani. makaug tekora booking kandi tekwata sente.",
    "extrasNote": "Link z'abafatanyabikorwa: MakaUG neyija kutunga komishoni",
    "extrasTransfers": "Okutwarwa kuruga aha kisaawe ky'ennyonyi",
    "extrasEsims": "ekaada eSIM",
    "extrasTours": "Obulambuzi n'emirimo",
    "extrasCars": "Okupangisa emotoka",
    "extrasFlights": "Enyonyi"
  },
  "rn": {
    "adCtaFind": "Sherura ahantu",
    "adHeadline": "Uganda niyo erikwakiira. Ahantu nihahwaho juba.",
    "adSub": "Kampala, Entebbe na Jinja nibijura obutakaba omuzaano gutandika.",
    "checkIn": "Okutaaha",
    "checkOut": "Okuruga",
    "countNote": "Ahantu h'okuraara nihabariirwa omu muhendo gwa makaug gwona.",
    "d1Body": "Buri hantu h'okuraara nihateekwa ahagati yaawe na nyineeka. Titurikuba agent, broker nari orikwejumba omu ndagaano yaanyu.",
    "d1Lead": "makaug tetwakira booking kandi tetukwata sente.",
    "d2Body": "Ku nyineeka arikukushaba sente otakareebire ahantu nari otakahamize ou ari, hagarara. Egi niyo mihanda erikukiraho abantu ei barikubibwamu.",
    "d2Lead": "Otatumira deposit omuntu ou otakahamize.",
    "d3Body": "makaug tekyebera buri nju, tekyebera buri kishushani, kandi tekibaasa kuhamya ngu ahantu hari nk'oku hagambirwe, nihapangisibwa omu mateeka, nari ngu hariho.",
    "d3Lead": "Banyineeka nibo barikuhandiika listing zaabo.",
    "d4Body": "Omuhendo gwoona ogu orikureeba aha rubaju oru nigubariirwa kuruga aha muhendo ogu nyineeka yateireho n'ebiro ebi ohandiise. Ni kuteekateeka, ti quote kandi ti ndagaano.",
    "d4Lead": "Emiheendo erikworekwa n'eya nyineeka.",
    "d5Body": "Okutaaha, okuruga, ebirimu, deposit n'ebiragiro by'okugarura sente byona bihandiikwe otakashashuriire kintu.",
    "d5Lead": "Mwikirizanise aha mateeka omu buhandiike.",
    "d6Body": "Koresa report link aha listing yoona. Nitwihaho listing.",
    "d6Lead": "Tugambire aha kintu kyoona ekitari kirungi.",
    "days": "ebiro",
    "discTitle": "Otarashashura otarareeba ekifo",
    "safetyMore": "Shoma eby'okwerinda byona",
    "infoLead": "Ebintu mukaaga ebikuru okumanya.",
    "extrasPartnersNamed": "Amaziina goka. makaug tekoresa logo zaabo. Link neihura orubaju rw'omunywani.",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "Tihariho ekirikuhikaana n'ebi. Gyezaho kwongyera ebiro nari ekicweka.",
    "emptyNone": "Tihariho hantu h'okuraara hataairwe. Ku oine ahantu omu Uganda ho orikupangisa buri kiro, hate aha makaug.",
    "guests": "Abagyenyi",
    "heroSub": "Apartments, cottages na guest houses ezi orikubaasa kutwara buri kiro. Buri listing ya nyineeka eine namba ya esimu ye, okore nawe butunguuka.",
    "heroTitle": "Sherura ahantu h'okuraara omu Uganda",
    "hideMap": "Shereka mapu",
    "hrs": "eshaaha",
    "i1B": "Abagyenyi baingi nibetenga viza, kandi Uganda neegiheereza aha internet otakagyenzire. Reeba ebiragiro ebiriho hati oshabire aha rubaju rwa gavumenti.",
    "i1L": "Orubaju rwa Uganda immigration orwa e-visa",
    "i1T": "Viza n'okutaaha",
    "i2B": "Enshuruuro ya gavumenti y'ebi orikubaasa kureeba n'okukora omu ihanga ryoona.",
    "i2L": "Genda aha utb.go.ug",
    "i2T": "Uganda Tourism Board",
    "i3B": "Shilingi (UGX) n'eihanga rya sente n'eza mobile money. MTN Mobile Money na Airtel Money nibyakiirwa hoona. Card nizikora omu hotel enkuru n'omu mall, kwonka ti hoona.",
    "i3T": "Okushashura",
    "i4B": "Kampala eine emotoka nyingi. App z'okweta emotoka na boda boda nizo zirikukira obwangu omu rurembo. Aha rugyendo rwa Entebbe airport, mwikirizanise aha muhendo nari obooke emotoka otakagyenzire.",
    "i4T": "Okugyenda",
    "i5B": "Nibicwekyerera. Buuza nyineeka aha mashanyarazi ag'obuhereza, itanka ry'amaizi na borehole. Ku orikwenda kukora ori aha, buuza ebyo na Wi-Fi. Orupapura oru tirukusherura na ebyo.",
    "i5T": "Amasyanyarazi n'amaizi",
    "i6B": "Ahantu h'okuraara omu Uganda nihabaasa kushashura omushoro gwa hotel aha kyumba buri kiro, ogurikukwatwa abakuru b'ekicweka. Buuza nyineeka ku omuhendo gwe gurimu.",
    "i6T": "Omushoro gwa hotel ogw'ekicweka",
    "infoTitle": "Noija omu Uganda? Ebi nibimanywa.",
    "kickOff": "Omuzaano nigutandika",
    "listOwn": "Ta ahantu hawe",
    "listPlace": "Ta ahantu hawe",
    "loading": "Nitusherura…",
    "mapFail": "Mapu tiyabaasa kwija. Orutindo rw'ahansi nirworeka ahantu hoona.",
    "maxNight": "Esente aha kiro",
    "min": "edakiika",
    "newListing": "Ensya",
    "partnerBadge": "Ihoteli",
    "partnerHeading": "Hotel omu Uganda",
    "partnerNote": "Ebi n'ehotel kuruga aha munywani w'orugyendo, kandi nizoreka nk'ekiragiro. makaug tekizita, tekizyebera, tekizibooka kandi tekita igiciro. Enamba y'esimu tiri aha. Akabumba ka Check prices nikareeba brand y'ehotel yaba eyashweirwe.",
    "partnerPriceAsk": "Ekiragiro kyoka. Igiciro kirikubaasa tikirikworeka aha.",
    "partnerReviews": "ebiteekateeko",
    "partnerVisit": "Orubaju rwa hotel",
    "bookingCta": "Serra aha kuraara aha",
    "bookingNote": "Hoteeri n'amaju agandi omu Uganda yoona okuruga aha bagenzi baitu. Okukwata ekiikaro nokukora aha rubaju rwabo, tikiri na makaug.",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "Nta bifo omu {town} ubu",
    "comparePrices": "Gyeragyerania ibiciro",
    "checkPrices": "Rora ibiciro",
    "affiliateDisclosure": "makaug eshobora kugira komisiyo; ubuka kandi wishyure ku rubuga rw'umufatanyabikorwa, urukora booking yawe",
    "indicative": "kirikwerekana",
    "hotelsTown": "Ekiragiro cy'ehotel · {town}",
    "hotelsFallback": "Ekiragiro cy'ehotel · Kampala na Entebbe",
    "showMore": "Erekana ibindi",
    "alertWhatsapp": "Menyesha kuri WhatsApp iyo ikibanza kibitswe",
    "searchHotels": "Shakisha ehotel",
    "adLabel": "Itangazo",
    "requestDates": "Saba ebiro ebi",
    "paymentDirect": "Okushashura nikumanyirwa hagati yawe n’omunyini. makaug teyakira kandi teyabika sente.",
    "feeAwaiting": "Kyemeirwe, nirinda sente za UGX 20,000 buri kwezi. Nta minsi y'ubuntu. Akakwate k’okushashura nikija. Listing neegenda omumaisho sente zishashuwe.",
    "listFee": "Abatari agent barishura UGX 20,000 buri kwezi, nta minsi y'ubuntu. Short stays z'agent yemejwe ziri mu plan y'agent (UGX 50,000 buri kwezi).",
    "termsTitle": "Amateeka y’okuraara ahake",
    "termsBody": "makaug nehandiika ahantu, nekebera eky’esobora, n’egaita omushyitsi n’omunyini. Omunyini niwe aine obuvunanyizibwa aha kuraara, oburinzi, layisensi, omusoro n’okugarura sente.",
    "termsLawyer": "Munnamateeka wa Uganda asaana akeberere amateeka aga otarikugakozesa nk’agaheru.",
    "verifiedStay": "Okuraara okukakasibwe",
    "safetyView": "Rora ahantu kandi okakase ou orikuha sente otarashashura.",
    "safetyName": "Otarashashura aha konti eine izina rindi.",
    "safetyReport": "Menyesha ekizibu kuruga aha listing ku orikureeba ekitarikwikiriza.",
    "extrasTitle": "Tegura urugendo rusigaye",
    "extrasLead": "Irakingurwa ku rubuga rw'umufatanyabikorwa. makaug ntibuka kandi ntiyakira amafaranga.",
    "extrasNote": "Link z'abafatanyabikorwa: MakaUG ishobora kugira komisiyo",
    "extrasTransfers": "Ugutwarwa ku kibuga c'indege",
    "extrasEsims": "amakarita eSIM",
    "extrasTours": "Ingendo n'ibikorwa",
    "extrasCars": "Gukodesha imodoka",
    "extrasFlights": "Indege"
  },
  "sm": {
    "adCtaFind": "Noonya ekifo",
    "adHeadline": "Uganda y'eyakuŋŋaanyiza. Ebifo biggwaawo mangu.",
    "adSub": "Kampala, Entebbe ni Jinja zijjula nga tekinnatuuka.",
    "checkIn": "Lw'oyingira",
    "checkOut": "Lw'ofuluma",
    "countNote": "Ebifo eby'okusula bibalirwa mu muwendo gwa makaug ogw'ebintu byonna.",
    "d1Body": "Buli kifo eky'okusula kitegekebwa wakati wo ni nyini kifo. Tetuli agent, broker oba omuntu ali mu ndagaano yaimwe.",
    "d1Lead": "makaug tekikkiriza booking era tekikwata sente.",
    "d2Body": "Singa nyini kifo akusaba sente nga tonalaba kifo oba nga tonakakasa gw'ali, yimirira. Eno y'engeri esinga abantu gye babbibwamu.",
    "d2Lead": "Totuma deposit eri omuntu gw'otakakasa.",
    "d3Body": "makaug tekebera buli kifo, tekebera buli kifaananhi, era tesobola kukakasa nti ekifo kiri nga bwe kyogeddwa, kipangisibwa mu mateeka, oba nti kiriwo.",
    "d3Lead": "Banyini bifo be bawandiika listing zaabwe.",
    "d4Body": "Omuwendo gwonagwona gw'olaba ku mukutu guno gubalirwa okuva ku muwendo nyini kifo gwe yateeka n'ennaku z'owandiise. Gwe gwa kuteebereza, si quote era si ndagaano.",
    "d4Lead": "Emiwendo egiraga gya nyini kifo.",
    "d5Body": "Lw'oyingira, lw'ofuluma, ebiri mu, deposit n'amateeka g'okuzzaayo sente byona biwandiikibwe nga tonasasula.",
    "d5Lead": "Mukkiriziganhe ku miteeka mu buwandiike.",
    "d6Body": "Kozesa report link ku listing yonaena. Tuggyawo listing.",
    "d6Lead": "Tutegeeze ku buli kintu ekitali kituufu.",
    "days": "ennaku",
    "discTitle": "Totuusa nga tonalaba ekifo",
    "safetyMore": "Soma ebyokwerinda byona",
    "infoLead": "Ebintu mukaaga ebikulu okumanha.",
    "extrasPartnersNamed": "Amanya gonka. makaug tekoresa logo zaabwe. Link egulawo ekibanja ky'omukago.",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "Tewali kituukagana n'ebyo. Gezaako okugaziya ennaku oba ekitundu.",
    "emptyNone": "Tewannabaawo bifo bya kusula bifulumiziddwa. Bw'oba olina ekifo mu Uganda ky'opangisa buli kiro, kiteeke ku makaug.",
    "guests": "Abagenyi",
    "heroSub": "Apartments, cottages ni guest houses ez'osobola okutwala buli kiro. Buli listing ya nnyini kifo erina namba y'essimu ye, okolagane naye butereevu.",
    "heroTitle": "Noonya aw'okusula mu Uganda",
    "hideMap": "Kweka maapu",
    "hrs": "essaawa",
    "i1B": "Abagenyi abasinga beetaaga viza, era Uganda egiwa ku mutimbagano nga tonatambula. Kebera amateeka agaliwo kati osabire ku mukutu gwa gavumenti.",
    "i1L": "Omukutu gwa Uganda immigration ogwa e-visa",
    "i1T": "Viza n'okuyingira",
    "i2B": "Ensibuko entongole ey'ebyo by'oyinza okulaba n'okukola mu igwanga.",
    "i2L": "Genda ku utb.go.ug",
    "i2T": "Uganda Tourism Board",
    "i3B": "Silingi (UGX) y'ekozesebwa mu sente enkalu ni mobile money. MTN Mobile Money ni Airtel Money bikkirizibwa wona awantu. Cards zikola mu wooteeri n'amaduuka amanene, so si wona.",
    "i3T": "Okusasula",
    "i4B": "Kampala erimu traffic nhingi. Apps z'okuyita emmotoka ni boda boda ze zisinga obwangu mu kibuga. Ku lugendo lw'e Entebbe airport, mukkiriziganhe ku muwendo oba obooke emmotoka nga tonatambula.",
    "i4T": "Okutambula",
    "i5B": "Amasanyalaze gasalibwako. Buuza nnyini kifo ku masanyalaze ag'eddagala, ttanka y'amazzi ni borehole. Bw'oba oyagala okukola ng'oli wano, buuza ku ebyo ni Wi-Fi. Omuko guno tegusunsula ku bikozesebwa ebyo.",
    "i5T": "Amasannhalaze n'amazzi",
    "i6B": "Ebifo eby'okusula mu Uganda biyinza okusasulirwa omusolo gwa hotel buli kisenge buli kiro, ogusoloozebwa ab'ekitundu. Buuza nyini kifo oba omuwendo gwe gugutwalidde.",
    "i6T": "Omusolo gwa hotel ogw'ekitundu",
    "infoTitle": "Oija mu Uganda? Bino bikulu okumanha.",
    "kickOff": "Omuzannyo gutandika",
    "listOwn": "Teeka ekifo kyo",
    "listPlace": "Teeka ekifo kyo",
    "loading": "Tunoonya…",
    "mapFail": "Maapu tezikoze. Olukalala wansi lulaga ebifo byonna.",
    "maxNight": "Ssente ku kiro",
    "min": "eddakiika",
    "newListing": "Empya",
    "partnerBadge": "Wooteeri",
    "partnerHeading": "Wooteeri mu Uganda",
    "partnerNote": "Bino wooteeri okuva ku mukago, era biragibwa nga ekkubo. makaug tekiteeka, tekikebera, tekibooka era tekissa miwendo. Tewali namba ya ssimu wano. Akabumba ka Check prices kalabika brand ya wooteeri bw'eba nga eyaka.",
    "partnerPriceAsk": "Kkubo kwokka. Ebbeeyi etebeera teragibwa wano.",
    "partnerReviews": "endowooza",
    "partnerVisit": "Omukutu gwa wooteeri",
    "bookingCta": "Noonia ebifo ku",
    "bookingNote": "Wooteeri n'enyumba endala mu Uganda yonna okuva mu bakolagana naiswe. Okukwaata ekifo okikola ku mukutu gwabwe, si na makaug.",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "Tewali bifo mu {town} kati",
    "comparePrices": "Geraageranya emiwendo",
    "checkPrices": "Kebera emiwendo",
    "affiliateDisclosure": "makaug eyinza okufuna komissioni; booka era osasule ku mukutu gw'omukago, ogukola booking yo",
    "indicative": "elaga",
    "hotelsTown": "Ekkubo lya wooteeri · {town}",
    "hotelsFallback": "Ekkubo lya wooteeri · Kampala ni Entebbe",
    "showMore": "Laga ebirala",
    "alertWhatsapp": "Mpulize ku WhatsApp nga ekifo kiteekeddwa",
    "searchHotels": "Noonya wooteeri",
    "adLabel": "Katale ya sm",
    "requestDates": "Saba ennaku zino",
    "paymentDirect": "Okusasula kukkira wakati wo n’omwami w’ennyumba. makaug tewamba era tewakuma ssente.",
    "feeAwaiting": "Kikkiriziddwa, kussuubira ssente eza UGX 20,000 buli mwezi. Tewali nnaku za bwereere. Akayungirizi k’okusasula kajja. Listing egenda mu luguudo ssente bwe zisasulwa.",
    "listFee": "Abateeka abatali agent basasula UGX 20,000 buli mwezi, tewali nnaku za bwereere. Obusulo obw'okusula okumpi obw'agent eyakkirizibwa buli mu pulani ya agent (UGX 50,000 buli mwezi).",
    "termsTitle": "Ebiragiro by’okusula okumpi",
    "termsBody": "makaug ewandiika ekifo, ekebera ky’esobola, n’egatta omugenyi n’omwami w’ennyumba. Omwami w’ennyumba ye alina obuvunaanyizibwa ku kusula, obukuumi, layisinsi, musolo n’okuzza ssente.",
    "termsLawyer": "Munnamateeka wa Uganda asaanye akebere ebiragiro bino nga tebinnakolebwa nga eby’enkomerero.",
    "verifiedStay": "Okusula okukakasiddwa",
    "safetyView": "Laba ekifo era okakase ani gw’osasula nga tonnasasula.",
    "safetyName": "Tosasula ku akawunti erina erinnya eddala.",
    "safetyReport": "Loopa ekizibu okuva ku listing singa waliwo ekikyamu.",
    "extrasTitle": "Tekateeka olugendo olusigaddeyo",
    "extrasLead": "Gulawo ku mukutu gw'omukago. makaug tewera booking era tefuna ssente.",
    "extrasNote": "Link za affiliate: MakaUG eyinza okufuna komissioni",
    "extrasTransfers": "Okutwalibwa okuva ku kisaawe ky'ennyonyi",
    "extrasEsims": "ekaada eSIM",
    "extrasTours": "Obulambuzi n'emirimu",
    "extrasCars": "Okupangisa emmotoka",
    "extrasFlights": "Ennyonyi"
  },
  "sw": {
    "adCtaFind": "Tafuta malazi",
    "adHeadline": "Uganda inakaribisha. Vyumba vinaisha mapema.",
    "adSub": "Kampala, Entebbe na Jinja hujaa muda mrefu kabla ya mechi.",
    "checkIn": "Kuingia",
    "checkOut": "Kutoka",
    "countNote": "Malazi ya muda yanahesabiwa katika jumla ya mali za makaug.",
    "d1Body": "Kila malazi hapa hupangwa moja kwa moja kati yako na mwenyeji. Sisi si wakala, si dalali na si upande wa makubaliano yenu.",
    "d1Lead": "makaug haichukui booking wala haishughulikii pesa.",
    "d2Body": "Kama mwenyeji anakuomba pesa kabla hujaona mahali au kuthibitisha yeye ni nani, simama. Hii ndiyo njia inayotumika zaidi kuwaibia watu.",
    "d2Lead": "Usimtumie deposit mtu ambaye hujamthibitisha.",
    "d3Body": "makaug haikagui kila nyumba, haikagui kila picha, na haiwezi kuhakikisha kuwa mahali ni kama ilivyoelezwa, kunapangishwa kihalali, au kunapatikana.",
    "d3Lead": "Wenyeji wanaandika matangazo yao wenyewe.",
    "d4Body": "Jumla yoyote unayoona hapa imehesabiwa kutoka bei aliyoweka mwenyeji na tarehe ulizoandika. Ni makadirio, si nukuu wala mkataba.",
    "d4Lead": "Bei zinazoonyeshwa ni za mwenyeji.",
    "d5Body": "Kuingia, kutoka, kilichojumuishwa, deposit na sheria za kurudishiwa pesa vyote viandikwe kabla hujalipa chochote.",
    "d5Lead": "Kubalianeni masharti kwa maandishi.",
    "d6Body": "Tumia kiungo cha ripoti kwenye tangazo lolote. Tunaondoa matangazo.",
    "d6Lead": "Ripoti chochote kinachoonekana si sahihi.",
    "days": "siku",
    "discTitle": "Usilipe kabla ya kuona mahali",
    "safetyMore": "Soma vidokezo vyote vya usalama",
    "infoLead": "Mambo sita yanayofaa kujua.",
    "extrasPartnersNamed": "Majina pekee. makaug haitumii nembo zao. Kiungo kinafungua tovuti ya mshirika.",
    "photoCredit": "Photos: Wikimedia Commons — Entebbe airport, public domain, David Konop; Murchison Falls, public domain, Rharnisch; 50 Uganda shilling note, CC BY-SA 4.0, Nabunje Leticia; boda boda, CC BY-SA 4.0, Erinamukuta; Owen Falls Dam, CC BY 4.0, NakigandaJ; Speke Resort Munyonyo, CC0, Samson Ssemakadde.",
    "emptyFilters": "Hakuna kinacholingana na vichujio hivi. Jaribu kupanua tarehe au eneo.",
    "emptyNone": "Hakuna malazi ya muda yaliyochapishwa bado. Kama una mahali Uganda unapopangisha kwa usiku, liweke kwenye makaug.",
    "guests": "Wageni",
    "heroSub": "Apartments, cottages na guest houses unazoweza kuchukua kwa usiku. Kila tangazo la mwenyeji lina namba yake ya simu, hivyo unashughulika naye moja kwa moja.",
    "heroTitle": "Tafuta malazi ya muda Uganda",
    "hideMap": "Ficha ramani",
    "hrs": "saa",
    "i1B": "Wageni wengi wanahitaji viza, na Uganda huzitoa mtandaoni kabla ya safari. Angalia sheria za sasa na uombe kwenye tovuti rasmi ya serikali.",
    "i1L": "Tovuti ya e-visa ya uhamiaji Uganda",
    "i1T": "Viza na kuingia",
    "i2B": "Chanzo rasmi cha yale ya kuona na kufanya nchini kote.",
    "i2L": "Tembelea utb.go.ug",
    "i2T": "Uganda Tourism Board",
    "i3B": "Shilingi (UGX) ni nchi ya fedha taslimu na mobile money. MTN Mobile Money na Airtel Money zinakubaliwa karibu kila mahali. Kadi zinafanya kazi katika hoteli kubwa na maduka makubwa, si kwingine sana.",
    "i3T": "Kulipia vitu",
    "i4B": "Msongamano wa magari Kampala ni mkubwa. Programu za kuagiza gari na boda boda ndio njia ya haraka mjini. Kwa safari za uwanja wa ndege Entebbe, kubaliana bei au agiza gari kabla ya safari.",
    "i4T": "Kusafiri",
    "i5B": "Kukatika hutokea. Muulize mwenyeji kuhusu umeme wa akiba, tanki la maji na kisima. Ukihisi kufanya kazi ukiwa hapa, uliza kuhusu hivyo na Wi-Fi. Ukurasa huu hauchuji kwa huduma hizo.",
    "i5T": "Umeme na maji",
    "i6B": "Malazi ya muda mfupi Uganda yanaweza kutozwa ushuru wa hoteli kwa chumba kwa usiku, unaokusanywa na mamlaka ya eneo. Muulize mwenyeji kama bei yake imejumuisha.",
    "i6T": "Ushuru wa hoteli wa eneo",
    "infoTitle": "Unakuja Uganda? Yafaa kujua.",
    "kickOff": "Mchezo unaanza",
    "listOwn": "Weka mahali pako",
    "listPlace": "Weka mahali pako",
    "loading": "Inapakia malazi…",
    "mapFail": "Ramani haikupakia. Orodha hapa chini inaonyesha kila mahali.",
    "maxNight": "Kiwango kwa usiku",
    "min": "dakika",
    "newListing": "Mpya",
    "partnerBadge": "Hoteli",
    "partnerHeading": "Hoteli nchini Uganda",
    "partnerNote": "Hoteli hizi zinatoka kwa mshirika wa safari na zinaonyeshwa kama mwongozo. makaug haziorodheshi, hazikagui, hazibuki wala haziweki bei. Hakuna nambari ya simu hapa. Kitufe cha Angalia bei huonekana tu kampuni ya kuhifadhi hoteli ikiwashwa.",
    "partnerPriceAsk": "Mwongozo tu. Bei ya moja kwa moja haionyeshwi hapa.",
    "partnerReviews": "maoni",
    "partnerVisit": "Tovuti ya hoteli",
    "bookingCta": "Tafuta malazi kwenye",
    "bookingNote": "Hoteli na nyumba zaidi kote Uganda kutoka kwa washirika wetu wa safari. Unafanya booking kwenye tovuti yao, si na makaug.",
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
    "wherePh": "Kampala, Entebbe, Jinja…",
    "emptyTown": "Bado hakuna mahali {town}",
    "comparePrices": "Linganisha bei",
    "checkPrices": "Angalia bei",
    "affiliateDisclosure": "makaug inaweza kupata kamisheni; unahifadhi na kulipa kwenye tovuti ya mshirika, ambayo inashughulikia uhifadhi wako",
    "indicative": "elekezi",
    "hotelsTown": "Mwongozo wa hoteli · {town}",
    "hotelsFallback": "Mwongozo wa hoteli · Kampala na Entebbe",
    "showMore": "Onyesha zaidi",
    "alertWhatsapp": "Niarifu WhatsApp mahali panapoorodheshwa",
    "searchHotels": "Tafuta hoteli",
    "adLabel": "Tangazo",
    "requestDates": "Omba tarehe hizi",
    "paymentDirect": "Malipo yanakubaliwa moja kwa moja kati yako na mwenyeji. makaug haichukui wala kushikilia malipo.",
    "feeAwaiting": "Imeidhinishwa, inasubiri ada ya UGX 20,000 kwa mwezi. Hakuna siku za bure. Kiungo cha kulipa kinafuata. Tangazo linaanza kuonekana ada ikilipwa.",
    "listFee": "Watoa orodha wa kawaida hulipa UGX 20,000 kwa mwezi, bila siku za bure. Malazi ya muda ya wakala aliyeidhinishwa yamo katika mpango wa wakala (UGX 50,000 kwa mwezi).",
    "termsTitle": "Masharti ya kukaa kwa muda mfupi",
    "termsBody": "makaug inaorodhesha mahali, inakagua inachoweza, na inakutanisha mgeni na mwenyeji. Mwenyeji anawajibika kwa kukaa, usalama, leseni, kodi na marejesho.",
    "termsLawyer": "Mwanasheria wa Uganda anapaswa kupitia masharti haya kabla hayajachukuliwa kuwa ya mwisho.",
    "verifiedStay": "Kukaa kulichothibitishwa",
    "safetyView": "Tazama mahali na uthibitishe unamlipa nani kabla hujalipa.",
    "safetyName": "Usilipe kwenye akaunti yenye jina tofauti.",
    "safetyReport": "Ripoti tatizo kutoka kwenye tangazo likitokea kitu kibaya.",
    "extrasTitle": "Panga safari yako iliyobaki",
    "extrasLead": "Inafunguka kwenye tovuti ya mshirika. makaug haichukui uhifadhi wala malipo.",
    "extrasNote": "Viungo vya washirika: MakaUG inaweza kupata kamisheni",
    "extrasTransfers": "Usafiri wa uwanja wa ndege",
    "extrasEsims": "kadi za eSIM",
    "extrasTours": "Ziara na shughuli",
    "extrasCars": "Kukodisha gari",
    "extrasFlights": "Ndege"
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

  function trackSt(name, params) {
    var payload = params || {};
    try {
      if (typeof window.trackEvent === 'function') window.trackEvent(name, payload);
      else if (typeof window.gtag === 'function') window.gtag('event', name, payload);
    } catch (_error) {}
  }

  function sanitizeSubId(value) {
    return String(value || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 100);
  }

  function trafficExtra() {
    var query = qs();
    return query.ref || query.utm_source || '';
  }

  function travelpayoutsConfig() {
    return (window.__makaugShortTerm && window.__makaugShortTerm.travelpayouts) || {};
  }

  function partnerSlug(row) {
    var ref = String((row && (row.reference || row.title)) || 'hotel').toLowerCase();
    return ref.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hotel';
  }

  function hotelSubId(slug) {
    var base = sanitizeSubId('st_hotel_' + (slug || 'hotel')) || 'st_hotel';
    var extra = sanitizeSubId(trafficExtra());
    return extra ? (base + '_' + extra).slice(0, 100) : base;
  }

  function brandSearchUrl(key, destination, checkIn, checkOut, adults) {
    var name = destination || 'Uganda';
    var people = String(adults || 2);
    if (key === 'booking') {
      var booking = new URL('https://www.booking.com/searchresults.html');
      booking.searchParams.set('ss', name);
      if (checkIn) booking.searchParams.set('checkin', checkIn);
      if (checkOut) booking.searchParams.set('checkout', checkOut);
      booking.searchParams.set('group_adults', people);
      booking.searchParams.set('no_rooms', '1');
      return booking.toString();
    }
    if (key === 'agoda') {
      var agoda = new URL('https://www.agoda.com/search');
      agoda.searchParams.set('q', name);
      if (checkIn) agoda.searchParams.set('checkIn', checkIn);
      if (checkOut) agoda.searchParams.set('checkOut', checkOut);
      agoda.searchParams.set('adults', people);
      agoda.searchParams.set('rooms', '1');
      return agoda.toString();
    }
    if (key === 'trip') {
      var trip = new URL('https://www.trip.com/hotels/list');
      trip.searchParams.set('keyword', name);
      if (checkIn) trip.searchParams.set('checkin', checkIn);
      if (checkOut) trip.searchParams.set('checkout', checkOut);
      trip.searchParams.set('adult', people);
      trip.searchParams.set('crn', '1');
      return trip.toString();
    }
    return '';
  }

  function trackedHref(brand, url, subId) {
    var cfg = travelpayoutsConfig();
    if (!cfg.marker || !brand || !brand.programId || !url) return '';
    var params = new URLSearchParams();
    params.set('marker', cfg.marker);
    params.set('p', brand.programId);
    params.set('u', url);
    if (brand.campaignId) params.set('campaign_id', brand.campaignId);
    var sub = sanitizeSubId(subId);
    if (sub) params.set('sub_id', sub);
    return 'https://tp.media/r?' + params.toString();
  }

  function compareButtonsHtml(hotelName, subId) {
    var cfg = travelpayoutsConfig();
    if (!cfg.enabled || !cfg.brands || !cfg.brands.length) return '';
    var query = qs();
    var buttons = cfg.brands.map(function (brand) {
      var raw = brandSearchUrl(brand.key, hotelName, query.check_in, query.check_out, query.guests || 2);
      var href = trackedHref(brand, raw, subId);
      if (!href) return '';
      return '<a class="st-compare-btn" href="' + esc(href) + '" target="_blank" rel="sponsored noopener"'
        + ' data-st-affiliate="' + esc(brand.key) + '" data-st-sub="' + esc(subId) + '">'
        + esc(t('checkPrices')) + (brand.label ? ' · ' + esc(brand.label) : '') + '</a>';
    }).join('');
    if (!buttons) return '';
    return '<div class="st-compare"><span class="st-ad-label">' + esc(t('adLabel')) + '</span>'
      + '<div class="st-compare-btns">' + buttons + '</div>'
      + '<p class="st-compare-note">' + esc(t('affiliateDisclosure')) + '</p></div>';
  }

  var EXTRA_GROUP_LABEL = {
    transfers: 'extrasTransfers',
    esims: 'extrasEsims',
    tours: 'extrasTours',
    cars: 'extrasCars',
    flights: 'extrasFlights'
  };

  function fireAffiliateClick(partner, placement) {
    try {
      if (typeof fireClientGaEvent === 'function') {
        fireClientGaEvent('affiliate_click', { partner: partner, placement: placement });
      }
    } catch (_error) {}
  }

  // Travel extras. Hidden until the runtime config lists a partner, which
  // happens only after that partner's program id is set. Compare prices is a
  // different block and is not built here.
  function travelExtrasHtml(placement) {
    var extraCardPhoto = {
      transfers: '/assets/img/worth-knowing/entebbe-airport.jpg',
      tours: '/assets/img/worth-knowing/murchison-falls.jpg',
      cars: '/assets/img/worth-knowing/boda-boda.jpg',
      flights: '/assets/img/worth-knowing/entebbe-airport.jpg'
    };
    var cfg = travelpayoutsConfig();
    var groups = cfg.extras || [];
    if (!cfg.marker || !groups.length) return '';
    var sub = sanitizeSubId('st_extra_' + (placement || 'short-term'));
    var body = groups.map(function (group) {
      var labelKey = EXTRA_GROUP_LABEL[group.key];
      if (!labelKey) return '';
      var links = (group.partners || []).map(function (partner) {
        if (!partner || !partner.url || !/^https:\/\//.test(partner.url)) return '';
        var href = trackedHref(partner, partner.url, sub);
        if (!href) return '';
        return '<a class="st-extra-link" href="' + esc(href) + '" target="_blank" rel="sponsored nofollow noopener"'
          + ' data-st-extra="' + esc(partner.key) + '" data-st-extra-placement="' + esc(placement) + '">'
          + esc(partner.label) + '</a>';
      }).join('');
      if (!links) return '';
      var photo = extraCardPhoto[group.key];
      return '<article class="st-extra-card">'
        + (photo
          ? '<img class="st-extra-photo" src="' + esc(photo) + '" alt="">'
          : '<div class="st-extra-photo st-extra-photo-plain" aria-hidden="true"></div>')
        + '<div class="st-extra-body"><h3>' + esc(t(labelKey)) + '</h3>'
        + '<p class="st-extra-sub">' + esc(t('extrasLead')) + '</p>'
        + '<div class="st-extra-links">' + links + '</div></div></article>';
    }).join('');
    if (!body) return '';
    return '<section class="st-extras" data-st-extras="' + esc(placement) + '">'
      + '<div class="st-extras-head"><h2>' + esc(t('extrasTitle')) + '</h2>'
      + '<span class="st-ad-label">' + esc(t('adLabel')) + '</span></div>'
      + '<p class="st-extras-lead">' + esc(t('extrasPartnersNamed')) + '</p>'
      + '<div class="st-extra-grid">' + body + '</div>'
      + '<p class="st-extras-note">' + esc(t('extrasNote')) + '</p>'
      + '</section>';
  }

  function rememberPartner(row) {
    if (!row) return;
    try {
      window.sessionStorage.setItem('makaug.st.partner.' + partnerSlug(row), JSON.stringify(row));
    } catch (_error) {}
  }

  function rememberedPartner(slug) {
    try {
      var raw = window.sessionStorage.getItem('makaug.st.partner.' + slug);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  var DRIVE_SRC = 'https://emrldtp.cc/NTgxODU0.js?t=581854';
  function loadTravelpayoutsDrive() {
    var cfg = travelpayoutsConfig();
    if (!cfg.driveEnabled || currentPath() !== '/short-term') return;
    if (document.querySelector('script[data-tp-drive]')) return;
    function load() {
      if (document.querySelector('script[data-tp-drive]')) return;
      var script = document.createElement('script');
      script.src = DRIVE_SRC;
      script.async = true;
      script.setAttribute('data-tp-drive', '1');
      document.head.appendChild(script);
    }
    var granted = window.__makaugCookieConsent === 'granted'
      || (document.documentElement && document.documentElement.getAttribute('data-cookie-consent') === 'granted');
    var banner = document.querySelector('[data-cookie-consent], #cookie-banner, #cookie-consent, [data-cookie-banner]');
    if (granted || !banner) { load(); return; }
    document.addEventListener('makaug:cookie-consent', function (event) {
      var detail = event && event.detail;
      if (!detail || detail.granted !== false) load();
    });
  }

  function whatsappDigits() {
    var raw = String((window.__makaugShortTerm && window.__makaugShortTerm.whatsappNumber) || '256780863394');
    var digits = raw.replace(/\D/g, '');
    if (digits.indexOf('0') === 0) digits = '256' + digits.slice(1);
    return digits || '256780863394';
  }

  function alertWhatsappHref(town) {
    var text = 'Please alert me when a short stay is listed in ' + (town || 'Uganda') + '.';
    return 'https://wa.me/' + whatsappDigits() + '?text=' + encodeURIComponent(text);
  }

  function fillTown(template, town) {
    return String(template || '').replace('{town}', town || '');
  }

  function searchedTown() {
    var field = document.getElementById('st-q');
    var typed = field ? String(field.value || '').trim() : '';
    if (typed) return typed;
    var query = qs();
    return String(query.q || query.search || query.query || query.district || '').trim();
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

  // ------------------------------------------------------------ map
  // C18 (10 Oct 2026): Google Maps is gone. Leaflet + OpenStreetMap tiles,
  // using the main bundle's loader. OSM refuses tile requests with no referrer
  // (the 403 "not following the tile usage policy" seen here before), so the
  // tile layer sends the site origin.
  var ST_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ST_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  function loadMapLibrary(attempt) {
    if (window.L && window.L.map) return Promise.resolve(true);
    if (typeof window.ensureLeafletApi === 'function') {
      return window.ensureLeafletApi().then(function (ok) {
        return !!(ok && window.L && window.L.map);
      });
    }
    // The bundle may not be in yet; this file loads in parallel with it.
    var tries = (attempt || 0) + 1;
    if (tries > 40) return Promise.resolve(false);
    return new Promise(function (resolve) {
      window.setTimeout(function () { resolve(loadMapLibrary(tries)); }, 250);
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
    loadMapLibrary().then(function (ok) {
      if (!ok) {
        host.innerHTML = '<div class="st-empty"><i class="fas fa-map"></i>' + esc(t('mapFail')) + '</div>';
        return;
      }
      var L = window.L;
      if (!state.map || !document.body.contains(host) || state.mapHost !== host) {
        if (state.map && state.map.remove) { try { state.map.remove(); } catch (e) { /* gone */ } }
        state.map = L.map(host, { scrollWheelZoom: false }).setView([0.3476, 32.5825], 11);
        state.mapHost = host;
        L.tileLayer(ST_TILE_URL, { attribution: ST_TILE_ATTRIBUTION, referrerPolicy: 'strict-origin-when-cross-origin', maxZoom: 19 }).addTo(state.map);
      }

      (state.markers || []).forEach(function (m) { m.remove(); });
      state.markers = [];

      var placed = (state.listings || []).filter(function (l) {
        return l && isFinite(Number(l.latitude)) && isFinite(Number(l.longitude));
      });

      if (!placed.length) {
        // Nothing to pin yet, so show the country rather than an empty grey square.
        state.map.setView([1.3733, 32.2903], 7);
        return;
      }

      var points = [];
      placed.forEach(function (listing) {
        var point = [Number(listing.latitude), Number(listing.longitude)];
        points.push(point);
        // The price IS the pin. That is the thing people scan a map for.
        var label = priceLabel(listing);
        var icon = L.divIcon({
          className: 'st-price-pin',
          html: '<span style="display:inline-block;background:#8a3a12;color:#fff;border:1.5px solid #fff;border-radius:11px;padding:3px 8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">' + esc(label || '•') + '</span>',
          iconSize: null,
          iconAnchor: [22, 11]
        });
        var marker = L.marker(point, { title: listing.title || '', icon: icon }).addTo(state.map);
        marker.bindPopup(
          '<div style="font-family:inherit;max-width:220px">'
          + '<strong>' + esc(listing.title || '') + '</strong><br>'
          + esc([listing.area, listing.district].filter(Boolean).join(', '))
          + (label ? '<br>UGX ' + esc(String(listing.price_per_night)) + ' ' + esc(t('perNight')) : '')
          + '<br><a href="' + esc(listing.url || '#') + '" data-st-link>' + esc(t('search')) + '</a>'
          + '</div>'
        );
        state.markers.push(marker);
      });

      if (points.length === 1) state.map.setView(points[0], 14);
      else state.map.fitBounds(points, { padding: [40, 40] });
      window.setTimeout(function () { try { state.map.invalidateSize(); } catch (e) { /* gone */ } }, 150);
    });
  }

  function disclaimerBlock() {
    var shown = [['d1Lead', 'd1Body'], ['d5Lead', 'd5Body'], ['d6Lead', 'd6Body']];
    var more = [['d2Lead', 'd2Body'], ['d3Lead', 'd3Body'], ['d4Lead', 'd4Body']];
    function rule(pair) {
      return '<div class="st-safety-rule"><b>' + esc(t(pair[0])) + '</b><p>' + esc(t(pair[1])) + '</p></div>';
    }
    return ''
      + '<section class="st-disclaimer st-safety" id="st-disclaimer">'
      + '<h2><i class="fas fa-triangle-exclamation"></i> ' + esc(t('discTitle')) + '</h2>'
      + '<div class="st-safety-rules">' + shown.map(rule).join('') + '</div>'
      + '<details class="st-safety-more"><summary>' + esc(t('safetyMore')) + '</summary>'
      + '<div class="st-safety-rules">' + more.map(rule).join('') + '</div></details>'
      + '</section>';
  }

  function guestInfoBlock() {
    function card(photo, titleKey, bodyKey, href, linkKey) {
      return '<article class="st-info-card"><img class="st-info-photo" src="' + esc(photo) + '" alt="">'
        + '<div class="st-info-body"><h3>' + esc(t(titleKey)) + '</h3>'
        + '<p>' + esc(t(bodyKey)) + '</p>'
        + (href
          ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">'
            + esc(t(linkKey)) + ' <i class="fas fa-arrow-up-right-from-square"></i></a>'
          : '')
        + '</div></article>';
    }
    return ''
      + '<section class="st-worth">'
      + '<h2>' + esc(t('infoTitle')) + '</h2>'
      + '<p class="st-worth-lead">' + esc(t('infoLead')) + '</p>'
      + '<div class="st-info-grid">'
      + card('/assets/img/worth-knowing/entebbe-airport.jpg', 'i1T', 'i1B', 'https://visas.immigration.go.ug', 'i1L')
      + card('/assets/img/worth-knowing/murchison-falls.jpg', 'i2T', 'i2B', 'https://utb.go.ug', 'i2L')
      + card('/assets/img/worth-knowing/shilling.jpg', 'i3T', 'i3B')
      + card('/assets/img/worth-knowing/boda-boda.jpg', 'i4T', 'i4B')
      + card('/assets/img/worth-knowing/owen-falls.jpg', 'i5T', 'i5B')
      + card('/assets/img/worth-knowing/speke-resort.jpg', 'i6T', 'i6B')
      + '</div>'
      + '<p class="st-photo-credit">' + esc(t('photoCredit')) + '</p>'
      + '</section>';
  }

  // ---------------------------------------------------------------- search view

  function hotelSearchBoxHtml() {
    var cfg = travelpayoutsConfig();
    if (!cfg.enabled) return '';
    var query = qs();
    return '<form class="st-hotel-search" id="st-hotel-search">'
      + '<span class="st-ad-label">' + esc(t('adLabel')) + '</span>'
      + '<label for="st-hotel-q">' + esc(t('searchHotels')) + '</label>'
      + '<input class="st-input" id="st-hotel-q" name="destination" value="' + esc(query.q || query.search || query.query || query.district || '') + '">'
      + '<input class="st-input" id="st-hotel-in" name="check_in" type="date" value="' + esc(query.check_in || '') + '">'
      + '<input class="st-input" id="st-hotel-out" name="check_out" type="date" value="' + esc(query.check_out || '') + '">'
      + '<input class="st-input" id="st-hotel-guests" name="guests" type="number" min="1" max="30" value="' + esc(query.guests || '2') + '">'
      + '<div class="st-compare-btns">' + (cfg.brands || []).map(function (brand) {
        return '<button class="st-compare-btn" type="submit" data-hotel-brand="' + esc(brand.key) + '">'
          + esc(brand.label) + '</button>';
      }).join('') + '</div>'
      + '<p class="st-compare-note">' + esc(t('affiliateDisclosure')) + '</p>'
      + '</form>';
  }

  function searchViewHtml() {
    var q = qs();
    return ''
      // The section's own content comes first, as it does on every other page.
      + '<section class="st-hero">'
      + '<div class="st-wrap">'
      + hotelSearchBoxHtml()
      + '<h1>' + esc(t('heroTitle')) + '</h1>'
      + '<p class="st-hero-sub">' + esc(t('heroSub')) + '</p>'
      + '<p class="st-hero-sub" data-st-list-fee>' + esc(t('listFee')) + '</p>'
      + '<form class="st-search" id="st-search-form">'
      + '<div class="st-field"><label for="st-q">' + esc(t('where')) + '</label>'
      + '<input class="st-input" id="st-q" name="q" placeholder="' + esc(t('wherePh')) + '" value="' + esc(q.q || q.search || q.query || q.district || '') + '"></div>'
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

      + travelExtrasHtml('short-term')
      + disclaimerBlock()
      + guestInfoBlock()
      + '</div>';
  }

  // Partner hotels, shown only when a search found no hosts. They are drawn
  // differently from host cards on purpose: no host badge, no phone number, an
  // explicit label saying where they came from, and an outbound link to the
  // hotel's own site rather than a makaug page. A visitor should never be in
  // doubt about which of these makaug stands behind.
  function partnerCardHtml(row) {
    var where = [row.area, row.district].filter(Boolean).join(', ');
    var stars = row.star_rating
      ? '<span class="st-partner-stars">' + new Array(row.star_rating + 1).join('\★') + '</span>'
      : '';
    // A queue rather than a single URL: when the first photo is missing the
    // card steps to the next, and to the placeholder when it runs out. A
    // broken image is worse than no image, and on the only card carrying a
    // price it is worse still.
    var shots = (row.image_candidates && row.image_candidates.length)
      ? row.image_candidates
      : (row.primary_image ? [row.primary_image] : []);
    var media = shots.length
      ? '<img src="' + esc(shots[0]) + '" alt="' + esc((row.title || 'Hotel') + (where ? ' in ' + where : '')) + '" loading="lazy"'
        + ' data-st-shots="' + esc(shots.slice(1).join(' ')) + '">'
      : '<div class="st-noimg"><i class="fas fa-hotel"></i></div>';
    // The phone number is the point. A LiteAPI row carries the property's own
    // line, so the card ends the same way a host card does - with a way to
    // ring them - rather than with a link to a website that may not exist.
    var tel = String(row.host_phone || '').trim();
    var link = tel
      ? '<a class="st-partner-call" href="tel:' + esc(tel.replace(/[^+0-9]/g, ''))
        + '" data-st-contact="partner-phone"><i class="fas fa-phone"></i> ' + esc(tel) + '</a>'
      : (row.external_url
        ? '<a class="st-partner-link" href="' + esc(row.external_url) + '"'
          + ' target="_blank" rel="noopener noreferrer nofollow">' + esc(t('partnerVisit'))
          + ' <i class="fas fa-arrow-up-right-from-square"></i></a>'
        : '');

    // A guest score out of ten, with the number of reviews behind it, is worth
    // more to someone choosing a room than a star rating from a tourism board.
    // Only shown with its review count: a 9.4 from three people is not a 9.4.
    var score = (row.review_score && row.review_count)
      ? '<p class="st-partner-score"><b>' + esc(row.review_score.toFixed(1)) + '</b>'
        + '<span>' + esc(String(row.review_count)) + ' ' + esc(t('partnerReviews')) + '</span></p>'
      : '';

    // A rate only exists when the visitor gave dates. When there is none the
    // card says where to find one rather than going blank, because a blank
    // where a price should be reads as free.
    var price = row.price_display
      ? '<p class="st-partner-price"><b>' + esc(row.price_display) + '</b> '
        + esc(t('perNight')) + ' <span class="st-indicative">' + esc(t('indicative')) + '</span></p>'
      : '<p class="st-partner-price st-partner-price--ask">' + esc(t('partnerPriceAsk')) + '</p>';
    var slug = partnerSlug(row);
    rememberPartner(row);

    return '<article class="st-card st-partner-card">'
      + '<div class="st-card-media">' + media
      + '<span class="st-badge st-badge-partner">' + esc(t('partnerBadge')) + '</span>'
      + '</div>'
      + '<div class="st-card-body">'
      + '<h3 class="st-card-title"><a href="/short-term/hotel/' + esc(slug) + '" data-st-link>' + esc(row.title) + '</a></h3>'
      + (where ? '<p class="st-card-where">' + esc(row.district || where) + '</p>' : '')
      + stars
      + score
      + price
      + link
      + compareButtonsHtml(row.title, hotelSubId(slug))
      + '</div></article>';
  }

  function partnerRowsForTown() {
    var town = searchedTown().toLowerCase();
    var rows = state.partners || [];
    if (!town) return { rows: rows, heading: t('hotelsFallback'), matched: false };
    var matched = rows.filter(function (row) {
      return [row.district, row.area, row.title].some(function (part) {
        return String(part || '').toLowerCase().indexOf(town) !== -1;
      });
    });
    if (matched.length) return { rows: matched, heading: fillTown(t('hotelsTown'), searchedTown()), matched: true };
    return { rows: rows, heading: t('hotelsFallback'), matched: false };
  }

  function partnerBlockHtml() {
    if (!state.partners || !state.partners.length) return '';
    var picked = partnerRowsForTown();
    var limit = state.partnerShown || 8;
    var shown = picked.rows.slice(0, limit);
    var more = picked.rows.length > shown.length
      ? '<button class="st-btn" type="button" id="st-partners-more">' + esc(t('showMore')) + '</button>'
      : '';
    return '<section class="st-partner-block">'
      + '<h2 class="st-partner-heading">' + esc(picked.heading) + '</h2>'
      + '<p class="st-partner-note">' + esc(t('partnerNote')) + '</p>'
      + '<div class="st-grid">' + shown.map(partnerCardHtml).join('') + '</div>'
      + more
      + '</section>';
  }

  // Booking.com through CJ Affiliate. A single, plainly labelled way out to the
  // same search on Booking.com. The booking is made there: makaug still takes no
  // booking and holds no money, and says so next to the button.
  function bookingBlockHtml() {
    var offers = (state.bookingOffers || []).filter(function (offer) {
      return offer && offer.url && /^https:\/\//.test(offer.url);
    });
    if (!offers.length) return '';
    var buttons = offers.map(function (offer) {
      var name = String(offer.label || offer.provider || '').trim();
      return '<a class="st-booking-cta" href="' + esc(offer.url) + '"'
        + ' target="_blank" rel="sponsored noopener noreferrer"'
        + ' aria-label="' + esc(t('bookingCta') + ' ' + name) + '"'
        + ' data-st-contact="partner-clickout" data-st-partner="' + esc(offer.provider || '') + '">'
        + esc(name) + ' <i class="fas fa-arrow-up-right-from-square"></i></a>';
    }).join('');
    return '<aside class="st-booking-block">'
      + '<p class="st-booking-note">' + esc(t('bookingNote')) + '</p>'
      + '<div class="st-booking-ctas">' + buttons + '</div>'
      + '</aside>';
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
    var incomingBeds = new URLSearchParams(window.location.search || '');
    if (!params.get('bedrooms') && incomingBeds.get('bedrooms') && (params.get('q') || '') === (incomingBeds.get('q') || '')) {
      params.set('bedrooms', incomingBeds.get('bedrooms'));
    }
    var sort = document.getElementById('st-sort');
    if (sort && sort.value) params.set('sort', sort.value);
    var incoming = new URLSearchParams(window.location.search || '');
    var previousQ = incoming.get('q') || '';
    var newQ = params.get('q') || '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'fbclid', 'ref'].forEach(function (key) {
      if (incoming.get(key)) params.set(key, incoming.get(key));
    });
    if (incoming.get('district')) {
      var district = incoming.get('district');
      var qChanged = newQ && newQ.toLowerCase() !== String(previousQ || district).toLowerCase();
      if (!qChanged) params.set('district', district);
    }

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
      // Kept apart from state.listings on purpose. A partner row has no host
      // and no phone number; letting it into the host list is how the section
      // would start quietly breaking its own promise.
      state.partners = payload.partner_listings || [];
      // Booking.com (CJ affiliate). One outbound search link, or null when the
      // partnership is switched off - in which case nothing is drawn.
      state.bookingOffers = payload.booking_links
      || (payload.booking_link ? [payload.booking_link] : []);
      state.partnerShown = 8;
      trackSt('st_search', { q: params.get('q') || params.get('district') || '' });
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
    var target = document.getElementById('st-results');
    var partners = partnerBlockHtml();
    var town = searchedTown();
    if (count) {
      if (!state.listings.length && (partners || town)) {
        count.innerHTML = town
          ? '<span>' + esc(fillTown(t('emptyTown'), town)) + '</span>'
          : '';
      } else {
        count.innerHTML = '<span>' + state.total + ' ' + esc(t('stays'))
          + '</span><small>' + esc(t('countNote')) + '</small>';
      }
    }
    if (!target) return;
    if (!state.listings.length) {
      // When partner hotels are showing, their own heading already says no
      // hosts matched. Saying it again above them reads as two separate
      // failures instead of one situation with an explanation, which is how
      // the live page looked: "Nothing matches those filters yet", and then
      // twenty-four hotels.
      var townEmpty = town
        ? '<div class="st-empty"><h2>' + esc(fillTown(t('emptyTown'), town)) + '</h2>'
          + '<a class="st-alert-wa" data-whatsapp-static="true" data-st-contact="whatsapp-alert" target="_blank" rel="noopener" href="'
          + esc(alertWhatsappHref(town)) + '">' + esc(t('alertWhatsapp')) + '</a></div>'
        : '';
      var cta = '<div class="st-empty">'
        + (partners ? '' : '<i class="fas fa-magnifying-glass"></i>' + esc(t('emptyFilters')) + '<br><br>')
        + '<a class="st-btn st-btn-primary" href="/short-term/list-your-place" data-st-link>'
        + esc(t('listPlace') || t('listOwn')) + '</a></div>';
      target.innerHTML = townEmpty + (partners ? partners + cta : cta) + bookingBlockHtml();
      return;
    }
    target.innerHTML = '<div class="st-grid">' + state.listings.map(cardHtml).join('') + '</div>' + bookingBlockHtml();
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
      + '<img class="mk-house-band__image" src="/assets/img/hoima-stadium.jpg" alt="Hoima Stadium, one of the AFCON 2027 venues in Uganda" '
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
    var hotelForm = document.getElementById('st-hotel-search');
    if (hotelForm) {
      hotelForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var brandKey = (e.submitter && e.submitter.getAttribute('data-hotel-brand'))
          || (hotelForm.querySelector('[data-hotel-brand]') || {}).getAttribute && hotelForm.querySelector('[data-hotel-brand]').getAttribute('data-hotel-brand');
        var cfg = travelpayoutsConfig();
        var brand = (cfg.brands || []).filter(function (item) { return item.key === brandKey; })[0];
        if (!brand) return;
        var destination = (document.getElementById('st-hotel-q') || {}).value || 'Uganda';
        var checkIn = (document.getElementById('st-hotel-in') || {}).value || '';
        var checkOut = (document.getElementById('st-hotel-out') || {}).value || '';
        var guests = (document.getElementById('st-hotel-guests') || {}).value || '2';
        var sub = sanitizeSubId('st_search' + (trafficExtra() ? '_' + trafficExtra() : ''));
        var href = trackedHref(brand, brandSearchUrl(brand.key, destination, checkIn, checkOut, guests), sub);
        if (!href) return;
        trackSt('st_affiliate_click', { partner: brand.key, sub_id: sub });
        window.open(href, '_blank', 'noopener');
      });
    }
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

  function stayLocalIso(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function stayBlockedSet(listing) {
    var set = {};
    (listing && listing.availability || []).forEach(function (row) {
      if (!row || row.is_available !== false || !row.starts_on || !row.ends_on) return;
      var cursor = new Date(String(row.starts_on).slice(0, 10) + 'T12:00:00');
      var end = new Date(String(row.ends_on).slice(0, 10) + 'T12:00:00');
      if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return;
      var guard = 0;
      while (cursor <= end && guard < 120) {
        set[stayLocalIso(cursor)] = true;
        cursor.setDate(cursor.getDate() + 1);
        guard += 1;
      }
    });
    return set;
  }

  function stayDayStrip(listing) {
    var blocked = stayBlockedSet(listing);
    var html = '<div id="st-day-strip" class="agent-booking-date-strip" aria-label="Blocked date">';
    for (var i = 0; i < 21; i += 1) {
      var day = new Date();
      day.setHours(12, 0, 0, 0);
      day.setDate(day.getDate() + i);
      var iso = stayLocalIso(day);
      var off = !!blocked[iso];
      html += '<button type="button" class="agent-booking-day' + (off ? ' is-blocked' : '') + '" data-stay-day="'
        + esc(iso) + '" data-stay-target="st-d-in"' + (off ? ' disabled' : '') + '><strong>' + day.getDate() + '</strong></button>';
    }
    return html + '</div>';
  }

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
          + (review.verified_stay ? '<span class="st-badge">' + esc(t('verifiedStay')) + '</span>' : '')
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
      + (listing.availability_label ? '<p class="st-help' + (listing.availability_tone === 'stale' ? '" style="color:#92400e"' : '" style="color:#15803d"') + '>' + esc(listing.availability_label) + '</p>' : '')
      + ((listing.availability || []).some(function (row) { return row && row.is_available === false; })
        ? '<p class="st-help">Blocked dates: ' + (listing.availability || []).filter(function (row) { return row && row.is_available === false; }).slice(0, 6).map(function (row) { return esc(row.starts_on) + ' to ' + esc(row.ends_on); }).join('; ') + '</p>'
        : '')
      + '<div class="st-form-grid" style="margin-top:12px">'
      + '<div><label class="st-label" for="st-d-in">Check in</label><input class="st-input" id="st-d-in" type="date" value="' + esc(q.check_in || '') + '"></div>'
      + '<div><label class="st-label" for="st-d-out">Check out</label><input class="st-input" id="st-d-out" type="date" value="' + esc(q.check_out || '') + '"></div>'
      + '</div>'
      + stayDayStrip(listing)
      + '<div style="margin-top:8px"><label class="st-label" for="st-d-guests">Guests</label><input class="st-input" id="st-d-guests" type="number" min="1" max="30" value="' + esc(q.guests || '1') + '"></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-d-email">Email (optional)</label><input class="st-input" id="st-d-email" type="email"></div>'
      + '<label class="st-check" style="margin-top:8px"><input type="checkbox" id="st-d-terms"> '
      + '<span><a href="/short-term/terms" data-st-link>' + esc(t('termsTitle')) + '</a></span></label>'
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
      + '<div class="agent-booking-tabs" role="tablist" id="st-intent-tabs">'
      + '<button type="button" class="is-active" data-st-intent="dates">Request these dates</button>'
      + '<button type="button" data-st-intent="callback">Request a callback</button>'
      + '<button type="button" data-st-intent="question">Ask a question</button>'
      + '</div>'
      + '<button class="st-contact-btn st-contact-form" type="button" id="st-enquire-open"><i class="fas fa-envelope"></i> ' + esc(t('requestDates')) + '</button>'
      + '<div id="st-enquire-shell"></div>'
      + '</div>'
      + '</aside>'
      + '</div>'
      + travelExtrasHtml('short-term-listing')
      + disclaimerBlock()
      + '</div>';
  }

  function enquiryFormHtml() {
    var intent = 'dates';
    var active = document.querySelector('#st-intent-tabs button.is-active');
    if (active) intent = active.getAttribute('data-st-intent') || 'dates';
    var dates = intent === 'dates';
    return '<form id="st-enquire-form" style="margin-top:12px;border-top:1px solid #dfe8e3;padding-top:12px" data-intent="' + esc(intent) + '">'
      + '<div><label class="st-label" for="st-e-name">Your name</label><input class="st-input" id="st-e-name" required></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-phone">Phone</label><input class="st-input" id="st-e-phone" placeholder="0780 000 000"></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-email">Email</label><input class="st-input" id="st-e-email" type="email"></div>'
      + (dates
        ? '<div style="margin-top:8px"><label class="st-label" for="st-e-guests">Guests</label><input class="st-input" id="st-e-guests" type="number" min="1" max="30"></div>'
        : '<input id="st-e-guests" type="hidden" value="1">')
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-msg">Message</label><textarea class="st-input" id="st-e-msg" style="min-height:70px" placeholder="What you need to know"></textarea></div>'
      + '<label class="st-check" style="margin-top:8px"><input type="checkbox" id="st-e-terms"> '
      + '<span><a href="/short-term/terms" data-st-link>' + esc(t('termsTitle')) + '</a></span></label>'
      + '<div id="st-enquire-feedback"></div>'
      + '<button class="st-btn st-btn-primary" type="submit" style="width:100%;margin-top:10px">' + esc(dates ? t('requestDates') : (intent === 'callback' ? 'Request a callback' : 'Ask a question')) + '</button>'
      + '<p class="st-help">' + esc(t('paymentDirect')) + '</p>'
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

    var dayStrip = document.getElementById('st-day-strip');
    if (dayStrip) {
      dayStrip.addEventListener('click', function (event) {
        var button = event.target.closest('[data-stay-day]');
        if (!button || button.disabled) return;
        var target = document.getElementById(button.getAttribute('data-stay-target') || 'st-d-in');
        var other = document.getElementById(target && target.id === 'st-d-in' ? 'st-d-out' : 'st-d-in');
        if (target && !target.value) target.value = button.getAttribute('data-stay-day') || '';
        else if (other) other.value = button.getAttribute('data-stay-day') || '';
        refreshQuote();
      });
    }

    function bindStayEnquiry() {
      var form = document.getElementById('st-enquire-form');
      if (!form || form.getAttribute('data-bound') === '1') return;
      form.setAttribute('data-bound', '1');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var feedback = document.getElementById('st-enquire-feedback');
        var from = document.getElementById('st-d-in');
        var to = document.getElementById('st-d-out');
        var terms = document.getElementById('st-e-terms') || document.getElementById('st-d-terms');
        var intent = form.getAttribute('data-intent') || 'dates';
        var guestsEl = document.getElementById('st-e-guests') || document.getElementById('st-d-guests');
        var emailEl = document.getElementById('st-e-email') || document.getElementById('st-d-email');
        api('/listings/' + encodeURIComponent(listing.id) + '/requests', {
          method: 'POST',
          body: {
            intent: intent,
            guest_name: (document.getElementById('st-e-name') || {}).value,
            guest_phone: (document.getElementById('st-e-phone') || {}).value,
            guest_email: emailEl ? emailEl.value : '',
            guests: guestsEl ? guestsEl.value : '',
            message: (document.getElementById('st-e-msg') || {}).value,
            check_in: intent === 'dates' && from ? from.value : '',
            check_out: intent === 'dates' && to ? to.value : '',
            terms_accepted: !!(terms && terms.checked)
          }
        }).then(function (payloadOut) {
          form.innerHTML = '<div class="st-ok"><b>' + esc(payloadOut.reference || '') + '</b><p>'
            + esc(payloadOut.message || 'We saved your request.') + '</p>'
            + (payloadOut.status_url ? '<p><a href="' + esc(payloadOut.status_url) + '">Track this request</a></p>' : '')
            + '<p class="st-help">' + esc(payloadOut.payment_line || t('paymentDirect')) + '</p></div>';
        }).catch(function (error) {
          if (feedback) {
            feedback.innerHTML = '<ul class="st-errors">'
              + ((error.details && error.details.length ? error.details : [error.message])
                .map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('')) + '</ul>';
          }
        });
      });
    }

    var tabs = document.getElementById('st-intent-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (event) {
        var button = event.target.closest('[data-st-intent]');
        if (!button) return;
        Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (item) {
          item.classList.toggle('is-active', item === button);
        });
        var shell = document.getElementById('st-enquire-shell');
        if (shell && shell.innerHTML) {
          shell.innerHTML = enquiryFormHtml();
          bindStayEnquiry();
        }
      });
    }

    var open = document.getElementById('st-enquire-open');
    if (open) {
      open.addEventListener('click', function () {
        trackSt('st_request_click', { listing_id: listing && listing.id });
        var shell = document.getElementById('st-enquire-shell');
        if (!shell || shell.innerHTML) return;
        shell.innerHTML = enquiryFormHtml();
        bindStayEnquiry();
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

  function mountDetail(slug, force) {
    var view = $('.st-view-detail');
    if (!view) return;
    if (!force && state.detailSlug === slug && (state.detailInflight || view.getAttribute('data-st-loaded') === slug)) return;
    state.detailSlug = slug;
    state.detailInflight = true;
    view.setAttribute('data-st-loaded', slug);
    view.innerHTML = '<div class="st-wrap"><div class="st-skeleton" style="height:340px;margin-top:20px"></div></div>';
    api('/listings/' + encodeURIComponent(slug)).then(function (payload) {
      view.innerHTML = detailViewHtml(payload);
      view.setAttribute('data-st-detail', slug);
      bindDetail(payload);
      document.title = payload.listing.title + ' | Short stay on makaug.com';
      trackSt('st_listing_view', { slug: slug });
    }).catch(function (error) {
      view.removeAttribute('data-st-loaded');
      view.innerHTML = '<div class="st-wrap"><div class="st-empty"><i class="fas fa-house-circle-xmark"></i>'
        + esc(error.status === 404 ? 'This short stay is no longer listed.' : error.message)
        + '<br><br><a class="st-btn st-btn-primary" href="/short-term" data-st-link>See what is available</a></div></div>';
    }).then(function () { state.detailInflight = false; });
  }

  function partnerDetailHtml(row) {
    var where = [row.area, row.district].filter(Boolean).join(', ');
    var slug = partnerSlug(row);
    return '<div class="st-wrap" style="padding:24px 16px 48px" data-st-partner-detail="' + esc(slug) + '">'
      + '<a href="/short-term" data-st-link>&larr; Short stays</a>'
      + '<h1 style="margin:12px 0 6px">' + esc(row.title) + '</h1>'
      + (where ? '<p class="st-card-where">' + esc(where) + '</p>' : '')
      + (row.primary_image
        ? '<img src="' + esc(row.primary_image) + '" alt="' + esc(row.title + (where ? ' in ' + where : '')) + '" style="width:100%;max-height:360px;object-fit:cover;border-radius:16px">'
        : '')
      + '<p class="st-partner-note">' + esc(t('partnerNote')) + '</p>'
      + (row.price_display
        ? '<p class="st-partner-price"><b>' + esc(row.price_display) + '</b> ' + esc(t('perNight'))
          + ' <span class="st-indicative">' + esc(t('indicative')) + '</span></p>'
        : '<p class="st-partner-price">' + esc(t('partnerPriceAsk')) + '</p>')
      + (row.host_phone
        ? '<p><a class="st-partner-call" href="tel:' + esc(String(row.host_phone).replace(/[^+0-9]/g, '')) + '">'
          + esc(row.host_phone) + '</a></p>'
        : '')
      + compareButtonsHtml(row.title, hotelSubId(slug))
      + travelExtrasHtml('short-term-listing')
      + '</div>';
  }

  function mountPartnerDetail(slug) {
    var view = $('.st-view-detail');
    if (!view) return;
    var known = (state.partners || []).filter(function (row) { return partnerSlug(row) === slug; })[0] || rememberedPartner(slug);
    if (known) {
      view.innerHTML = partnerDetailHtml(known);
      document.title = known.title + ' | Hotel guide | makaug.com';
      return;
    }
    view.innerHTML = '<div class="st-wrap"><div class="st-skeleton" style="height:240px;margin-top:20px"></div></div>';
    api('/search').then(function (payload) {
      state.partners = payload.partner_listings || [];
      var row = (state.partners || []).filter(function (item) { return partnerSlug(item) === slug; })[0];
      if (!row) {
        view.innerHTML = '<div class="st-wrap"><div class="st-empty">This hotel is not in the current partner list.'
          + '<br><br><a class="st-btn st-btn-primary" href="/short-term" data-st-link>Back to short stays</a></div></div>';
        return;
      }
      rememberPartner(row);
      view.innerHTML = partnerDetailHtml(row);
      document.title = row.title + ' | Hotel guide | makaug.com';
    }).catch(function (error) {
      view.innerHTML = '<div class="st-wrap"><div class="st-empty">' + esc(error.message || 'Could not load this hotel') + '</div></div>';
    });
  }

  // ---------------------------------------------------------------- list your place

  function listViewHtml() {
    var meta = state.meta || {};
    var amenities = meta.amenities || [];

    return ''
      + '<section class="st-hero"><div class="st-wrap">'
      + '<h1>List your short stay on makaug</h1>'
      + '<p class="st-hero-sub">' + esc(t('listFee')) + ' No commission on any stay, ever. Guests contact you directly on your own number — we never sit in the middle.</p>'
      + '</div></section>'

      + '<div class="st-wrap" style="padding-top:22px;padding-bottom:40px">'
      + '<div class="st-steps">'
      + '<span class="st-step is-on" data-step="1">1. The place</span>'
      + '<span class="st-step" data-step="2">2. Map pin</span>'
      + '<span class="st-step" data-step="3">3. Price and dates</span>'
      + '<span class="st-step" data-step="4">4. Rules and terms</span>'
      + '<span class="st-step" data-step="5">5. You and payment</span>'
      + '</div>'

      + '<form id="st-list-form" novalidate>'
      + '<div id="st-step-errors"></div>'

      // step 1
      + '<div class="st-panel" data-panel="1">'
      + '<h2>What are you listing?</h2>'
      + '<div class="st-form-grid">'
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-title">Title</label>'
      + '<input class="st-input" id="f-title" placeholder="Quiet 2-bed apartment in Naguru"></div>'
      + '<div><label class="st-label" for="f-place">Type of place</label><select class="st-input" id="f-place">'
      + '<option value="entire_place">Entire place</option><option value="private_room">Private room</option>'
      + '<option value="shared_room">Shared room</option></select></div>'
      + '<div><label class="st-label" for="f-ptype">Property type</label>'
      + '<input class="st-input" id="f-ptype" placeholder="Apartment, cottage, guest house"></div>'
      + '<div><label class="st-label" for="f-district">District</label><input class="st-input" id="f-district" placeholder="Kampala"></div>'
      + '<div><label class="st-label" for="f-area">Area / neighbourhood</label><input class="st-input" id="f-area" placeholder="Naguru"></div>'
      + '<div><label class="st-label" for="f-guests">Sleeps</label><input class="st-input" id="f-guests" type="number" min="1" value="2"></div>'
      + '<div><label class="st-label" for="f-bedrooms">Bedrooms</label><input class="st-input" id="f-bedrooms" type="number" min="0" value="1"></div>'
      + '<div><label class="st-label" for="f-beds">Beds</label><input class="st-input" id="f-beds" type="number" min="1" value="1"></div>'
      + '<div><label class="st-label" for="f-bathrooms">Bathrooms</label><input class="st-input" id="f-bathrooms" type="number" min="0" value="1"></div>'
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-desc">Describe it</label>'
      + '<textarea class="st-input" id="f-desc" placeholder="What is it actually like? What is nearby? What should a guest know before they arrive?"></textarea></div>'
      + '</div>'
      + '<h3>Amenities</h3>'
      + '<div class="st-amenity-pick">'
      + amenities.map(function (a) {
        return '<label><input type="checkbox" value="' + esc(a.slug) + '" data-amenity> ' + esc(a.label) + '</label>';
      }).join('')
      + '</div>'
      + '<h3>Photos</h3>'
      + '<label class="st-photo-drop" for="st-photo-input">'
      + '<i class="fas fa-camera"></i><span>Add photos now</span>'
      + '<input id="st-photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>'
      + '</label>'
      + '<div id="st-photo-tray" style="margin-top:14px"></div>'
      + '<div id="st-photo-feedback"></div>'
      + '<p class="st-help">Photos upload after the listing is saved. The first one becomes the cover.</p>'
      + '<button class="st-btn st-btn-primary" type="button" data-next="2" style="margin-top:14px">Next</button>'
      + '</div>'

      + '<div class="st-panel" data-panel="2" hidden>'
      + '<h2>Pin the place</h2>'
      + '<p class="st-help">Drop a pin so guests can see the neighbourhood. You can skip this if the map does not load.</p>'
      + '<div id="st-pin-map" class="st-pin-map"></div>'
      + '<input type="hidden" id="f-lat"><input type="hidden" id="f-lng">'
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="1">Back</button> '
      + '<button class="st-btn st-btn-primary" type="button" data-next="3">Next</button></div>'
      + '</div>'

      // step 3
      + '<div class="st-panel" data-panel="3" hidden>'
      + '<h2>Your price and your dates</h2>'
      + '<div class="st-form-grid">'
      + '<div><label class="st-label" for="f-nightly">Price per night (UGX)</label>'
      + '<input class="st-input" id="f-nightly" type="number" min="1000" step="1000" placeholder="200000"></div>'
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
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="2">Back</button> '
      + '<button class="st-btn st-btn-primary" type="button" data-next="4">Next</button></div>'
      + '</div>'

      // step 4
      + '<div class="st-panel" data-panel="4" hidden>'
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
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="3">Back</button> '
      + '<button class="st-btn st-btn-primary" type="button" data-next="5">Next</button></div>'
      + '</div>'

      // step 5
      + '<div class="st-panel" data-panel="5" hidden>'
      + '<h2>You, and how you want to be paid</h2>'
      + '<div class="st-form-grid">'
      + '<div><label class="st-label" for="f-hname">Name guests should ask for</label><input class="st-input" id="f-hname"></div>'
      + '<div><label class="st-label" for="f-hphone">Phone</label><input class="st-input" id="f-hphone" placeholder="0780 863 394"></div>'
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
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-utb">UTB licence number (optional)</label>'
      + '<input class="st-input" id="f-utb" placeholder="Uganda Tourism Board licence, if you have one"></div>'
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
      + '<li>' + esc(t('listFee')) + '</li>'
      + '<li>We can take a listing down if it is reported, inaccurate, or we cannot reach you.</li>'
      + '</ul></div>'

      + '<label class="st-check"><input type="checkbox" id="f-right"> '
      + '<span>I confirm I have the right to let this property out for short stays.</span></label>'
      + '<label class="st-check"><input type="checkbox" id="f-tax"> '
      + '<span>I understand I am responsible for my own tax and any local hotel tax on short stays.</span></label>'
      + '<label class="st-check"><input type="checkbox" id="f-terms-ok"> '
      + '<span>I accept the <a href="/short-term/terms" data-st-link>' + esc(t('termsTitle')) + '</a>.</span></label>'

      + '<div id="st-list-feedback"></div>'
      + '<p class="st-help" style="margin-top:8px"><i class="fas fa-floppy-disk"></i> '
      + '<span id="st-draft-note">This form saves itself on this device as you type.</span></p>'
      + '<p class="st-help" style="margin-top:12px"><i class="fas fa-camera"></i> '
      + 'Photos you added on the first step upload as soon as this listing is saved.</p>'
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="4">Back</button> '
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
    'f-hname', 'f-hphone', 'f-hwa', 'f-hemail', 'f-htype', 'f-pay', 'f-titleref', 'f-utb', 'f-lat', 'f-lng'
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
      + '<p>' + esc(t('feeAwaiting')) + '</p>'
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

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function stepErrors(step) {
    var errors = [];
    if (step === 1) {
      if (fieldValue('f-title').length < 8) errors.push('Give the place a title of at least 8 characters.');
      if (!fieldValue('f-district')) errors.push('District is required.');
      if (!fieldValue('f-area')) errors.push('Area or neighbourhood is required.');
      if (fieldValue('f-desc').length < 40) errors.push('Describe the place in at least 40 characters.');
    }
    if (step === 3) {
      var nightly = Number(fieldValue('f-nightly'));
      if (!(nightly > 0)) errors.push('Set a nightly price in Uganda Shillings.');
      if (nightly > 50000000) errors.push('That nightly price looks wrong. Check the figure.');
    }
    if (step === 5) {
      if (!fieldValue('f-hname')) errors.push('We need the name guests should ask for.');
      var digits = fieldValue('f-hphone').replace(/\D/g, '');
      if (digits.indexOf('0') === 0) digits = '256' + digits.slice(1);
      if (digits.length === 9) digits = '256' + digits;
      if (!/^256\d{9}$/.test(digits)) errors.push('A reachable Ugandan phone number is required, for example 0780 863 394.');
      var email = fieldValue('f-hemail');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push('That email address does not look right.');
      var right = document.getElementById('f-right');
      var terms = document.getElementById('f-terms-ok');
      if (!right || !right.checked) errors.push('You must confirm you have the right to let this place out.');
      if (!terms || !terms.checked) errors.push('You must accept the makaug listing terms.');
    }
    return errors;
  }

  function showStepErrors(errors) {
    var box = document.getElementById('st-step-errors');
    if (!box) return;
    box.innerHTML = errors && errors.length
      ? '<ul class="st-errors">' + errors.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>'
      : '';
  }

  function mountPinMap() {
    var host = document.getElementById('st-pin-map');
    if (!host) return;
    loadMapLibrary().then(function (ok) {
      if (!document.getElementById('st-pin-map')) return;
      if (!ok) {
        host.innerHTML = '<div class="st-empty">' + esc(t('mapFail')) + '</div>';
        return;
      }
      if (state.pinMap) {
        window.setTimeout(function () { try { state.pinMap.invalidateSize(); } catch (_error) {} }, 80);
        return;
      }
      var L = window.L;
      var map = L.map(host).setView([0.3476, 32.5825], 12);
      L.tileLayer(ST_TILE_URL, { attribution: ST_TILE_ATTRIBUTION, referrerPolicy: 'origin' }).addTo(map);
      var marker = null;
      function drop(latlng) {
        if (!marker) {
          marker = L.marker(latlng, { draggable: true }).addTo(map);
          marker.on('dragend', function () { drop(marker.getLatLng()); });
        } else {
          marker.setLatLng(latlng);
        }
        var lat = document.getElementById('f-lat');
        var lng = document.getElementById('f-lng');
        if (lat) lat.value = Number(latlng.lat).toFixed(6);
        if (lng) lng.value = Number(latlng.lng).toFixed(6);
        queueDraftSave();
      }
      map.on('click', function (event) { drop(event.latlng); });
      var savedLat = Number(fieldValue('f-lat'));
      var savedLng = Number(fieldValue('f-lng'));
      if (isFinite(savedLat) && isFinite(savedLng) && fieldValue('f-lat') && fieldValue('f-lng')) {
        drop({ lat: savedLat, lng: savedLng });
        map.setView([savedLat, savedLng], 14);
      }
      state.pinMap = map;
      window.setTimeout(function () { try { map.invalidateSize(); } catch (_error) {} }, 200);
    });
  }

  function showWizardStep(step) {
    $$('[data-panel]').forEach(function (panel) { panel.hidden = Number(panel.getAttribute('data-panel')) !== step; });
    $$('.st-step').forEach(function (stepEl) {
      var n = Number(stepEl.getAttribute('data-step'));
      stepEl.classList.toggle('is-on', n === step);
      stepEl.classList.toggle('is-done', n < step);
    });
    state.wizardStep = step;
    if (step === 2) mountPinMap();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function mountList() {
    var view = $('.st-view-list');
    if (!view) return;

    var render = function () {
      if (state.pinMap) {
        try { state.pinMap.remove(); } catch (_error) {}
        state.pinMap = null;
      }
      var draft = readDraft();
      view.innerHTML = listViewHtml();
      renderPhotoTray();
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

      var photoInput = document.getElementById('st-photo-input');
      if (photoInput && !photoInput.dataset.bound) {
        photoInput.dataset.bound = '1';
        photoInput.addEventListener('change', function () {
          addPhotoFiles(photoInput.files).then(function () { photoInput.value = ''; });
        });
      }

      view.addEventListener('click', function (e) {
        var photoRemove = e.target.closest('[data-photo-remove]');
        if (photoRemove && !state.listingId) {
          state.photos.splice(Number(photoRemove.getAttribute('data-photo-remove')), 1);
          renderPhotoTray();
          return;
        }
        var next = e.target.closest('[data-next]');
        if (next) {
          var step = Number(next.getAttribute('data-next'));
          if (step > state.wizardStep) {
            var problems = stepErrors(state.wizardStep);
            if (problems.length) {
              showStepErrors(problems);
              return;
            }
          }
          showStepErrors([]);
          showWizardStep(step);
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
          var firstBad = [1, 3, 5].filter(function (step) { return stepErrors(step).length; })[0];
          if (firstBad) {
            showWizardStep(firstBad);
            showStepErrors(stepErrors(firstBad));
            return;
          }

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
              utb_licence_number: val('f-utb'),
              latitude: val('f-lat'),
              longitude: val('f-lng'),
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
            if (state.photos.some(function (photo) { return photo.status === 'ready'; })) uploadPendingPhotos();
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

  function mountTerms() {
    var view = document.querySelector('#' + ROOT_ID + ' .st-view-detail');
    if (!view) return;
    view.innerHTML = '<div class="st-wrap" style="padding:28px 16px 48px;max-width:720px">'
      + '<h1 style="font-size:1.6rem;font-weight:900">' + esc(t('termsTitle')) + '</h1>'
      + '<p>' + esc(t('termsBody')) + '</p>'
      + '<p><b>' + esc(t('listFee')) + '</b></p>'
      + '<p><b>' + esc(t('paymentDirect')) + '</b></p>'
      + '<ul><li>' + esc(t('safetyView')) + '</li><li>' + esc(t('safetyName')) + '</li><li>' + esc(t('safetyReport')) + '</li></ul>'
      + '<p class="st-help">' + esc(t('termsLawyer')) + '</p>'
      + '<p class="st-help">makaug does not take bookings and does not handle money.</p>'
      + '</div>';
  }

  function requestStatusHtml(request) {
    var accepted = request.status === 'accepted' || request.status === 'completed';
    var contact = accepted
      ? '<p><b>' + esc(request.host_name || '') + '</b><br>'
        + esc(request.host_phone || '') + '<br>'
        + esc(request.address || '') + '</p>'
        + (request.check_in_from ? '<p>Check in from ' + esc(request.check_in_from) + '</p>' : '')
        + (request.house_rules ? '<p>' + esc(request.house_rules) + '</p>' : '')
      : '';
    var similar = (request.similar || []).map(function (item) {
      return '<li><a href="' + esc(item.url || '/short-term') + '" data-st-link>' + esc(item.title || '') + '</a></li>';
    }).join('');
    return '<div class="st-wrap" style="padding:28px 16px 48px;max-width:720px">'
      + '<p class="st-help">' + esc(request.reference || '') + ' · ' + esc(request.status || '') + '</p>'
      + '<h1 style="font-size:1.5rem;font-weight:900">' + esc(request.title || 'Stay request') + '</h1>'
      + '<p>' + esc(request.check_in || '') + ' → ' + esc(request.check_out || '') + '</p>'
      + contact
      + (similar ? '<h2>Similar places</h2><ul>' + similar + '</ul>' : '')
      + '<p><b>' + esc(request.payment_line || t('paymentDirect')) + '</b></p>'
      + '<ul><li>' + esc(t('safetyView')) + '</li><li>' + esc(t('safetyName')) + '</li><li>' + esc(t('safetyReport')) + '</li></ul>'
      + '</div>';
  }

  function mountGuestRequest(reference) {
    var view = document.querySelector('#' + ROOT_ID + ' .st-view-detail');
    if (!view) return;
    view.innerHTML = '<div class="st-wrap" style="padding:28px 16px"><p class="st-help">' + esc(t('loading')) + '</p></div>';
    api('/requests/' + encodeURIComponent(reference) + '?t=' + encodeURIComponent(qs().t || '')).then(function (payload) {
      view.innerHTML = requestStatusHtml(payload.request || {});
    }).catch(function (error) {
      view.innerHTML = '<div class="st-wrap" style="padding:28px 16px"><p>' + esc(error.message) + '</p></div>';
    });
  }

  function mountHost() {
    var view = document.querySelector('#' + ROOT_ID + ' .st-view-detail');
    if (!view) return;
    view.innerHTML = '<div class="st-wrap" style="padding:28px 16px"><p class="st-help">' + esc(t('loading')) + '</p></div>';
    api('/host/session?t=' + encodeURIComponent(qs().t || '')).then(function (payload) {
      var listing = payload.listing || {};
      var rows = (payload.requests || []).map(function (row) {
        var open = row.status === 'requested';
        return '<article class="st-panel"><p><b>' + esc(row.reference) + '</b> · ' + esc(row.status) + '</p>'
          + '<p>' + esc(row.check_in) + ' → ' + esc(row.check_out) + ' · ' + esc(row.guest_name || '') + '</p>'
          + (open
            ? '<button class="st-btn st-btn-primary" type="button" data-stay-decision="accept" data-stay-ref="' + esc(row.reference) + '">Accept</button> '
              + '<button class="st-btn" type="button" data-stay-decision="decline" data-stay-ref="' + esc(row.reference) + '">Decline</button>'
            : '')
          + '</article>';
      }).join('');
      view.innerHTML = '<div class="st-wrap" style="padding:28px 16px 48px;max-width:720px">'
        + '<h1 style="font-size:1.5rem;font-weight:900">' + esc(listing.title || 'Your place') + '</h1>'
        + '<p>' + esc(listing.fee_label || '') + '</p>'
        + (listing.id ? '<p><a href="/api/short-term/listings/' + esc(listing.id) + '/calendar.ics">Download blocked dates</a></p>' : '')
        + '<p><b>' + esc(t('paymentDirect')) + '</b></p>'
        + '<form id="st-host-price"><label class="st-label">Nightly price (UGX)</label>'
        + '<input class="st-input" id="st-host-nightly" value="' + esc(listing.nightly_ugx || '') + '">'
        + '<button class="st-btn" type="submit">Save price</button></form>'
        + '<form id="st-host-block" style="margin-top:12px"><label class="st-label">Block dates</label>'
        + '<input class="st-input" id="st-host-from" type="date"> <input class="st-input" id="st-host-to" type="date">'
        + '<button class="st-btn" type="submit">Block</button></form>'
        + '<form id="st-host-photo" style="margin-top:12px"><label class="st-label">Add a photo</label>'
        + '<input id="st-host-file" type="file" accept="image/jpeg,image/png,image/webp">'
        + '<button class="st-btn" type="submit">Upload</button></form>'
        + '<form id="st-host-ical" style="margin-top:12px"><label class="st-label">Airbnb or Booking.com calendar link</label>'
        + '<input class="st-input" id="st-host-ical-url" placeholder="https://">'
        + '<button class="st-btn" type="submit">Import</button></form>'
        + '<div id="st-host-requests">' + (rows || '<p class="st-help">No requests yet.</p>') + '</div>'
        + '<div id="st-host-feedback"></div></div>';
      bindHost(payload);
    }).catch(function (error) {
      view.innerHTML = '<div class="st-wrap" style="padding:28px 16px"><p>' + esc(error.message) + '</p></div>';
    });
  }

  function bindHost(payload) {
    var token = qs().t || '';
    var feedback = document.getElementById('st-host-feedback');
    function note(text) { if (feedback) feedback.textContent = text; }
    var price = document.getElementById('st-host-price');
    if (price) price.addEventListener('submit', function (e) {
      e.preventDefault();
      api('/host/price', { method: 'POST', body: { token: token, nightly_ugx: (document.getElementById('st-host-nightly') || {}).value } })
        .then(function () { note('Price saved'); }).catch(function (error) { note(error.message); });
    });
    var block = document.getElementById('st-host-block');
    if (block) block.addEventListener('submit', function (e) {
      e.preventDefault();
      api('/host/availability', { method: 'POST', body: {
        token: token,
        starts_on: (document.getElementById('st-host-from') || {}).value,
        ends_on: (document.getElementById('st-host-to') || {}).value,
        is_available: false
      } }).then(function () { note('Dates blocked'); }).catch(function (error) { note(error.message); });
    });
    var ical = document.getElementById('st-host-ical');
    if (ical) ical.addEventListener('submit', function (e) {
      e.preventDefault();
      api('/host/ical', { method: 'POST', body: { token: token, url: (document.getElementById('st-host-ical-url') || {}).value } })
        .then(function () { note('Calendar imported'); }).catch(function (error) { note(error.message); });
    });
    var photo = document.getElementById('st-host-photo');
    if (photo) photo.addEventListener('submit', function (e) {
      e.preventDefault();
      var file = (document.getElementById('st-host-file') || {}).files;
      file = file && file[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        api('/host/photos', { method: 'POST', body: { token: token, data_url: reader.result, caption: '' } })
          .then(function () { note('Photo saved'); }).catch(function (error) { note(error.message); });
      };
      reader.readAsDataURL(file);
    });
    var box = document.getElementById('st-host-requests');
    if (box) box.addEventListener('click', function (e) {
      var button = e.target.closest('[data-stay-decision]');
      if (!button) return;
      api('/host/requests/' + encodeURIComponent(button.getAttribute('data-stay-ref')), {
        method: 'POST',
        body: { token: token, decision: button.getAttribute('data-stay-decision') }
      }).then(function () { mountHost(); }).catch(function (error) { note(error.message); });
    });
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
      try { window.showPage('short-term', { scroll: false, history: false }); } catch (_e) {}
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
      if (!document.getElementById('st-list-form')) mountList();
      return;
    }
    var hotel = path.match(/^\/short-term\/hotel\/([a-z0-9-]+)$/);
    if (hotel) {
      setView('detail');
      mountPartnerDetail(hotel[1]);
      return;
    }
    if (path === '/short-term/terms') {
      setView('detail');
      mountTerms();
      return;
    }
    if (path === '/short-term/host') {
      setView('detail');
      mountHost();
      return;
    }
    var requestPath = path.match(/^\/short-term\/requests\/([A-Za-z0-9-]+)$/);
    if (requestPath) {
      setView('detail');
      mountGuestRequest(requestPath[1]);
      return;
    }
    if (path.indexOf('/short-term/') === 0) {
      setView('detail');
      mountDetail(path.slice('/short-term/'.length));
      return;
    }
    setView('search');
    loadTravelpayoutsDrive();
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
  // Image errors do not bubble, so this listens in the capture phase. One
  // listener for the whole section rather than an inline handler per card.
  function ensureImageFallback() {
    var r = root();
    if (!r || r.__stShotsBound) return;
    r.__stShotsBound = true;
    r.addEventListener('error', function (event) {
      var img = event.target;
      if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-st-shots')) return;
      var rest = (img.getAttribute('data-st-shots') || '').split(' ').filter(Boolean);
      if (rest.length) {
        img.setAttribute('data-st-shots', rest.slice(1).join(' '));
        img.src = rest[0];
        return;
      }
      // Out of photos. A hotel icon beats a broken one.
      img.removeAttribute('data-st-shots');
      var holder = img.parentNode;
      if (holder) holder.innerHTML = '<div class="st-noimg"><i class="fas fa-hotel"></i></div>'
        + holder.innerHTML.replace(/<img[^>]*>/, '');
    }, true);
  }

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
    ensureImageFallback();
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

  document.addEventListener('click', function (e) {
    var more = e.target.closest ? e.target.closest('#st-partners-more') : null;
    if (more) {
      state.partnerShown = 999;
      renderResults();
      return;
    }
    var extra = e.target.closest ? e.target.closest('[data-st-extra]') : null;
    if (extra) {
      fireAffiliateClick(extra.getAttribute('data-st-extra') || '', extra.getAttribute('data-st-extra-placement') || 'short-term');
    }
    var affiliate = e.target.closest ? e.target.closest('[data-st-affiliate]') : null;
    if (affiliate) {
      trackSt('st_affiliate_click', {
        partner: affiliate.getAttribute('data-st-affiliate') || '',
        sub_id: affiliate.getAttribute('data-st-sub') || ''
      });
    }
    var whatsapp = e.target.closest ? e.target.closest('a[href*="wa.me"]') : null;
    if (whatsapp && root() && root().contains(whatsapp)) {
      trackSt('st_whatsapp_click', { source: whatsapp.getAttribute('data-st-contact') || 'whatsapp' });
    }
  });

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
    var hotel = path.match(/^\/short-term\/hotel\/([a-z0-9-]+)$/);
    if (hotel) { mountPartnerDetail(hotel[1]); return; }
    if (path === '/short-term/terms') { mountTerms(); return; }
    if (path === '/short-term/host') { mountHost(); return; }
    var req = path.match(/^\/short-term\/requests\/([A-Za-z0-9-]+)$/);
    if (req) { mountGuestRequest(req[1]); return; }
    if (path.indexOf('/short-term/') === 0) { mountDetail(path.slice(12), true); return; }
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
