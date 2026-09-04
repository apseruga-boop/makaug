(function initializeOffPlanFeature() {
  'use strict';

  const state = {
    loaded: false,
    loading: false,
    pendingReload: false,
    projects: [],
    activeProject: null,
    contactMode: 'listing_request',
    contactDevelopmentId: null,
    selectedLocation: null,
    locationSuggestions: [],
    locationTimer: null,
    map: null,
    detailMap: null,
    mapMarkers: [],
    mortgageProviders: [],
    mortgageLoaded: false,
    agentProfile: null,
    mapVisible: true,
    managementLoaded: { staff: false, admin: false }
  };

  const OFF_PLAN_I18N = {
    en: {
      heroEyebrow: 'New developments in Uganda', heroTitle: 'Find your future home, before it is built', heroSubtitle: 'Explore verified off-plan projects, compare unit types, understand construction and sales progress, and model payment options in Uganda shillings.', projectSearch: 'Project, area or developer', location: 'Location', allLocations: 'All locations', bedrooms: 'Bedrooms', anyBedrooms: 'Any bedrooms', oneBedroom: '1 bedroom', twoBedrooms: '2 bedrooms', threeBedrooms: '3 bedrooms', fourBedrooms: '4+ bedrooms', maximumPrice: 'Maximum price', anyPrice: 'Any price', upTo250: 'Up to USh 250M', upTo500: 'Up to USh 500M', upTo1B: 'Up to USh 1B', upTo2B: 'Up to USh 2B', search: 'Search', sectionEyebrow: 'Off plan Uganda', newProjects: 'New projects', loadingProjects: 'Loading verified projects...', listProject: 'List an off-plan project', reviewTitle: 'Review before release', reviewBody: 'Projects appear here only after the makaug team checks the developer, location, pricing, progress and availability evidence.', paymentsTitle: 'Plan the payments', paymentsBody: 'Choose a unit and create a dated, illustrative UGX instalment schedule. Then compare mortgage options.', backToProjects: 'Back to off-plan projects', partner: 'Partner with makaug', contactQuestion: 'How would you like the team to contact you?', close: 'Close', continueChat: 'Continue in chat', email: 'Email', replyEmail: 'Reply by email', callMe: 'Call me', chooseTime: 'Choose a time', yourName: 'Your name', fullName: 'Full name', phone: 'WhatsApp / phone', preferredCallTime: 'Preferred call time', contactNote: 'We will ask for the project name, location, completion date, brochure, images, construction progress and current sales. Every project stays in staff review until verified.', submitWhatsApp: 'Continue with WhatsApp', submitEmail: 'Ask the team to email me', submitCall: 'Request a call', noProjectsTitle: 'No verified projects match this search yet', noProjectsBody: 'New developments stay out of public results until the makaug team verifies the facts. Try another location or ask us to review a project.', noProjectsSummary: 'No verified projects found', projectsFound: '{count} verified project(s) found', pageTitle: 'Off Plan Property in Uganda | makaug.com', enquireProject: 'Enquire about {name}'
    },
    lg: {
      heroEyebrow: 'Enkulaakulana empya mu Uganda', heroTitle: "Noonya amaka go ag'omu maaso nga tegannazimbibwa", heroSubtitle: "Kebera pulojekiti za off-plan ezikakasiddwa, gerageranya ebika by'amayumba, manya enkulaakulana y'okuzimba n'okutunda, era teekateeka okusasula mu ssiringi za Uganda.", projectSearch: 'Pulojekiti, ekitundu oba omuzimbi', location: 'Ekifo', allLocations: 'Ebifo byonna', bedrooms: 'Ebisenge', anyBedrooms: 'Ebisenge byonna', oneBedroom: 'Ekisenge 1', twoBedrooms: 'Ebisenge 2', threeBedrooms: 'Ebisenge 3', fourBedrooms: 'Ebisenge 4+', maximumPrice: 'Omuwendo ogusembayo', anyPrice: 'Omuwendo gwonna', search: 'Noonya', sectionEyebrow: 'Off plan Uganda', newProjects: 'Pulojekiti empya', loadingProjects: 'Pulojekiti ezikakasiddwa zitikkibwa...', listProject: 'Teeka pulojekiti ya off-plan', reviewTitle: 'Ekeberwe nga tennfulumizibwa', reviewBody: "Pulojekiti erabika wano oluvannyuma lwa ttiimu ya makaug okukakasa omuzimbi, ekifo, emiwendo, enkulaakulana n'amayumba agakyaliwo.", paymentsTitle: 'Teekateeka okusasula', paymentsBody: 'Londa ennyumba okole enteekateeka y’okusasula mu UGX eraga ennaku, oluvannyuma ogigerageranye n’omusingo.', backToProjects: 'Ddayo ku pulojekiti za off-plan', partner: 'Koleragana ne makaug', contactQuestion: 'Oyagala ttiimu ekutuukirire etya?', close: 'Ggalawo', continueChat: 'Weyongereyo mu chat', email: 'Email', replyEmail: 'Ddamu ku email', callMe: 'Nkubira essimu', chooseTime: 'Londa obudde', yourName: 'Erinnya lyo', fullName: 'Erinnya lyonna', phone: 'WhatsApp / essimu', preferredCallTime: "Obudde bw'oyagala okukubirwamu", contactNote: "Tujja kubuuza erinnya lya pulojekiti, ekifo, olunaku lw'okuggwa, brochure, ebifaananyi, enkulaakulana y'okuzimba n'ebyatundiddwa. Buli pulojekiti esigala mu kwekenneenya kwa bakozi okutuusa ng'ekakasiddwa.", submitWhatsApp: 'Weyongereyo ku WhatsApp', submitEmail: 'Saba ttiimu ekuddemu ku email', submitCall: 'Saba okukubirwa essimu', noProjectsTitle: 'Tewali pulojekiti nkakafu ekwatagana n’okunoonya kuno', noProjectsBody: 'Pulojekiti empya tezifuluma mu lukale okutuusa ttiimu ya makaug ng’ekakasizza ebikwata ku zo. Gezaako ekifo ekirala oba tusabe tugikebere.', noProjectsSummary: 'Tewali pulojekiti nkakafu ezuuliddwa', projectsFound: 'Pulojekiti nkakafu {count} ezuuliddwa', enquireProject: 'Buuza ku {name}'
    },
    sw: {
      heroEyebrow: 'Miradi mipya nchini Uganda', heroTitle: 'Pata nyumba yako ya baadaye kabla haijajengwa', heroSubtitle: 'Chunguza miradi ya off-plan iliyothibitishwa, linganisha aina za nyumba, fuatilia ujenzi na mauzo, na upange malipo kwa shilingi za Uganda.', projectSearch: 'Mradi, eneo au msanidi', location: 'Eneo', allLocations: 'Maeneo yote', bedrooms: 'Vyumba vya kulala', anyBedrooms: 'Vyumba vyovyote', oneBedroom: 'Chumba 1', twoBedrooms: 'Vyumba 2', threeBedrooms: 'Vyumba 3', fourBedrooms: 'Vyumba 4+', maximumPrice: 'Bei ya juu', anyPrice: 'Bei yoyote', search: 'Tafuta', sectionEyebrow: 'Off plan Uganda', newProjects: 'Miradi mipya', loadingProjects: 'Inapakia miradi iliyothibitishwa...', listProject: 'Orodhesha mradi wa off-plan', reviewTitle: 'Ukaguzi kabla ya kuchapishwa', reviewBody: 'Miradi huonekana hapa baada ya timu ya makaug kukagua msanidi, eneo, bei, maendeleo na ushahidi wa upatikanaji.', paymentsTitle: 'Panga malipo', paymentsBody: 'Chagua nyumba na utengeneze ratiba ya mfano ya malipo ya UGX yenye tarehe. Kisha linganisha chaguo za mkopo wa nyumba.', backToProjects: 'Rudi kwenye miradi ya off-plan', partner: 'Shirikiana na makaug', contactQuestion: 'Ungependa timu iwasiliane nawe vipi?', close: 'Funga', continueChat: 'Endelea kwenye gumzo', email: 'Barua pepe', replyEmail: 'Jibu kwa barua pepe', callMe: 'Nipigie simu', chooseTime: 'Chagua muda', yourName: 'Jina lako', fullName: 'Jina kamili', phone: 'WhatsApp / simu', preferredCallTime: 'Muda unaopendelea kupigiwa', contactNote: 'Tutauliza jina la mradi, eneo, tarehe ya kukamilika, brosha, picha, maendeleo ya ujenzi na mauzo ya sasa. Kila mradi hubaki kwenye ukaguzi wa wafanyakazi hadi uthibitishwe.', submitWhatsApp: 'Endelea na WhatsApp', submitEmail: 'Omba timu initumie barua pepe', submitCall: 'Omba kupigiwa simu', noProjectsTitle: 'Hakuna mradi uliothibitishwa unaolingana na utafutaji huu', noProjectsBody: 'Miradi mipya haionekani hadharani hadi timu ya makaug ithibitishe taarifa. Jaribu eneo lingine au utuombe tukague mradi.', noProjectsSummary: 'Hakuna miradi iliyothibitishwa', projectsFound: 'Miradi iliyothibitishwa {count} imepatikana', enquireProject: 'Ulizia kuhusu {name}'
    },
    ac: {
      heroEyebrow: 'Purujekti manyen i Uganda', heroTitle: 'Nong ot mamegi me anyim mapwod pe oger', heroSubtitle: 'Nen purujekti me off-plan ma kimoko, por kit odi, nge kit gedo ki cato, ki yub cul i shilling me Uganda.', projectSearch: 'Purujekti, kabedo onyo lagwedo', location: 'Kabedo', allLocations: 'Kabedo ducu', bedrooms: 'Otino nino', anyBedrooms: 'Otino nino mo keken', oneBedroom: 'Ot nino 1', twoBedrooms: 'Ot nino 2', threeBedrooms: 'Ot nino 3', fourBedrooms: 'Ot nino 4+', maximumPrice: 'Wel mamalo', anyPrice: 'Wel mo keken', search: 'Yeny', sectionEyebrow: 'Off plan Uganda', newProjects: 'Purujekti manyen', loadingProjects: 'Tye ka cano purujekti ma kimoko...', listProject: 'Ket purujekti me off-plan', reviewTitle: 'Nen mapwod pe gikelo bot lwak', reviewBody: 'Purujekti bino nen kany inge kare ma dul pa makaug omoko lagwedo, kabedo, wel, kit gedo ki odi ma pud tye.', paymentsTitle: 'Yub cul', paymentsBody: 'Yer ot ci yub kit cul me anyim i UGX, ka ipor ki mortgage.', backToProjects: 'Dok cen bot purujekti me off-plan', partner: 'Tic kacel ki makaug', contactQuestion: 'Imito dul okube kwedi nining?', close: 'Lor', continueChat: 'Mede i chat', email: 'Email', replyEmail: 'Dwok ki email', callMe: 'Lwonga', chooseTime: 'Yer cawa', yourName: 'Nyingi', fullName: 'Nying ducu', phone: 'WhatsApp / cim', preferredCallTime: 'Cawa ma imito kilwongi', contactNote: 'Dul bipenyo nying purujekti, kabedo, nino me tyeko, brochure, cal, kit gedo ki kit cato. Purujekti bedo i neno pa lutic naka kimoke.', submitWhatsApp: 'Mede ki WhatsApp', submitEmail: 'Kwa dul odwoki ki email', submitCall: 'Kwa lwongo', noProjectsTitle: 'Purujekti ma kimoko pe rwate ki yeny man', noProjectsBody: 'Purujekti manyen pe bino bot lwak naka dul pa makaug omoko lok ada. Tem kabedo mukene onyo kwa wa wanen purujekti.', noProjectsSummary: 'Purujekti ma kimoko pe ononge', projectsFound: 'Purujekti ma kimoko {count} ononge', enquireProject: 'Peny pi {name}'
    },
    ny: {
      heroEyebrow: 'Entunguuka ensya omu Uganda', heroTitle: 'Ronda eka yaawe y’omumaisho etakazimbirwe', heroSubtitle: 'Reeba pulojekiti za off-plan ezihamiibwe, geragyeranisa amaka, orondore okuzimba n’okutunda, kandi otebeekanise okusasura omu shiringi za Uganda.', projectSearch: 'Pulojekiti, omwanya nari omwombeki', location: 'Omwanya', allLocations: 'Emyanya yoona', bedrooms: 'Ebishenge', anyBedrooms: 'Ebishenge byona', oneBedroom: 'Ekishenge 1', twoBedrooms: 'Ebishenge 2', threeBedrooms: 'Ebishenge 3', fourBedrooms: 'Ebishenge 4+', maximumPrice: 'Omuhendo gw’ahaiguru', anyPrice: 'Omuhendo gwona', search: 'Ronda', sectionEyebrow: 'Off plan Uganda', newProjects: 'Pulojekiti ensya', loadingProjects: 'Pulojekiti ezihamiibwe nizitwarwa...', listProject: 'Taho pulojekiti ya off-plan', reviewTitle: 'Kushwijuma etakashohorwe', reviewBody: 'Pulojekiti nizireebwa hanu bwanyima ya tiimu ya makaug kuhamya omwombeki, omwanya, emihendo, entunguuka n’amaka agarikwija kubaho.', paymentsTitle: 'Teekateeka okusasura', paymentsBody: 'Toorana eka kandi okore enteekateeka y’okusasura omu UGX erimu ebiro. Bwanyima geragyeranisa mortgage.', backToProjects: 'Garuka aha pulojekiti za off-plan', partner: 'Kora na makaug', contactQuestion: 'Nooyenda tiimu ekukwateho eta?', close: 'Gara', continueChat: 'Gumizamu omu chat', email: 'Email', replyEmail: 'Garukamu na email', callMe: 'Nyeta', chooseTime: 'Toorana obwire', yourName: 'Eiziina ryawe', fullName: 'Eiziina ryona', phone: 'WhatsApp / esimu', preferredCallTime: 'Obwire bw’okukwetera', contactNote: 'Nitwija kubuuza eiziina rya pulojekiti, omwanya, ebiro by’okuhendera, brochure, ebishushani, entunguuka y’okuzimba n’ebyatundwa. Buri pulojekiti neeguma omu kushwijuma kuhisya yaahamiibwe.', submitWhatsApp: 'Gumizamu na WhatsApp', submitEmail: 'Shaba tiimu ekugarukemu na email', submitCall: 'Shaba okukwetwa', noProjectsTitle: 'Tihariho pulojekiti ehamiibwe erikuhika aha kuronda oku', noProjectsBody: 'Pulojekiti ensya tizireebwa abantu kuhisya tiimu ya makaug yaahamya amakuru. Teeraho omwanya ogundi nari otushabe kushwijuma pulojekiti.', noProjectsSummary: 'Tihariho pulojekiti ehamiibwe eboine', projectsFound: 'Pulojekiti ezihamiibwe {count} ziboine', enquireProject: 'Buuza aha {name}'
    },
    rn: {
      heroEyebrow: 'Entunguuka nsya omuri Uganda', heroTitle: 'Shaka eka yawe y’omumaisho etakazimbirwe', heroSubtitle: 'Reeba pulojekiti za off-plan ezihamiibwe, geragyeranisa amaka, omanye okuhika kw’okuzimba n’okutunda, kandi oteekateeke okusasura omu shiringi za Uganda.', projectSearch: 'Pulojekiti, ekicweka nari omwombeki', location: 'Ekicweka', allLocations: 'Ebicweka byona', bedrooms: 'Ebishenge', anyBedrooms: 'Ebishenge byona', oneBedroom: 'Ekishenge 1', twoBedrooms: 'Ebishenge 2', threeBedrooms: 'Ebishenge 3', fourBedrooms: 'Ebishenge 4+', maximumPrice: 'Omuhendo gw’ahaiguru', anyPrice: 'Omuhendo gwona', search: 'Shaka', sectionEyebrow: 'Off plan Uganda', newProjects: 'Pulojekiti nsya', loadingProjects: 'Pulojekiti ezihamiibwe nizitwarwa...', listProject: 'Taho pulojekiti ya off-plan', reviewTitle: 'Shwijuma etakashohorwe', reviewBody: 'Pulojekiti nizireebwa hanu tiimu ya makaug yaaheza kuhamya omwombeki, ekicweka, emihendo, okuhika n’amaka agarikwija kubaho.', paymentsTitle: 'Teekateeka okusasura', paymentsBody: 'Toorana eka okore enteekateeka y’okusasura omu UGX erimu ebiro, reero ogeragyeranise mortgage.', backToProjects: 'Garuka aha pulojekiti za off-plan', partner: 'Kora na makaug', contactQuestion: 'Nooyenda tiimu ekukwateho eta?', close: 'Gara', continueChat: 'Gumizamu omu chat', email: 'Email', replyEmail: 'Garukamu na email', callMe: 'Nyeta', chooseTime: 'Toorana obwire', yourName: 'Eiziina ryawe', fullName: 'Eiziina ryona', phone: 'WhatsApp / esimu', preferredCallTime: 'Obwire bw’okukwetera', contactNote: 'Nitwija kubuuza eiziina rya pulojekiti, ekicweka, ebiro by’okuhendera, brochure, ebishushani, okuhika kw’okuzimba n’ebyatundwa. Buri pulojekiti neeguma omu kushwijuma kuhisya yaahamiibwe.', submitWhatsApp: 'Gumizamu na WhatsApp', submitEmail: 'Shaba tiimu ekugarukemu na email', submitCall: 'Shaba okukwetwa', noProjectsTitle: 'Tihariho pulojekiti ehamiibwe erikuhika aha kushaka oku', noProjectsBody: 'Pulojekiti nsya tizireebwa abantu kuhisya tiimu ya makaug yaahamya amakuru. Teeraho ekicweka ekindi nari otushabe kushwijuma pulojekiti.', noProjectsSummary: 'Tihariho pulojekiti ehamiibwe eboine', projectsFound: 'Pulojekiti ezihamiibwe {count} ziboine', enquireProject: 'Buuza aha {name}'
    },
    sm: {
      heroEyebrow: 'Enkulaakulana empyaka mu Uganda', heroTitle: 'Noonia amaka go ag’omu maiso nga gakaali kuzimbibwa', heroSubtitle: 'Kebera pulojekiti dha off-plan edhikakasiddwa, gerageranya ebika by’amaka, omanye okuzimba n’okutunda bwe biri, era otegekere okusasula mu shiringi dha Uganda.', projectSearch: 'Pulojekiti, ekifo oba omuzimbi', location: 'Ekifo', allLocations: 'Ebifo byonabyona', bedrooms: 'Ebisenge', anyBedrooms: 'Ebisenge byonabyona', oneBedroom: 'Ekisenge 1', twoBedrooms: 'Ebisenge 2', threeBedrooms: 'Ebisenge 3', fourBedrooms: 'Ebisenge 4+', maximumPrice: 'Omuwendo ogusembayo', anyPrice: 'Omuwendo gwonagwona', search: 'Noonia', sectionEyebrow: 'Off plan Uganda', newProjects: 'Pulojekiti empyaka', loadingProjects: 'Pulojekiti edhikakasiddwa dhitikkibwa...', listProject: 'Teeka pulojekiti ya off-plan', reviewTitle: 'Kebera nga ekaali kufulumizibwa', reviewBody: 'Pulojekiti eboneka ano oluvainhuma lwa tiimu ya makaug okukakasa omuzimbi, ekifo, emiwendo, okuzimba n’amaka agakaaliwo.', paymentsTitle: 'Teekateeka okusasula', paymentsBody: 'Londa eka era okole enteekateeka y’okusasula mu UGX eraga ennaku, oluvainhuma gerageranya mortgage.', backToProjects: 'Irayo ku pulojekiti dha off-plan', partner: 'Koleragana ne makaug', contactQuestion: 'Oyenda tiimu ekutuukirire etya?', close: 'Gala', continueChat: 'Weeyongereyo mu chat', email: 'Email', replyEmail: 'Ddamu ku email', callMe: 'Nkubira', chooseTime: 'Londa obwire', yourName: 'Eriina lyo', fullName: 'Eriina lyonalyona', phone: 'WhatsApp / esimu', preferredCallTime: 'Obwire bw’oyenda okukubirwamu', contactNote: 'Tuja kubuuza eriina lya pulojekiti, ekifo, olunaku lw’okumaliriza, brochure, ebifaananyi, okuzimba n’ebyatundibwa. Buli pulojekiti esigala mu kwekenneenya okutuusa ng’ekakasiddwa.', submitWhatsApp: 'Weeyongereyo ku WhatsApp', submitEmail: 'Saba tiimu ekuddemu ku email', submitCall: 'Saba okukubirwa', noProjectsTitle: 'Ezira pulojekiti nkakafu ekwatagana n’okunoonia kuno', noProjectsBody: 'Pulojekiti empyaka tedhiboneka bantu okutuusa tiimu ya makaug ng’ekakasizza amakuru. Gezaaku ekifo ekindi oba tusabe tugikebere.', noProjectsSummary: 'Ezira pulojekiti nkakafu ezuuliddwa', projectsFound: 'Pulojekiti nkakafu {count} ezuuliddwa', enquireProject: 'Buuza ku {name}'
    },
    am: {
      heroEyebrow: 'በዩጋንዳ አዳዲስ የልማት ፕሮጀክቶች', heroTitle: 'የወደፊት ቤትዎን ከመገንባቱ በፊት ያግኙ', heroSubtitle: 'የተረጋገጡ የ off-plan ፕሮጀክቶችን ይመልከቱ፣ የቤት ዓይነቶችን ያወዳድሩ፣ የግንባታና የሽያጭ ሂደትን ይከታተሉ፣ ክፍያንም በዩጋንዳ ሺሊንግ ያቅዱ።', projectSearch: 'ፕሮጀክት፣ አካባቢ ወይም አልሚ', location: 'አካባቢ', allLocations: 'ሁሉም አካባቢዎች', bedrooms: 'መኝታ ቤቶች', anyBedrooms: 'ማንኛውም መኝታ ቤት', oneBedroom: '1 መኝታ ቤት', twoBedrooms: '2 መኝታ ቤቶች', threeBedrooms: '3 መኝታ ቤቶች', fourBedrooms: '4+ መኝታ ቤቶች', maximumPrice: 'ከፍተኛ ዋጋ', anyPrice: 'ማንኛውም ዋጋ', search: 'ፈልግ', sectionEyebrow: 'Off plan Uganda', newProjects: 'አዳዲስ ፕሮጀክቶች', loadingProjects: 'የተረጋገጡ ፕሮጀክቶች በመጫን ላይ...', listProject: 'የ off-plan ፕሮጀክት ያስገቡ', reviewTitle: 'ከመለቀቁ በፊት ምርመራ', reviewBody: 'ፕሮጀክቶች አልሚው፣ አካባቢው፣ ዋጋው፣ የግንባታ ሂደቱና ተገኝነቱ በmakaug ቡድን ከተረጋገጠ በኋላ ብቻ እዚህ ይታያሉ።', paymentsTitle: 'ክፍያዎችን ያቅዱ', paymentsBody: 'ቤት ይምረጡና ቀን ያለው የUGX የክፍያ እቅድ ይፍጠሩ። ከዚያ የብድር አማራጮችን ያወዳድሩ።', backToProjects: 'ወደ off-plan ፕሮጀክቶች ተመለስ', partner: 'ከmakaug ጋር ይስሩ', contactQuestion: 'ቡድኑ እንዴት እንዲያገኝዎት ይፈልጋሉ?', close: 'ዝጋ', continueChat: 'በውይይት ቀጥል', email: 'ኢሜይል', replyEmail: 'በኢሜይል መልስ', callMe: 'ይደውሉልኝ', chooseTime: 'ጊዜ ይምረጡ', yourName: 'ስምዎ', fullName: 'ሙሉ ስም', phone: 'WhatsApp / ስልክ', preferredCallTime: 'የሚመች የጥሪ ጊዜ', contactNote: 'የፕሮጀክቱን ስም፣ አካባቢ፣ የማጠናቀቂያ ቀን፣ ብሮሹር፣ ምስሎች፣ የግንባታ ሂደትና ወቅታዊ ሽያጭ እንጠይቃለን። ሁሉም ፕሮጀክት እስኪረጋገጥ ድረስ በሰራተኞች ምርመራ ውስጥ ይቆያል።', submitWhatsApp: 'በWhatsApp ቀጥል', submitEmail: 'ቡድኑ ኢሜይል እንዲልክልኝ ጠይቅ', submitCall: 'ጥሪ ጠይቅ', noProjectsTitle: 'ከዚህ ፍለጋ ጋር የሚዛመድ የተረጋገጠ ፕሮጀክት የለም', noProjectsBody: 'አዳዲስ ፕሮጀክቶች መረጃቸው በmakaug ቡድን እስኪረጋገጥ ድረስ በይፋ አይታዩም። ሌላ አካባቢ ይሞክሩ ወይም ፕሮጀክት እንድንመረምር ይጠይቁ።', noProjectsSummary: 'የተረጋገጠ ፕሮጀክት አልተገኘም', projectsFound: '{count} የተረጋገጡ ፕሮጀክቶች ተገኝተዋል', enquireProject: 'ስለ {name} ይጠይቁ'
    },
    ar: {
      heroEyebrow: 'مشروعات جديدة في أوغندا', heroTitle: 'اعثر على منزلك المستقبلي قبل اكتمال بنائه', heroSubtitle: 'استكشف مشروعات البيع على المخطط التي تم التحقق منها، وقارن أنواع الوحدات، وتابع تقدم البناء والمبيعات، وخطط للدفعات بالشلن الأوغندي.', projectSearch: 'المشروع أو المنطقة أو المطور', location: 'الموقع', allLocations: 'كل المواقع', bedrooms: 'غرف النوم', anyBedrooms: 'أي عدد من الغرف', oneBedroom: 'غرفة نوم واحدة', twoBedrooms: 'غرفتا نوم', threeBedrooms: '3 غرف نوم', fourBedrooms: '4+ غرف نوم', maximumPrice: 'السعر الأقصى', anyPrice: 'أي سعر', search: 'بحث', sectionEyebrow: 'مشروعات أوغندا على المخطط', newProjects: 'مشروعات جديدة', loadingProjects: 'جارٍ تحميل المشروعات التي تم التحقق منها...', listProject: 'أدرج مشروعاً على المخطط', reviewTitle: 'مراجعة قبل النشر', reviewBody: 'لا تظهر المشروعات هنا إلا بعد أن يتحقق فريق makaug من المطور والموقع والأسعار والتقدم ودليل التوفر.', paymentsTitle: 'خطط للدفعات', paymentsBody: 'اختر وحدة وأنشئ جدولاً توضيحياً مؤرخاً للأقساط بالشلن الأوغندي، ثم قارن خيارات الرهن العقاري.', backToProjects: 'العودة إلى مشروعات البيع على المخطط', partner: 'تعاون مع makaug', contactQuestion: 'كيف تفضل أن يتواصل معك الفريق؟', close: 'إغلاق', continueChat: 'المتابعة في المحادثة', email: 'البريد الإلكتروني', replyEmail: 'الرد بالبريد الإلكتروني', callMe: 'اتصلوا بي', chooseTime: 'اختر وقتاً', yourName: 'اسمك', fullName: 'الاسم الكامل', phone: 'WhatsApp / الهاتف', preferredCallTime: 'وقت الاتصال المفضل', contactNote: 'سنطلب اسم المشروع وموقعه وتاريخ اكتماله والكتيب والصور وتقدم البناء والمبيعات الحالية. يبقى كل مشروع قيد مراجعة الموظفين حتى يتم التحقق منه.', submitWhatsApp: 'المتابعة عبر WhatsApp', submitEmail: 'اطلب من الفريق مراسلتي', submitCall: 'اطلب مكالمة', noProjectsTitle: 'لا توجد مشروعات موثقة تطابق هذا البحث بعد', noProjectsBody: 'لا تظهر المشروعات الجديدة في النتائج العامة حتى يتحقق فريق makaug من المعلومات. جرّب موقعاً آخر أو اطلب منا مراجعة مشروع.', noProjectsSummary: 'لم يتم العثور على مشروعات موثقة', projectsFound: 'تم العثور على {count} مشروع موثق', enquireProject: 'استفسر عن {name}'
    }
  };

  const OFF_PLAN_COMPACT_I18N = {
    en: { heroTitle: 'New off-plan projects', heroSubtitle: 'Explore developments, compare homes and plan your payments.', projectSearch: 'Location, project or developer', propertyType: 'Property type', paymentPlan: 'Payment plan', filters: 'Filters', map: 'Map', projects: 'Projects', askAi: 'Ask AI', aiTitle: 'Ask AI about off-plan', aiSubtitle: 'Describe the project, location or payment plan you need.', mapNote: 'Area markers are shown until an exact project pin is confirmed.', loadingProjects: 'Loading projects...', projectsFound: '{count} project(s) found', noProjectsSummary: 'No projects found' },
    lg: { heroTitle: 'Pulojekiti za off-plan empya', heroSubtitle: 'Kebera pulojekiti, gerageranya amaka era oteekateeke okusasula.', projectSearch: 'Ekifo, pulojekiti oba omuzimbi', propertyType: 'Ekika ky’ennyumba', paymentPlan: 'Enteekateeka y’okusasula', filters: 'Sengeka', map: 'Maapu', projects: 'Pulojekiti', askAi: 'Buuza AI', aiTitle: 'Buuza AI ku off-plan', aiSubtitle: 'Nyonyola pulojekiti, ekifo oba enteekateeka y’okusasula gy’onooya.', mapNote: 'Maapu eraga ekitundu okutuusa ekifo kya pulojekiti kikakasiddwa.', loadingProjects: 'Pulojekiti zitikkibwa...', projectsFound: 'Pulojekiti {count} ezuuliddwa', noProjectsSummary: 'Tewali pulojekiti ezuuliddwa' },
    sw: { heroTitle: 'Miradi mipya ya off-plan', heroSubtitle: 'Chunguza miradi, linganisha nyumba na upange malipo.', projectSearch: 'Eneo, mradi au msanidi', propertyType: 'Aina ya nyumba', paymentPlan: 'Mpango wa malipo', filters: 'Vichujio', map: 'Ramani', projects: 'Miradi', askAi: 'Uliza AI', aiTitle: 'Uliza AI kuhusu off-plan', aiSubtitle: 'Eleza mradi, eneo au mpango wa malipo unaohitaji.', mapNote: 'Alama zinaonyesha eneo hadi mahali halisi pa mradi lithibitishwe.', loadingProjects: 'Inapakia miradi...', projectsFound: 'Miradi {count} imepatikana', noProjectsSummary: 'Hakuna miradi iliyopatikana' },
    ac: { heroTitle: 'Purujekti manyen me off-plan', heroSubtitle: 'Nen purujekti, por odi ki yub cul.', projectSearch: 'Kabedo, purujekti onyo lagwedo', propertyType: 'Kit ot', paymentPlan: 'Yub me cul', filters: 'Yek', map: 'Map', projects: 'Purujekti', askAi: 'Peny AI', aiTitle: 'Peny AI pi off-plan', aiSubtitle: 'Tit purujekti, kabedo onyo yub cul ma imito.', mapNote: 'Map nyutu kabedo naka kimoko kabedo kikome me purujekti.', loadingProjects: 'Tye ka cano purujekti...', projectsFound: 'Purujekti {count} ononge', noProjectsSummary: 'Purujekti pe ononge' },
    ny: { heroTitle: 'Pulojekiti ensya za off-plan', heroSubtitle: 'Reeba pulojekiti, geragyeranisa amaka kandi oteekateeke okusasura.', projectSearch: 'Omwanya, pulojekiti nari omwombeki', propertyType: 'Ekika ky’eka', paymentPlan: 'Enteekateeka y’okusasura', filters: 'Shwijuma', map: 'Maapu', projects: 'Pulojekiti', askAi: 'Buuza AI', aiTitle: 'Buuza AI aha off-plan', aiSubtitle: 'Shoboorora pulojekiti, omwanya nari enteekateeka y’okusasura.', mapNote: 'Maapu neeyoreka omwanya okuhitsya ahari pulojekiti hahamiibwe.', loadingProjects: 'Pulojekiti nizitwarwa...', projectsFound: 'Pulojekiti {count} ziboine', noProjectsSummary: 'Tihariho pulojekiti eboine' },
    rn: { heroTitle: 'Pulojekiti nsya za off-plan', heroSubtitle: 'Reeba pulojekiti, geragyeranisa amaka kandi oteekateeke okusasura.', projectSearch: 'Ekicweka, pulojekiti nari omwombeki', propertyType: 'Ekika ky’eka', paymentPlan: 'Enteekateeka y’okusasura', filters: 'Shwijuma', map: 'Maapu', projects: 'Pulojekiti', askAi: 'Buuza AI', aiTitle: 'Buuza AI aha off-plan', aiSubtitle: 'Shoboorora pulojekiti, ekicweka nari enteekateeka y’okusasura.', mapNote: 'Maapu neeyoreka ekicweka okuhitsya ahari pulojekiti hahamiibwe.', loadingProjects: 'Pulojekiti nizitwarwa...', projectsFound: 'Pulojekiti {count} ziboine', noProjectsSummary: 'Tihariho pulojekiti eboine' },
    sm: { heroTitle: 'Pulojekiti empyaka dha off-plan', heroSubtitle: 'Kebera pulojekiti, gerageranya amaka era otegeke okusasula.', projectSearch: 'Ekifo, pulojekiti oba omuzimbi', propertyType: 'Ekika ky’enhumba', paymentPlan: 'Enteekateeka y’okusasula', filters: 'Sengeka', map: 'Maapu', projects: 'Pulojekiti', askAi: 'Buuza AI', aiTitle: 'Buuza AI ku off-plan', aiSubtitle: 'Nyonyola pulojekiti, ekifo oba enteekateeka y’okusasula gy’onoina.', mapNote: 'Maapu eraga ekitundu okutuusa ekifo kya pulojekiti kikakasiddwa.', loadingProjects: 'Pulojekiti dhitikkibwa...', projectsFound: 'Pulojekiti {count} dhizuuliddwa', noProjectsSummary: 'Ezira pulojekiti ezuuliddwa' },
    am: { heroTitle: 'አዳዲስ የ off-plan ፕሮጀክቶች', heroSubtitle: 'ፕሮጀክቶችን ይመልከቱ፣ ቤቶችን ያወዳድሩ እና ክፍያዎን ያቅዱ።', projectSearch: 'አካባቢ፣ ፕሮጀክት ወይም አልሚ', propertyType: 'የንብረት ዓይነት', paymentPlan: 'የክፍያ ዕቅድ', filters: 'ማጣሪያዎች', map: 'ካርታ', projects: 'ፕሮጀክቶች', askAi: 'AIን ይጠይቁ', aiTitle: 'ስለ off-plan AIን ይጠይቁ', aiSubtitle: 'የሚፈልጉትን ፕሮጀክት፣ አካባቢ ወይም የክፍያ ዕቅድ ይግለጹ።', mapNote: 'ትክክለኛው የፕሮጀክት ቦታ እስኪረጋገጥ ድረስ የአካባቢ ምልክቶች ይታያሉ።', loadingProjects: 'ፕሮጀክቶችን በመጫን ላይ...', projectsFound: '{count} ፕሮጀክቶች ተገኝተዋል', noProjectsSummary: 'ምንም ፕሮጀክት አልተገኘም' },
    ar: { heroTitle: 'مشروعات جديدة على المخطط', heroSubtitle: 'استكشف المشروعات وقارن المنازل وخطط لدفعاتك.', projectSearch: 'الموقع أو المشروع أو المطور', propertyType: 'نوع العقار', paymentPlan: 'خطة الدفع', filters: 'التصفية', map: 'الخريطة', projects: 'المشروعات', askAi: 'اسأل الذكاء الاصطناعي', aiTitle: 'اسأل عن مشروعات البيع على المخطط', aiSubtitle: 'صف المشروع أو الموقع أو خطة الدفع التي تحتاجها.', mapNote: 'تظهر علامات المنطقة إلى أن يتم تأكيد الموقع الدقيق للمشروع.', loadingProjects: 'جارٍ تحميل المشروعات...', projectsFound: 'تم العثور على {count} مشروع', noProjectsSummary: 'لم يتم العثور على مشروعات' }
  };

  const OFF_PLAN_DETAIL_I18N = {
    en: {
      verifiedProject: 'Verified project', sourceDetails: 'Source details supplied', delivery: 'Delivery', toConfirm: 'To be confirmed', homes: 'Homes', launchPrice: 'Launch price', monthPlan: '{count}-month payment plan', viewBroker: 'View broker', projectTeam: 'Project team', development: 'Development', projectImage: 'Project image', viewPhotos: 'View all {count} photos', projectGallery: 'Project gallery', expectedCompletion: 'Expected completion', construction: 'Construction', percentComplete: '{count}% complete', homesSold: 'Homes sold', homesRemaining: 'Homes remaining', aboutDevelopment: 'About the development', projectContact: 'Project contact', linkedProfile: 'Linked makaug broker profile', viewProfile: 'View profile', chooseHome: 'Choose a home', unitTypesPrices: 'Unit types and prices', guidePrices: 'UGX guide · source prices in USD', homeType: 'Home type', size: 'Size', guidePrice: 'Guide price', calculate: 'Calculate', unitVerifying: 'Unit details are being verified.', priceRequest: 'Price on request', projectProgress: 'Project progress', constructionCompleted: 'Construction completed', paymentPlan: 'Payment plan', milestonesVerifying: 'The payment milestones are being verified.', step: 'Step {count}', paymentMilestone: 'Payment milestone', monthlyInstalments: '{count} monthly instalments', termsVerify: 'Terms to verify', buildYourOwn: 'Build your own', buildSchedule: 'Build your illustrative schedule', homePrice: 'Home price', currency: 'Currency', upfrontDeposit: 'Upfront deposit %', reservationFee: 'Reservation fee', paymentMonths: 'Payment months', calculateDates: 'Calculate payment dates', mortgageOptions: 'Mortgage options without leaving this page', mortgageIntro: 'Compare current public lender information. Eligibility, rates and approval remain lender decisions.', showMortgage: 'Show mortgage providers', hideMortgage: 'Hide mortgage providers', rate: 'Indicative rate', quoteRequired: 'Current quote required', minDeposit: 'Minimum deposit', term: 'Maximum term', years: '{count} years', officialDetails: 'Official details', locationArea: 'Location and area', widerArea: 'The map shows the wider area; the exact development pin is being confirmed.', confirmTravel: 'Confirm travel times and the exact site before making a commitment.', nearbyEssentials: 'Nearby essentials', nearbyLive: 'Live Google Maps results around the area point. Confirm distances from the exact development site.', projectVideo: 'Project video', disclaimerTitle: 'Off-plan information can change.', disclaimerBody: 'Fraud, false documents and misleading project information are not accepted. Verify approvals, title, developer identity, the sale agreement, payment destination, specifications, dates and current availability. Artist impressions may differ from the finished project. Obtain independent legal and financial advice.', pricesFrom: 'Prices from', confirmPrice: 'Confirm the current price and availability before payment.', enquireThis: 'Enquire with {name}', downloadBrochure: 'Download brochure', shareProject: 'Share this project', upfront: 'Upfront', monthlyFrom: 'Monthly from', finalDate: 'Final payment date', viewPayments: 'View all {count} payment dates', calcDisclaimer: 'Illustration only. Confirm the signed payment plan, fees, taxes and exchange-rate effects with the developer and your adviser.', calculating: 'Calculating...', mapUnavailable: 'Google Maps is temporarily unavailable.', openMaps: 'Open in Google Maps', areaOverviewFallback: 'Confirm schools, healthcare, transport links and travel times after the exact site pin is verified.', previewDescription: 'Townhouse project in Entebbe with 2, 3 and 4 bedroom homes. Kazi Honest supplied project images, investor-offer prices, a 15-month payment period and a USD 1,500 reservation figure. The developer, completion date, exact site pin, construction progress and current availability are still being confirmed.', requiredInfoTitle: 'Have this project information ready', requiredInfo: 'Project name|Developer or owner|Exact location and map pin|Expected completion date|Brochure and approvals|Project and construction images|Unit types and current prices|Payment plan and reservation fee|Construction progress|Homes sold and remaining', fraudWarning: 'Fraud and false information are not accepted. makaug verifies submissions and keeps every new project in staff review until the evidence is checked.', projectDetails: 'Project details you already have (optional)', projectDetailsPlaceholder: 'Project name, developer, location, completion date, prices, payment plan and links to supporting material', contactKaziNote: 'Your enquiry is recorded by makaug and WhatsApp opens directly with {name}, the listed project contact.'
    },
    lg: {
      verifiedProject: 'Pulojekiti ekakasiddwa', sourceDetails: 'Ebiva ku nsibuko biweereddwa', delivery: 'Okuggwa', toConfirm: 'Kyakukakasibwa', homes: 'Amaka', launchPrice: 'Omuwendo ogusooka', monthPlan: 'Enteekateeka ya myezi {count}', viewBroker: 'Laba broker', projectTeam: 'Ttiimu ya pulojekiti', development: 'Enkulaakulana', projectImage: 'Ekifaananyi kya pulojekiti', viewPhotos: 'Laba ebifaananyi {count}', projectGallery: 'Ebifaananyi bya pulojekiti', expectedCompletion: 'Okuggwa okusuubirwa', construction: 'Okuzimba', percentComplete: '{count}% ewedde', homesSold: 'Amaka agatundiddwa', homesRemaining: 'Amaka agasigadde', aboutDevelopment: 'Ebikwata ku nkulaakulana', projectContact: 'Omuntu wa pulojekiti', linkedProfile: 'Profile ya broker ku makaug', viewProfile: 'Laba profile', chooseHome: 'Londa amaka', unitTypesPrices: 'Ebika by’amaka n’emiwendo', guidePrices: 'Emiwendo gya UGX · ensibuko mu USD', homeType: 'Ekika ky’amaka', size: 'Obunene', guidePrice: 'Omuwendo ogulaga', calculate: 'Bala', unitVerifying: 'Ebikwata ku nnyumba bikyakeberwa.', priceRequest: 'Buuza omuwendo', projectProgress: 'Enkulaakulana ya pulojekiti', constructionCompleted: 'Okuzimba okuwedde', paymentPlan: 'Enteekateeka y’okusasula', milestonesVerifying: 'Emitendera gy’okusasula gikyaweebwa obukakafu.', step: 'Omutendera {count}', paymentMilestone: 'Omutendera gw’okusasula', monthlyInstalments: 'Emisolo gya mwezi {count}', termsVerify: 'Amateeka gakukeberwa', buildYourOwn: 'Kola eyiyo', buildSchedule: 'Kola enteekateeka yo ey’okugeza', homePrice: 'Omuwendo gw’amaka', currency: 'Ssente', upfrontDeposit: 'Deposit esooka %', reservationFee: 'Ssente z’okukwata', paymentMonths: 'Emyezi gy’okusasula', calculateDates: 'Bala ennaku z’okusasula', mortgageOptions: 'Laba mortgage nga tofulumye ku lupapula', mortgageIntro: 'Gerageranya ebiva ku ba lender. Okukkiriza n’emiwendo bisalibwawo lender.', showMortgage: 'Laga abawa mortgage', hideMortgage: 'Kweka abawa mortgage', rate: 'Rate elagiddwa', quoteRequired: 'Buuza omuwendo gwa kati', minDeposit: 'Deposit entono', term: 'Ekiseera ekisinga', years: 'Emyaka {count}', officialDetails: 'Ebikwata ku nsibuko', locationArea: 'Ekifo n’ekitundu', widerArea: 'Maapu eraga ekitundu; pin entuufu ekyakeberwa.', confirmTravel: 'Kakasa obudde bw’olugendo n’ekifo entuufu nga tonnasalawo.', nearbyEssentials: 'Ebyetaagisa ebiri okumpi', nearbyLive: 'Ebiva ku Google Maps ebya kati okwetooloola ekitundu. Kakasa amabanga okuva ku kifo entuufu.', projectVideo: 'Vidiyo ya pulojekiti', disclaimerTitle: 'Ebikwata ku off-plan biyinza okukyuka.', disclaimerBody: 'Obufere, ebiwandiiko eby’obulimba n’amawulire agabuzaabuza tebikkirizibwa. Kakasa olukusa, title, omuzimbi, endagaano, gy’osasula, specs, ennaku n’amaka agaliwo. Funa amagezi ga looya n’ebyensimbi.', pricesFrom: 'Emiwendo gitandikira ku', confirmPrice: 'Kakasa omuwendo n’amaka agaliwo nga tonnasasula.', enquireThis: 'Buuza {name}', downloadBrochure: 'Wanula brochure', shareProject: 'Gabana pulojekiti', upfront: 'Esooka', monthlyFrom: 'Buli mwezi okuva ku', finalDate: 'Olunaku olusembayo', viewPayments: 'Laba ennaku zonna {count}', calcDisclaimer: 'Kya kulaga kyokka. Kakasa endagaano, fees, omusolo n’enkyukakyuka ya ssente n’omuzimbi n’omuwabuzi.', calculating: 'Kibalibwa...', mapUnavailable: 'Google Maps teriwo kati.', openMaps: 'Ggulawo Google Maps', areaOverviewFallback: 'Kakasa amasomero, amalwaliro n’entambula oluvannyuma lwa pin entuufu okukakasibwa.', previewDescription: 'Pulojekiti ya townhouses mu Entebbe erimu amaka ag’ebisenge 2, 3 ne 4. Kazi Honest yawa ebifaananyi, emiwendo gya investor, enteekateeka ya myezi 15 ne USD 1,500 ez’okukwata. Omuzimbi, olunaku lw’okuggwa, pin entuufu, okuzimba n’amaka agaliwo bikyakeberwa.', requiredInfoTitle: 'Teekateeka ebikwata ku pulojekiti bino', requiredInfo: 'Erinnya lya pulojekiti|Omuzimbi oba nnannyini|Ekifo entuufu ne pin|Olunaku lw’okuggwa|Brochure n’obukakafu|Ebifaananyi bya pulojekiti n’okuzimba|Ebika by’amaka n’emiwendo|Enteekateeka y’okusasula ne reservation|Okuzimba kwe kutuuse|Amaka agatundiddwa n’agasigadde', fraudWarning: 'Obufere n’amawulire ag’obulimba tebikkirizibwa. makaug ekebera buli kusaba era pulojekiti empya esigala mu review okutuusa obukakafu nga bukebereddwa.', projectDetails: 'Ebikwata ku pulojekiti by’olina (si kya tteeka)', projectDetailsPlaceholder: 'Erinnya, omuzimbi, ekifo, olunaku, emiwendo, ensasula ne links z’obukakafu', contactKaziNote: 'Okubuuza kwo kuterekebwa ku makaug era WhatsApp egguka butereevu eri {name}, omuntu wa pulojekiti.'
    },
    sw: {
      verifiedProject: 'Mradi uliothibitishwa', sourceDetails: 'Taarifa za chanzo zimetolewa', delivery: 'Kukamilika', toConfirm: 'Inathibitishwa', homes: 'Nyumba', launchPrice: 'Bei ya kuanzia', monthPlan: 'Mpango wa miezi {count}', viewBroker: 'Tazama wakala', projectTeam: 'Timu ya mradi', development: 'Mradi', projectImage: 'Picha ya mradi', viewPhotos: 'Tazama picha zote {count}', projectGallery: 'Picha za mradi', expectedCompletion: 'Tarehe ya kukamilika', construction: 'Ujenzi', percentComplete: '{count}% imekamilika', homesSold: 'Nyumba zilizouzwa', homesRemaining: 'Nyumba zilizobaki', aboutDevelopment: 'Kuhusu mradi', projectContact: 'Mawasiliano ya mradi', linkedProfile: 'Wasifu wa wakala wa makaug', viewProfile: 'Tazama wasifu', chooseHome: 'Chagua nyumba', unitTypesPrices: 'Aina za nyumba na bei', guidePrices: 'Mwongozo wa UGX · bei za chanzo ni USD', homeType: 'Aina ya nyumba', size: 'Ukubwa', guidePrice: 'Bei ya mwongozo', calculate: 'Kokotoa', unitVerifying: 'Taarifa za nyumba zinathibitishwa.', priceRequest: 'Omba bei', projectProgress: 'Maendeleo ya mradi', constructionCompleted: 'Ujenzi uliokamilika', paymentPlan: 'Mpango wa malipo', milestonesVerifying: 'Hatua za malipo zinathibitishwa.', step: 'Hatua {count}', paymentMilestone: 'Hatua ya malipo', monthlyInstalments: 'Malipo {count} ya kila mwezi', termsVerify: 'Masharti yanathibitishwa', buildYourOwn: 'Tengeneza wako', buildSchedule: 'Tengeneza ratiba yako ya mfano', homePrice: 'Bei ya nyumba', currency: 'Sarafu', upfrontDeposit: 'Amana ya awali %', reservationFee: 'Ada ya kuhifadhi', paymentMonths: 'Miezi ya malipo', calculateDates: 'Kokotoa tarehe za malipo', mortgageOptions: 'Linganisha mikopo bila kuondoka hapa', mortgageIntro: 'Linganisha taarifa za umma za wakopeshaji. Ustahiki, riba na idhini huamuliwa na mkopeshaji.', showMortgage: 'Onyesha wakopeshaji', hideMortgage: 'Ficha wakopeshaji', rate: 'Riba elekezi', quoteRequired: 'Omba bei ya sasa', minDeposit: 'Amana ya chini', term: 'Muda wa juu', years: 'Miaka {count}', officialDetails: 'Taarifa rasmi', locationArea: 'Eneo na mazingira', widerArea: 'Ramani inaonyesha eneo pana; mahali halisi pa mradi bado panathibitishwa.', confirmTravel: 'Thibitisha muda wa safari na eneo halisi kabla ya kuamua.', nearbyEssentials: 'Huduma za karibu', nearbyLive: 'Matokeo ya sasa ya Google Maps karibu na eneo. Thibitisha umbali kutoka mahali halisi pa mradi.', projectVideo: 'Video ya mradi', disclaimerTitle: 'Taarifa za off-plan zinaweza kubadilika.', disclaimerBody: 'Udanganyifu, nyaraka bandia na taarifa za kupotosha hazikubaliki. Thibitisha vibali, hati, msanidi, mkataba, malipo, vipimo, tarehe na upatikanaji. Pata ushauri huru wa sheria na fedha.', pricesFrom: 'Bei kuanzia', confirmPrice: 'Thibitisha bei na upatikanaji kabla ya kulipa.', enquireThis: 'Wasiliana na {name}', downloadBrochure: 'Pakua brosha', shareProject: 'Shiriki mradi', upfront: 'Malipo ya awali', monthlyFrom: 'Kwa mwezi kuanzia', finalDate: 'Tarehe ya mwisho', viewPayments: 'Tazama tarehe zote {count}', calcDisclaimer: 'Mfano tu. Thibitisha mpango uliosainiwa, ada, kodi na athari za sarafu na msanidi pamoja na mshauri wako.', calculating: 'Inakokotoa...', mapUnavailable: 'Google Maps haipatikani kwa sasa.', openMaps: 'Fungua Google Maps', areaOverviewFallback: 'Thibitisha shule, hospitali, usafiri na muda wa safari baada ya pini halisi kuthibitishwa.', previewDescription: 'Mradi wa nyumba za mjini Entebbe wenye nyumba za vyumba 2, 3 na 4. Kazi Honest alitoa picha, bei za wawekezaji, kipindi cha malipo cha miezi 15 na ada ya kuhifadhi ya USD 1,500. Msanidi, tarehe ya kukamilika, pini halisi, maendeleo ya ujenzi na upatikanaji bado vinathibitishwa.', requiredInfoTitle: 'Andaa taarifa hizi za mradi', requiredInfo: 'Jina la mradi|Msanidi au mmiliki|Eneo halisi na pini|Tarehe ya kukamilika|Brosha na vibali|Picha za mradi na ujenzi|Aina za nyumba na bei|Mpango wa malipo na ada ya kuhifadhi|Maendeleo ya ujenzi|Nyumba zilizouzwa na zilizobaki', fraudWarning: 'Udanganyifu na taarifa za uongo hazikubaliki. makaug hukagua kila uwasilishaji na mradi mpya hubaki kwenye ukaguzi hadi ushahidi uthibitishwe.', projectDetails: 'Taarifa ulizonazo tayari (si lazima)', projectDetailsPlaceholder: 'Jina, msanidi, eneo, tarehe, bei, mpango wa malipo na viungo vya ushahidi', contactKaziNote: 'Swali lako linarekodiwa na makaug na WhatsApp itafunguka moja kwa moja kwa {name}, mawasiliano ya mradi.'
    },
    ac: {}, ny: {}, rn: {}, sm: {}, am: {}, ar: {}
  };

  Object.assign(OFF_PLAN_DETAIL_I18N.ac, OFF_PLAN_DETAIL_I18N.en, { aboutDevelopment: 'Lok i kom purujekti', projectContact: 'Dano me purujekti', viewProfile: 'Nen profile', chooseHome: 'Yer ot', unitTypesPrices: 'Kit odi ki wel', projectProgress: 'Kit purujekti odonyo kwede', paymentPlan: 'Yub me cul', buildYourOwn: 'Yub meri', calculateDates: 'Kwan nino me cul', locationArea: 'Kabedo ki alokaloka', nearbyEssentials: 'Jami ma tye cok', pricesFrom: 'Wel cake ki', shareProject: 'Nywak purujekti', toConfirm: 'Pud kimoko', previewDescription: 'Purujekti me townhouses i Entebbe ki otino nino 2, 3 ki 4. Kazi Honest omiyo cal, wel pa investor, kare me cul dwe 15 ki USD 1,500 me mako ot. Lagwedo, nino me tyeko, pin kikome, kit gedo ki odi ma tye pud kimoko.', fraudWarning: 'Tim bwola ki ngec goba pe kiye. makaug neno cwal acel acel dok purujekti bedo i review naka kimoko caden.' });
  Object.assign(OFF_PLAN_DETAIL_I18N.ny, OFF_PLAN_DETAIL_I18N.en, { aboutDevelopment: 'Aha pulojekiti', projectContact: 'Omuntu wa pulojekiti', viewProfile: 'Reeba profile', chooseHome: 'Toorana eka', unitTypesPrices: 'Ebika by’amaka n’emihendo', projectProgress: 'Entunguuka ya pulojekiti', paymentPlan: 'Enteekateeka y’okusasula', buildYourOwn: 'Kora eyaawe', calculateDates: 'Bara ebiro by’okusasula', locationArea: 'Omwanya n’ekicweka', nearbyEssentials: 'Ebirikukyetengyesa haihi', pricesFrom: 'Emihendo etandikira', shareProject: 'Gabana pulojekiti', toConfirm: 'Nikihamibwa', previewDescription: 'Pulojekiti ya townhouses omuri Entebbe erimu amaka g’ebishenge 2, 3 na 4. Kazi Honest akahayo ebishushani, emihendo ya investor, emyezi 15 y’okusasula na USD 1,500 y’okukwata. Omwombeki, ebiro by’okuhendera, pin, okuzimba n’amaka agariho nibihamibwa.', fraudWarning: 'Oburyarya n’amakuru g’ebishuba tibyikirizibwa. makaug neeshwijuma buri kusaba kandi pulojekiti neeguma omu review okuhitsya obuhame bwaahamibwa.' });
  Object.assign(OFF_PLAN_DETAIL_I18N.rn, OFF_PLAN_DETAIL_I18N.ny, { locationArea: 'Ekicweka n’omwanya', chooseHome: 'Toorana eka yawe' });
  Object.assign(OFF_PLAN_DETAIL_I18N.sm, OFF_PLAN_DETAIL_I18N.lg, { aboutDevelopment: 'Ebikwata ku pulojekiti', chooseHome: 'Londa ennyumba', previewDescription: 'Pulojekiti ya townhouses mu Entebbe erimu amaka ag’ebisenge 2, 3 ne 4. Kazi Honest yawa ebifaananyi, emiwendo gya investor, emyezi 15 egy’okusasula ne USD 1,500 ez’okukwata. Omuzimbi, olunaku, pin, okuzimba n’amaka agaliwo bikyakeberwa.' });
  Object.assign(OFF_PLAN_DETAIL_I18N.am, OFF_PLAN_DETAIL_I18N.en, { verifiedProject: 'የተረጋገጠ ፕሮጀክት', sourceDetails: 'የምንጭ መረጃ ቀርቧል', toConfirm: 'በማረጋገጥ ላይ', aboutDevelopment: 'ስለ ፕሮጀክቱ', projectContact: 'የፕሮጀክት አድራሻ', viewProfile: 'መገለጫ ይመልከቱ', chooseHome: 'ቤት ይምረጡ', unitTypesPrices: 'የቤት ዓይነቶችና ዋጋዎች', projectProgress: 'የፕሮጀክት ሂደት', paymentPlan: 'የክፍያ ዕቅድ', buildYourOwn: 'የራስዎን ይስሩ', calculateDates: 'የክፍያ ቀናትን አስሉ', mortgageOptions: 'ከገጹ ሳይወጡ የብድር አማራጮች', locationArea: 'አካባቢ እና ካርታ', nearbyEssentials: 'በአቅራቢያ ያሉ አገልግሎቶች', pricesFrom: 'ዋጋ ከ', shareProject: 'ፕሮጀክቱን ያጋሩ', previewDescription: 'በኢንቴቤ ያለ 2፣ 3 እና 4 መኝታ ቤቶች ያሉት የታውንሃውስ ፕሮጀክት። Kazi Honest ምስሎችን፣ የባለሀብት ዋጋዎችን፣ የ15 ወር ክፍያ እና USD 1,500 የቦታ ማስያዣ አቀረበች። አልሚው፣ የመጨረሻ ቀን፣ ትክክለኛው ቦታ፣ ግንባታውና ተገኝነቱ ገና በማረጋገጥ ላይ ናቸው።', fraudWarning: 'ማጭበርበር እና ሐሰተኛ መረጃ አይፈቀድም። makaug ማስረጃው እስኪረጋገጥ ድረስ እያንዳንዱን ፕሮጀክት በሰራተኞች ግምገማ ውስጥ ያቆያል።' });
  Object.assign(OFF_PLAN_DETAIL_I18N.ar, OFF_PLAN_DETAIL_I18N.en, { verifiedProject: 'مشروع موثق', sourceDetails: 'تم توفير معلومات المصدر', delivery: 'موعد التسليم', toConfirm: 'قيد التأكيد', homes: 'المنازل', launchPrice: 'سعر الإطلاق', viewBroker: 'عرض الوسيط', projectTeam: 'فريق المشروع', projectImage: 'صورة المشروع', viewPhotos: 'عرض كل الصور ({count})', projectGallery: 'معرض المشروع', expectedCompletion: 'الاكتمال المتوقع', construction: 'البناء', homesSold: 'المنازل المباعة', homesRemaining: 'المنازل المتبقية', aboutDevelopment: 'نبذة عن المشروع', projectContact: 'جهة اتصال المشروع', linkedProfile: 'ملف وسيط makaug', viewProfile: 'عرض الملف', chooseHome: 'اختر منزلاً', unitTypesPrices: 'أنواع الوحدات والأسعار', homeType: 'نوع المنزل', size: 'المساحة', guidePrice: 'السعر الإرشادي', calculate: 'احسب', projectProgress: 'تقدم المشروع', constructionCompleted: 'البناء المكتمل', paymentPlan: 'خطة الدفع', step: 'الخطوة {count}', buildYourOwn: 'أنشئ خطتك', buildSchedule: 'أنشئ جدولك التوضيحي', homePrice: 'سعر المنزل', currency: 'العملة', upfrontDeposit: 'الدفعة الأولى %', reservationFee: 'رسوم الحجز', paymentMonths: 'أشهر الدفع', calculateDates: 'احسب مواعيد الدفع', mortgageOptions: 'قارن الرهون دون مغادرة الصفحة', showMortgage: 'عرض مزودي الرهن', hideMortgage: 'إخفاء مزودي الرهن', locationArea: 'الموقع والمنطقة', nearbyEssentials: 'الخدمات القريبة', projectVideo: 'فيديو المشروع', disclaimerTitle: 'قد تتغير معلومات البيع على المخطط.', disclaimerBody: 'لا يُقبل الاحتيال أو المستندات المزيفة أو المعلومات المضللة. تحقق من الموافقات والملكية وهوية المطور والعقد وجهة الدفع والمواصفات والتواريخ والتوفر، واستعن بمشورة قانونية ومالية مستقلة.', pricesFrom: 'الأسعار من', confirmPrice: 'أكد السعر والتوفر قبل الدفع.', enquireThis: 'استفسر من {name}', downloadBrochure: 'تنزيل الكتيب', shareProject: 'مشاركة المشروع', upfront: 'المقدم', monthlyFrom: 'شهرياً من', finalDate: 'تاريخ الدفعة الأخيرة', viewPayments: 'عرض كل مواعيد الدفع ({count})', calculating: 'جارٍ الحساب...', mapUnavailable: 'خرائط Google غير متاحة مؤقتاً.', openMaps: 'فتح في خرائط Google', previewDescription: 'مشروع منازل تاون هاوس في إنتيبي بوحدات من غرفتين وثلاث وأربع غرف. قدمت Kazi Honest صور المشروع وأسعار المستثمرين وخطة سداد لمدة 15 شهراً ورسم حجز قدره 1,500 دولار. وما زالت هوية المطور وموعد الإنجاز والموقع الدقيق وتقدم البناء والتوفر قيد التأكيد.', requiredInfoTitle: 'جهز معلومات المشروع هذه', requiredInfo: 'اسم المشروع|المطور أو المالك|الموقع الدقيق والدبوس|تاريخ الإنجاز|الكتيب والموافقات|صور المشروع والبناء|أنواع الوحدات والأسعار|خطة الدفع ورسوم الحجز|تقدم البناء|الوحدات المباعة والمتبقية', fraudWarning: 'لا يُقبل الاحتيال أو المعلومات الكاذبة. يتحقق makaug من كل طلب ويبقي المشروع قيد مراجعة الموظفين حتى فحص الأدلة.' });

  Object.assign(OFF_PLAN_DETAIL_I18N.ac, {
    verifiedProject: 'Purujekti ma kimoko', sourceDetails: 'Lok ma oa ki ka ocake omiyo', delivery: 'Tyeko', homes: 'Odi', launchPrice: 'Wel me acaki', viewBroker: 'Nen broker', projectTeam: 'Dul pa purujekti', projectImage: 'Cal pa purujekti', viewPhotos: 'Nen cal ducu {count}', projectGallery: 'Cal pa purujekti', expectedCompletion: 'Nino ma kigamo me tyeko', construction: 'Gedo', percentComplete: '{count}% otyeko', homesSold: 'Odi ma kicato', homesRemaining: 'Odi ma odong', linkedProfile: 'Profile pa broker i makaug', viewProfile: 'Nen profile', homeType: 'Kit ot', size: 'Dit pa ot', guidePrice: 'Wel me lakony', calculate: 'Kwan', unitVerifying: 'Tye ka moko lok pa ot.', constructionCompleted: 'Gedo ma otyeko', milestonesVerifying: 'Tye ka moko kit cul.', step: 'Yoo {count}', paymentMilestone: 'Kare me cul', monthlyInstalments: 'Cul me dwe {count}', termsVerify: 'Tye ka moko cik', buildSchedule: 'Yub kit cul meri me lapor', homePrice: 'Wel pa ot', currency: 'Kit cente', upfrontDeposit: 'Deposit me acaki %', reservationFee: 'Cente me mako ot', paymentMonths: 'Dwe me cul', mortgageOptions: 'Por mortgage mapwod itye i pot buk man', mortgageIntro: 'Por ngec ma lender omiyo bot lwak. Lender aye moko rate ki ye.', rate: 'Rate me lapor', quoteRequired: 'Peny wel me kombedi', minDeposit: 'Deposit matidi', term: 'Kare mamalo', years: 'Mwaka {count}', officialDetails: 'Lok ma oa ki ka ocake', widerArea: 'Map nyutu kabedo madit; pin kikome pud tye ka kimoko.', confirmTravel: 'Mok cawa me wot ki kabedo kikome mapwod pe imoko.', nearbyLive: 'Lok ma oa ki Google Maps cok ki kabedo. Mok bor inge pin kikome.', disclaimerTitle: 'Lok pa off-plan twero loke.', disclaimerBody: 'Tim bwola, waraga goba ki ngec ma rwako dano pe kiye. Mok licence, title, lagwedo, contract, ka me cul, kit ot, nino ki odi ma tye. Nong tam pa lawyer ki jami me cente.', confirmPrice: 'Mok wel ki odi ma tye mapwod pe iculo.', upfront: 'Me acaki', monthlyFrom: 'Dwe acel cake ki', finalDate: 'Nino me cul me agiki', viewPayments: 'Nen nino me cul ducu {count}', calcDisclaimer: 'Man obedo lapor keken. Mok yub me cul, fees, tax ki rate pa cente ki lagwedo.', calculating: 'Tye ka kwano...', mapUnavailable: 'Google Maps pe tye kombedi.', openMaps: 'Yab i Google Maps', areaOverviewFallback: 'Mok gang kwan, ot yat, yoo me wot ki cawa inge pin kikome kimoko.', requiredInfoTitle: 'Yub ngec man me purujekti', requiredInfo: 'Nying purujekti|Lagwedo onyo rwot pa purujekti|Kabedo kikome ki pin|Nino me tyeko|Brochure ki licence|Cal pa purujekti ki gedo|Kit odi ki wel|Yub me cul ki cente me mako|Kit gedo odonyo kwede|Odi ma kicato ki ma odong', projectDetails: 'Lok pa purujekti ma itye kwede (pe pire tek)', projectDetailsPlaceholder: 'Nying, lagwedo, kabedo, nino me tyeko, wel, yub me cul ki links me caden'
  });
  Object.assign(OFF_PLAN_DETAIL_I18N.ny, {
    verifiedProject: 'Pulojekiti ehamiibwe', sourceDetails: 'Amakuru g’enshuro gahaire', delivery: 'Okuhendera', homes: 'Amaka', launchPrice: 'Omuhendo gw’okutandika', viewBroker: 'Reeba broker', projectTeam: 'Tiimu ya pulojekiti', projectImage: 'Ekishushani kya pulojekiti', viewPhotos: 'Reeba ebishushani {count}', projectGallery: 'Ebishushani bya pulojekiti', expectedCompletion: 'Okuhendera okurikuteekateekwa', construction: 'Okuzimba', percentComplete: '{count}% kyahendera', homesSold: 'Amaka agatundwa', homesRemaining: 'Amaka agatsigaire', linkedProfile: 'Profile ya broker aha makaug', homeType: 'Ekika ky’eka', size: 'Obuhango', guidePrice: 'Omuhendo gw’okuhabura', calculate: 'Bara', unitVerifying: 'Amakuru g’eka nigahamibwa.', constructionCompleted: 'Okuzimba okuhendera', milestonesVerifying: 'Emitendera y’okusasura nehamibwa.', step: 'Omutendera {count}', paymentMilestone: 'Omutendera gw’okusasura', monthlyInstalments: 'Okusasura buri kwezi emirundi {count}', termsVerify: 'Ebiragiro nibihamibwa', buildSchedule: 'Kora enteekateeka yawe y’okugyerezaho', homePrice: 'Omuhendo gw’eka', currency: 'Efaranga', upfrontDeposit: 'Deposit y’okubanza %', reservationFee: 'Efaranga g’okukwata', paymentMonths: 'Amezi g’okusasura', mortgageOptions: 'Geragyeranisa mortgage otarugire aha rupapura', mortgageIntro: 'Geragyeranisa amakuru ga lender agari ahabona. Lender niwe ahamya rate n’okwikiriza.', rate: 'Rate y’okuhabura', quoteRequired: 'Shaba omuhendo gwa hati', minDeposit: 'Deposit nkye', term: 'Obwire oburikukirayo', years: 'Emyaka {count}', officialDetails: 'Amakuru agahamiibwe', widerArea: 'Maapu neeyoreka ekicweka kihango; pin ehikire nekyahamibwa.', confirmTravel: 'Hamya obwire bw’orugyendo n’omwanya gwonyini otakashaziremu.', nearbyLive: 'Ebiri haihi ebirikuruga omu Google Maps. Hamya embaju kuruga aha pin ehikire.', disclaimerTitle: 'Amakuru ga off-plan nigaabaasa kuhinduka.', disclaimerBody: 'Obushuma, ebiwandiiko by’ebishuba n’amakuru agarikuhabisa tibyikirizibwa. Hamya approvals, title, omwombeki, contract, ahi orikusasura, ebiragiro, ebiro n’amaka agariho. Shaba obuhabuzi bw’amateeka n’ebyensimbi.', confirmPrice: 'Hamya omuhendo n’amaka agariho otakasasiire.', upfront: 'Okubanza', monthlyFrom: 'Buri kwezi kuruga', finalDate: 'Ekiro ky’okusasura aha muheru', viewPayments: 'Reeba ebiro byona {count}', calcDisclaimer: 'N’eky’okugyerezaho kyonka. Hamya payment plan, fees, taxes na exchange rate n’omwombeki.', calculating: 'Nikibarwa...', mapUnavailable: 'Google Maps terikubaho hati.', openMaps: 'Yiguraho omu Google Maps', areaOverviewFallback: 'Hamya amashomero, amarwariro, ebyentambura n’obwire bw’orugyendo pin ehikire yaaheza kuhamibwa.', requiredInfoTitle: 'Teekateeka amakuru ga pulojekiti aga', requiredInfo: 'Eiziina rya pulojekiti|Omwombeki nari nyinayo|Omwanya gwonyini na pin|Ekiro ky’okuhendera|Brochure na approvals|Ebishushani bya pulojekiti n’okuzimba|Ebika by’amaka n’emihendo|Payment plan n’efee y’okukwata|Okuhika kw’okuzimba|Amaka agatundwa n’agatsigaire', projectDetails: 'Amakuru ga pulojekiti agu oine (tikyetengyesa)', projectDetailsPlaceholder: 'Eiziina, omwombeki, omwanya, ebiro, emihendo, payment plan na links z’obuhame'
  });
  Object.assign(OFF_PLAN_DETAIL_I18N.rn, OFF_PLAN_DETAIL_I18N.ny, { locationArea: 'Ekicweka n’omwanya', chooseHome: 'Toorana eka yawe', projectSearch: 'Pulojekiti, ekicweka nari omwombeki' });
  Object.assign(OFF_PLAN_DETAIL_I18N.am, {
    delivery: 'ማስረከቢያ', homes: 'ቤቶች', launchPrice: 'የመነሻ ዋጋ', viewBroker: 'ደላላውን ይመልከቱ', projectTeam: 'የፕሮጀክት ቡድን', projectImage: 'የፕሮጀክት ምስል', viewPhotos: '{count} ምስሎችን ይመልከቱ', projectGallery: 'የፕሮጀክት ምስሎች', expectedCompletion: 'የሚጠበቀው ማጠናቀቂያ', construction: 'ግንባታ', percentComplete: '{count}% ተጠናቋል', homesSold: 'የተሸጡ ቤቶች', homesRemaining: 'የቀሩ ቤቶች', linkedProfile: 'የmakaug ደላላ መገለጫ', homeType: 'የቤት ዓይነት', size: 'መጠን', guidePrice: 'ግምታዊ ዋጋ', calculate: 'አስላ', unitVerifying: 'የቤቱ መረጃ በማረጋገጥ ላይ ነው።', constructionCompleted: 'የተጠናቀቀ ግንባታ', milestonesVerifying: 'የክፍያ ደረጃዎች በማረጋገጥ ላይ ናቸው።', step: 'ደረጃ {count}', paymentMilestone: 'የክፍያ ደረጃ', monthlyInstalments: '{count} ወርሃዊ ክፍያዎች', termsVerify: 'ውሎች በማረጋገጥ ላይ', buildSchedule: 'የራስዎን የምሳሌ መርሐግብር ይስሩ', homePrice: 'የቤት ዋጋ', currency: 'ምንዛሬ', upfrontDeposit: 'ቅድመ ክፍያ %', reservationFee: 'የቦታ ማስያዣ ክፍያ', paymentMonths: 'የክፍያ ወራት', mortgageIntro: 'የአበዳሪዎችን የወቅቱ የሕዝብ መረጃ ያወዳድሩ። ብቁነትና ፈቃድ የአበዳሪው ውሳኔ ነው።', rate: 'ግምታዊ ወለድ', quoteRequired: 'የወቅቱን ዋጋ ይጠይቁ', minDeposit: 'ዝቅተኛ ቅድመ ክፍያ', term: 'ከፍተኛ ጊዜ', years: '{count} ዓመታት', officialDetails: 'ይፋዊ መረጃ', widerArea: 'ካርታው ሰፊውን አካባቢ ያሳያል፤ ትክክለኛው ቦታ በማረጋገጥ ላይ ነው።', confirmTravel: 'ከመወሰንዎ በፊት የጉዞ ጊዜና ትክክለኛውን ቦታ ያረጋግጡ።', nearbyLive: 'በአካባቢው ያሉ ወቅታዊ የGoogle Maps ውጤቶች። ርቀትን ከትክክለኛው ቦታ ያረጋግጡ።', disclaimerTitle: 'የoff-plan መረጃ ሊቀየር ይችላል።', disclaimerBody: 'ማጭበርበር፣ ሐሰተኛ ሰነዶችና አሳሳች መረጃ አይፈቀዱም። ፈቃድ፣ ይዞታ፣ አልሚ፣ ውል፣ የክፍያ መዳረሻ፣ መስፈርት፣ ቀንና ተገኝነትን ያረጋግጡ።', confirmPrice: 'ከመክፈልዎ በፊት ዋጋና ተገኝነትን ያረጋግጡ።', upfront: 'ቅድመ ክፍያ', monthlyFrom: 'ወርሃዊ ከ', finalDate: 'የመጨረሻ ክፍያ ቀን', viewPayments: '{count} የክፍያ ቀናትን ይመልከቱ', calcDisclaimer: 'ይህ ምሳሌ ብቻ ነው። የተፈረመውን እቅድ፣ ክፍያዎች፣ ግብሮችና ምንዛሬን ያረጋግጡ።', openMaps: 'በGoogle Maps ይክፈቱ', areaOverviewFallback: 'ትክክለኛው ቦታ ከተረጋገጠ በኋላ ትምህርት ቤቶችን፣ ጤና አገልግሎቶችንና ጉዞን ያረጋግጡ።', requiredInfoTitle: 'ይህን የፕሮጀክት መረጃ ያዘጋጁ', requiredInfo: 'የፕሮጀክት ስም|አልሚ ወይም ባለቤት|ትክክለኛ ቦታና ፒን|የማጠናቀቂያ ቀን|ብሮሹርና ፈቃዶች|የፕሮጀክትና የግንባታ ምስሎች|የቤት ዓይነቶችና ዋጋ|የክፍያ እቅድና የማስያዣ ክፍያ|የግንባታ ሂደት|የተሸጡና የቀሩ ቤቶች', projectDetails: 'ያለዎት የፕሮጀክት መረጃ (አማራጭ)', projectDetailsPlaceholder: 'ስም፣ አልሚ፣ ቦታ፣ ቀን፣ ዋጋ፣ የክፍያ እቅድና ማስረጃ ሊንኮች'
  });
  Object.assign(OFF_PLAN_DETAIL_I18N.ar, {
    guidePrices: 'دليل بالشلن · أسعار المصدر بالدولار', unitVerifying: 'يتم التحقق من تفاصيل الوحدات.', milestonesVerifying: 'يتم التحقق من مراحل الدفع.', paymentMilestone: 'مرحلة الدفع', monthlyInstalments: '{count} دفعات شهرية', termsVerify: 'الشروط قيد التحقق', mortgageIntro: 'قارن معلومات المقرضين العامة الحالية. تظل الأهلية والأسعار والموافقة من قرارات المقرض.', rate: 'السعر الإرشادي', quoteRequired: 'يلزم عرض سعر حالي', minDeposit: 'الحد الأدنى للمقدم', term: 'المدة القصوى', years: '{count} سنة', officialDetails: 'التفاصيل الرسمية', widerArea: 'توضح الخريطة المنطقة الأوسع، بينما يتم تأكيد الموقع الدقيق.', confirmTravel: 'أكد أوقات التنقل والموقع الدقيق قبل الالتزام.', nearbyLive: 'نتائج Google Maps الحالية حول نقطة المنطقة. أكد المسافات من الموقع الدقيق.', calcDisclaimer: 'للتوضيح فقط. أكد خطة الدفع الموقعة والرسوم والضرائب وآثار سعر الصرف مع المطور ومستشارك.', areaOverviewFallback: 'أكد المدارس والرعاية الصحية والمواصلات بعد التحقق من الموقع الدقيق.', projectDetails: 'تفاصيل المشروع المتوفرة لديك (اختياري)', projectDetailsPlaceholder: 'اسم المشروع والمطور والموقع وموعد الإنجاز والأسعار وخطة الدفع وروابط الأدلة'
  });

  function offPlanLanguage() {
    const code = clean(document.documentElement.lang || 'en').toLowerCase().split('-')[0];
    return OFF_PLAN_I18N[code] ? code : 'en';
  }

  function offPlanText(key, replacements = {}) {
    const language = offPlanLanguage();
    const pack = OFF_PLAN_I18N[language] || OFF_PLAN_I18N.en;
    const compactPack = OFF_PLAN_COMPACT_I18N[language] || OFF_PLAN_COMPACT_I18N.en;
    const detailPack = OFF_PLAN_DETAIL_I18N[language] || OFF_PLAN_DETAIL_I18N.en;
    let value = detailPack[key] || compactPack[key] || pack[key] || OFF_PLAN_DETAIL_I18N.en[key] || OFF_PLAN_COMPACT_I18N.en[key] || OFF_PLAN_I18N.en[key] || key;
    Object.entries(replacements).forEach(([name, replacement]) => { value = value.replaceAll(`{${name}}`, String(replacement)); });
    return value;
  }

  const OFF_PLAN_DYNAMIC_I18N = {
    en: { townhouse: 'Townhouse', apartment: 'Apartment', house: 'House', mixed: 'Mixed use', upToMonths: 'Up to {count} months', reserveUnit: 'Reserve a unit', offerBalance: 'Offer price balance', share: 'Share', areaOverview: "Entebbe sits on a Lake Victoria peninsula and is Uganda's international aviation gateway. Exact travel times and nearby schools must be confirmed after the exact site pin is verified." },
    lg: { townhouse: 'Ennyumba ezikwatagana', apartment: 'Apartimenti', house: 'Ennyumba', mixed: 'Enkozesa ez’enjawulo', upToMonths: 'Okutuuka ku myezi {count}', reserveUnit: 'Kwata ennyumba', offerBalance: 'Balansi y’omuwendo', share: 'Gabana', areaOverview: 'Entebbe kiri ku kizinga kya Lake Victoria era kye mulyango gw’ennyonyi ogw’ensi yonna. Kakasa obudde bw’olugendo n’amasomero agali okumpi oluvannyuma lwa pin entuufu okukakasibwa.' },
    sw: { townhouse: 'Nyumba ya mjini', apartment: 'Fleti', house: 'Nyumba', mixed: 'Matumizi mchanganyiko', upToMonths: 'Hadi miezi {count}', reserveUnit: 'Hifadhi nyumba', offerBalance: 'Salio la bei ya ofa', share: 'Shiriki', areaOverview: 'Entebbe iko kwenye rasi ya Ziwa Victoria na ni lango la kimataifa la anga la Uganda. Thibitisha muda wa safari na shule za karibu baada ya pini halisi ya mradi kuthibitishwa.' },
    ac: { townhouse: 'Ot ma ori i dul', apartment: 'Apartment', house: 'Ot', mixed: 'Tic mapol', upToMonths: 'Naka dwe {count}', reserveUnit: 'Mok ot', offerBalance: 'Cente ma odong me wel', share: 'Nywak', areaOverview: 'Entebbe tye i dog nam Victoria dok en aye dog yo me ndege me Uganda. Mok cawa me wot ki gang kwan ma tye cok inge pin kikome kimoko.' },
    ny: { townhouse: 'Amaka agarikwatana', apartment: 'Apartimenti', house: 'Eka', mixed: 'Enkozesa ezitarikushushana', upToMonths: 'Okuhitsya amezi {count}', reserveUnit: 'Kwata eka', offerBalance: 'Ebirikusigara aha muhendo', share: 'Gabana', areaOverview: 'Entebbe eri aha mwanya gwa Lake Victoria kandi niyo muryango gw’enyonyi gw’ensi yoona. Hamya obwire bw’orugyendo n’amashomero agari haihi pin ehikire yaaheza kuhamibwa.' },
    rn: { townhouse: 'Amaka agarikwatana', apartment: 'Apartimenti', house: 'Eka', mixed: 'Enkozesa ezitarikushushana', upToMonths: 'Okuhitsya amezi {count}', reserveUnit: 'Kwata eka', offerBalance: 'Ebirikusigara aha muhendo', share: 'Gabana', areaOverview: 'Entebbe eri aha mwanya gwa Lake Victoria kandi niyo muryango gw’enyonyi gw’ensi yoona. Hamya obwire bw’orugyendo n’amashomero agari haihi pin ehikire yaaheza kuhamibwa.' },
    sm: { townhouse: 'Ennyumba edhikwatagana', apartment: 'Apartimenti', house: 'Ennyumba', mixed: 'Enkozesa edh’enjawulo', upToMonths: 'Okutuuka ku myezi {count}', reserveUnit: 'Kwata eka', offerBalance: 'Balansi y’omuwendo', share: 'Gabana', areaOverview: 'Entebbe kiri ku kizinga kya Lake Victoria era ni mulyango gwa Uganda ogw’ennyonyi edh’ensi yonna. Kakasa obwire bw’olugendo n’amasomero agali okumpi oluvainhuma lwa pin entuufu okukakasibwa.' },
    am: { townhouse: 'ታውንሃውስ', apartment: 'አፓርታማ', house: 'ቤት', mixed: 'የተቀላቀለ አጠቃቀም', upToMonths: 'እስከ {count} ወራት', reserveUnit: 'ቤት ያስይዙ', offerBalance: 'የቀረው የዋጋ ሂሳብ', share: 'አጋራ', areaOverview: 'ኢንቴቤ በቪክቶሪያ ሐይቅ ዳርቻ የሚገኝ ሲሆን የኡጋንዳ ዓለም አቀፍ የአየር በር ነው። ትክክለኛው ቦታ ከተረጋገጠ በኋላ የጉዞ ጊዜና በአቅራቢያ ያሉ ትምህርት ቤቶችን ያረጋግጡ።' },
    ar: { townhouse: 'تاون هاوس', apartment: 'شقة', house: 'منزل', mixed: 'متعدد الاستخدامات', upToMonths: 'حتى {count} شهراً', reserveUnit: 'احجز وحدة', offerBalance: 'رصيد سعر العرض', share: 'مشاركة', areaOverview: 'تقع إنتيبي على شبه جزيرة في بحيرة فيكتوريا وهي البوابة الجوية الدولية لأوغندا. أكد أوقات التنقل والمدارس القريبة بعد التحقق من الموقع الدقيق للمشروع.' }
  };

  function offPlanDynamicText(key, replacements = {}) {
    const pack = OFF_PLAN_DYNAMIC_I18N[offPlanLanguage()] || OFF_PLAN_DYNAMIC_I18N.en;
    let value = pack[key] || OFF_PLAN_DYNAMIC_I18N.en[key] || key;
    Object.entries(replacements).forEach(([name, replacement]) => { value = value.replaceAll(`{${name}}`, String(replacement)); });
    return value;
  }

  function localizedProjectType(value) {
    const key = clean(value).toLowerCase().replace(/[\s_-]+/g, '');
    return offPlanDynamicText({ townhouse: 'townhouse', apartment: 'apartment', flat: 'apartment', house: 'house', mixed: 'mixed', mixeduse: 'mixed' }[key] || 'house');
  }

  function localizedUnitLabel(unit = {}) {
    const bedrooms = number(unit.bedrooms);
    if (bedrooms != null) return `${bedrooms} ${offPlanText('bedrooms')} ${localizedProjectType(unit.property_type || 'house')}`;
    return localizedProjectType(unit.property_type || unit.label || 'house');
  }

  function localizedPaymentLabel(item = {}) {
    const label = clean(item.label).toLowerCase();
    if (label.includes('reserve')) return offPlanDynamicText('reserveUnit');
    if (item.kind === 'equal_monthly' || label.includes('balance')) return offPlanDynamicText('offerBalance');
    return item.label || offPlanText('paymentMilestone');
  }

  function refreshOffPlanContactCopy() {
    const title = document.getElementById('off-plan-contact-title');
    if (title) title.textContent = state.contactMode === 'project_interest'
      ? offPlanText('enquireProject', { name: state.activeProject?.name || OFF_PLAN_I18N.en.listProject })
      : offPlanText('listProject');
    const partner = document.querySelector('#off-plan-contact-modal [data-off-plan-i18n="partner"]');
    if (partner) partner.textContent = offPlanText('partner').replace(/makaug(?!\.com)/i, 'makaug.com');
    const requiredList = document.getElementById('off-plan-required-info-list');
    if (requiredList) requiredList.innerHTML = offPlanText('requiredInfo').split('|').map((item) => `<li><i class="fas fa-circle-check" aria-hidden="true"></i><span>${escapeHtml(item)}</span></li>`).join('');
    const selectedChannel = clean(document.getElementById('off-plan-contact-channel')?.value) || 'whatsapp';
    selectOffPlanContactChannel(selectedChannel);
  }

  function applyOffPlanLanguageUI() {
    const root = document.getElementById('page-off-plan');
    if (!root) return;
    root.querySelectorAll('[data-off-plan-i18n]').forEach((element) => { element.textContent = offPlanText(element.dataset.offPlanI18n); });
    root.querySelectorAll('[data-off-plan-i18n-placeholder]').forEach((element) => { element.setAttribute('placeholder', offPlanText(element.dataset.offPlanI18nPlaceholder)); });
    root.querySelectorAll('[data-off-plan-i18n-aria]').forEach((element) => { element.setAttribute('aria-label', offPlanText(element.dataset.offPlanI18nAria)); });
    root.querySelectorAll('[data-off-plan-type]').forEach((element) => { element.textContent = localizedProjectType(element.dataset.offPlanType); });
    root.querySelectorAll('[data-off-plan-months]').forEach((element) => { element.textContent = offPlanDynamicText('upToMonths', { count: element.dataset.offPlanMonths }); });
    if (state.activeProject) {
      const content = document.getElementById('off-plan-detail-content');
      if (content) {
        content.innerHTML = detailMarkup(state.activeProject);
        hydrateOffPlanDetail(state.activeProject);
      }
    } else if (state.loaded) renderList();
    refreshOffPlanContactCopy();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function number(value) {
    if (value == null || (typeof value === 'string' && !value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function formatMoney(value, currency = 'UGX') {
    const amount = number(value);
    if (amount == null) return offPlanText('priceRequest');
    const code = clean(currency).toUpperCase() || 'UGX';
    const prefix = { UGX: 'USh', USD: 'USD', GBP: 'GBP', EUR: 'EUR' }[code] || code;
    const locale = code === 'UGX' ? 'en-UG' : 'en-US';
    return `${prefix} ${Math.round(amount).toLocaleString(locale)}`;
  }
  function formatUgx(value) { return formatMoney(value, 'UGX'); }
  function formatUsd(value) {
    const amount = number(value);
    return amount == null ? '' : `USD ${Math.round(amount).toLocaleString('en-US')}`;
  }
  function metricValue(value, suffix = '') {
    const amount = number(value);
    return amount == null ? offPlanText('toConfirm') : `${amount}${suffix}`;
  }
  function formatDate(value) {
    if (!value) return offPlanText('toConfirm');
    const date = new Date(value);
    const locale = { lg: 'en-UG', sw: 'sw-KE', ar: 'ar', am: 'am-ET' }[String(window.currentLang || 'en').toLowerCase()] || 'en-UG';
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
  }
  function projectLocation(project) { return [project.area, project.district].filter(Boolean).join(', ') || offPlanText('toConfirm'); }
  function imageUrl(project, index = 0) { return project.images?.[index]?.url || '/assets/icons/makaug-icon-512.png'; }
  function imageCaption(project, index = 0) { return project.images?.[index]?.caption || `${project.name} project image`; }
  function track(name, payload = {}) { if (typeof window.trackEvent === 'function') window.trackEvent(name, payload); }

  function managementHeaders(role) {
    const headers = {};
    try {
      const stored = JSON.parse(localStorage.getItem('makaug_auth') || '{}');
      if (stored.token) headers.Authorization = `Bearer ${stored.token}`;
      if (role === 'admin') {
        const key = clean(localStorage.getItem('makaug_admin_api_key'));
        if (key) headers['x-api-key'] = key;
      }
    } catch (_error) {}
    return headers;
  }

  async function request(path, options = {}) {
    const bootstrap = window.__makaugOffPlanBootstrap;
    if ((!options.method || options.method === 'GET') && bootstrap && !bootstrap.used && bootstrap.path === path && bootstrap.promise) {
      bootstrap.used = true;
      return bootstrap.promise;
    }
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(payload?.error || `Request failed (${response.status})`);
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function progressMarkup(label, value) {
    const amount = number(value);
    const known = amount != null;
    const width = known ? Math.max(0, Math.min(100, amount)) : 0;
    return `<div><div class="flex items-center justify-between gap-3 text-xs"><span class="font-bold text-gray-700">${escapeHtml(label)}</span><span class="font-black text-green-800">${known ? offPlanText('percentComplete', { count: width }) : offPlanText('toConfirm')}</span></div><div class="off-plan-meter mt-2"><span style="width:${width}%"></span></div></div>`;
  }

  function projectCard(project) {
    const unitPrices = (project.unit_types || []).map((unit) => number(unit.price_ugx)).filter((value) => value != null && value > 0);
    const launch = number(project.launch_price_ugx) || (unitPrices.length ? Math.min(...unitPrices) : null);
    const bedrooms = (project.unit_types || []).map((unit) => number(unit.bedrooms)).filter((value) => value != null).sort((a, b) => a - b);
    const bedroomLabel = bedrooms.length ? `${bedrooms[0]}${bedrooms.at(-1) !== bedrooms[0] ? ` - ${bedrooms.at(-1)}` : ''} ${offPlanText('bedrooms')}` : offPlanText('homes');
    const sourceName = clean(project.source_agent_name || project.source_display_name);
    const sourceId = clean(project.source_agent_profile_id || project.source_agent_id);
    const statusLabel = project.verification_status === 'verified' ? offPlanText('verifiedProject') : offPlanText('sourceDetails');
    const delivery = `${offPlanText('delivery')}: ${formatDate(project.completion_date)}`;
    const typeLabel = localizedProjectType(project.project_type || 'house');
    return `<article class="off-plan-card">
      <div class="off-plan-card-image">
        <img src="${escapeHtml(imageUrl(project))}" alt="${escapeHtml(imageCaption(project))}" loading="lazy">
        <a class="off-plan-card-cover" href="/off-plan/${encodeURIComponent(project.slug)}" data-off-plan-project="${escapeHtml(project.slug)}" aria-label="${escapeHtml(offPlanText('viewPhotos', { count: project.images?.length || 1 }))}: ${escapeHtml(project.name)}"></a>
        <div class="off-plan-card-badges"><span class="off-plan-pill bg-white/95 text-green-800">Off Plan</span><span class="off-plan-pill bg-black/65 text-white">${escapeHtml(delivery)}</span></div>
        <div class="off-plan-card-content"><span class="off-plan-pill bg-white/95 text-green-800"><i class="fas fa-circle-check" aria-hidden="true"></i>${escapeHtml(statusLabel)}</span><h3>${escapeHtml(project.name)}</h3><p class="mt-1 text-sm"><i class="fas fa-location-dot mr-1" aria-hidden="true"></i>${escapeHtml(projectLocation(project))}</p><div class="off-plan-card-meta"><span><i class="fas fa-bed mr-1" aria-hidden="true"></i>${escapeHtml(bedroomLabel)}</span><span><i class="fas fa-house mr-1" aria-hidden="true"></i>${escapeHtml(typeLabel)}</span></div><p class="mt-3 text-xs">${escapeHtml(offPlanText('launchPrice'))}</p><strong class="off-plan-card-price">${escapeHtml(formatUgx(launch))}</strong>${project.payment_plan_months ? `<span class="off-plan-card-plan">${escapeHtml(offPlanText('monthPlan', { count: project.payment_plan_months }))}</span>` : ''}</div>
      </div>
      <div class="off-plan-card-actions">${sourceId ? `<a class="off-plan-card-agent" href="/agents/${encodeURIComponent(sourceId)}"><i class="fas fa-user-check" aria-hidden="true"></i>${escapeHtml(sourceName || offPlanText('viewBroker'))}</a>` : `<span class="off-plan-card-agent"><i class="fas fa-building" aria-hidden="true"></i>${escapeHtml(sourceName || offPlanText('projectTeam'))}</span>`}<button type="button" class="off-plan-card-whatsapp" data-off-plan-enquire="${escapeHtml(project.id)}" aria-label="${escapeHtml(offPlanText('enquireProject', { name: project.name }))}"><i class="fab fa-whatsapp" aria-hidden="true"></i></button></div>
    </article>`;
  }

  function renderList() {
    const grid = document.getElementById('off-plan-results');
    const summary = document.getElementById('off-plan-result-summary');
    if (!grid) return;
    if (!state.projects.length) {
      grid.innerHTML = `<div class="md:col-span-2 rounded-3xl border border-green-100 bg-white p-8 md:p-12 text-center"><div class="mx-auto h-14 w-14 rounded-2xl bg-green-50 text-green-700 grid place-items-center text-xl"><i class="fas fa-building-circle-check"></i></div><h3 class="mt-4 text-xl font-black text-gray-950">${escapeHtml(offPlanText('noProjectsTitle'))}</h3><p class="mt-2 text-sm text-gray-600 max-w-xl mx-auto">${escapeHtml(offPlanText('noProjectsBody'))}</p><button onclick="openOffPlanContactModal()" class="mt-5 rounded-xl bg-green-700 text-white px-5 py-3 font-black">${escapeHtml(offPlanText('listProject'))}</button></div>`;
      if (summary) summary.textContent = offPlanText('noProjectsSummary');
      renderOffPlanMap();
      return;
    }
    grid.innerHTML = state.projects.map(projectCard).join('');
    if (summary) summary.textContent = offPlanText('projectsFound', { count: state.projects.length });
    renderOffPlanMap();
  }

  async function loadLocations() {
    const chips = document.getElementById('off-plan-location-chips');
    if (!chips || chips.dataset.loaded === '1') return;
    try {
      const data = await request('/api/off-plan/locations');
      chips.innerHTML = (data.locations || []).slice(0, 10).map((item) => `<button type="button" class="off-plan-location-chip" data-off-plan-area="${escapeHtml(item.area || '')}" data-off-plan-district="${escapeHtml(item.district || '')}">${escapeHtml(item.area || item.district)} (${Number(item.project_count) || 0})</button>`).join('');
      chips.dataset.loaded = '1';
    } catch (_error) {}
  }

  function clearSelectedOffPlanLocation() {
    state.selectedLocation = null;
    ['off-plan-location-key', 'off-plan-location-area', 'off-plan-location-district'].forEach((id) => { const input = document.getElementById(id); if (input) input.value = ''; });
  }

  function closeOffPlanLocationSuggestions() {
    const input = document.getElementById('off-plan-q');
    const panel = document.getElementById('off-plan-location-suggestions');
    panel?.classList.remove('open');
    if (panel) panel.innerHTML = '';
    input?.setAttribute('aria-expanded', 'false');
  }

  function selectOffPlanLocation(suggestion = {}) {
    const id = clean(suggestion.canonical_location_id || suggestion.id);
    const area = clean(suggestion.name || suggestion.label || suggestion.area);
    const district = clean(suggestion.district || suggestion.province);
    if (!area) return;
    state.selectedLocation = { ...suggestion, id, area, district };
    const query = document.getElementById('off-plan-q');
    if (query) query.value = area;
    const keyInput = document.getElementById('off-plan-location-key'); if (keyInput) keyInput.value = id;
    const areaInput = document.getElementById('off-plan-location-area'); if (areaInput) areaInput.value = area;
    const districtInput = document.getElementById('off-plan-location-district'); if (districtInput) districtInput.value = district;
    closeOffPlanLocationSuggestions();
    loadProjects();
  }

  function renderOffPlanLocationSuggestions(response = {}) {
    const panel = document.getElementById('off-plan-location-suggestions');
    const input = document.getElementById('off-plan-q');
    if (!panel || !input) return;
    const suggestions = [
      ...(Array.isArray(response.data) ? response.data : []),
      ...(Array.isArray(response.meta?.disambiguation_suggestions) ? response.meta.disambiguation_suggestions : []),
      ...(Array.isArray(response.meta?.did_you_mean_suggestions) ? response.meta.did_you_mean_suggestions : [])
    ].filter((item, index, rows) => rows.findIndex((other) => (other.canonical_location_id || other.id) === (item.canonical_location_id || item.id)) === index).slice(0, 8);
    state.locationSuggestions = suggestions;
    panel.innerHTML = suggestions.length ? suggestions.map((item, index) => `<button type="button" class="off-plan-location-suggestion" role="option" data-off-plan-location-index="${index}"><span><strong>${escapeHtml(item.name || item.label)}</strong><small>${escapeHtml(item.parent_path || item.district || '')}</small></span><span>${escapeHtml(item.type_label || 'Location')}</span></button>`).join('') : '<div class="off-plan-location-empty">No matching location. You can still search by project or developer.</div>';
    panel.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
  }

  async function fetchOffPlanLocationSuggestions(query) {
    const params = new URLSearchParams({ q: query, limit: '8' });
    try {
      const response = await fetch(`/api/properties/locations/suggest?${params.toString()}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Location lookup failed');
      renderOffPlanLocationSuggestions(data);
    } catch (_error) { closeOffPlanLocationSuggestions(); }
  }

  function syncOffPlanSearchUrl(params) {
    if (!/^\/off-plan\/?$/i.test(location.pathname)) return;
    const query = params.toString();
    history.replaceState({ page: 'off-plan' }, '', `/off-plan${query ? `?${query}` : ''}`);
  }

  async function loadProjects() {
    if (state.loading) { state.pendingReload = true; return; }
    state.loading = true;
    const grid = document.getElementById('off-plan-results');
    if (grid) grid.innerHTML = '<div class="off-plan-skeleton"></div><div class="off-plan-skeleton"></div>';
    const params = new URLSearchParams();
    const q = clean(document.getElementById('off-plan-q')?.value);
    const area = clean(document.getElementById('off-plan-location-area')?.value);
    const district = clean(document.getElementById('off-plan-location-district')?.value);
    const bedrooms = clean(document.getElementById('off-plan-bedrooms')?.value);
    const maxPrice = clean(document.getElementById('off-plan-max-price')?.value);
    const projectType = clean(document.getElementById('off-plan-property-type')?.value);
    const paymentMonths = clean(document.getElementById('off-plan-payment-months')?.value);
    const completionYear = clean(document.getElementById('off-plan-completion-year')?.value);
    if (area) params.set('area', area);
    if (district) params.set('district', district);
    if (q && !area) params.set('q', q);
    if (bedrooms) params.set('bedrooms', bedrooms);
    if (maxPrice) params.set('max_price_ugx', maxPrice);
    if (projectType) params.set('project_type', projectType);
    if (paymentMonths) params.set('max_payment_months', paymentMonths);
    if (completionYear) params.set('completion_year', completionYear);
    syncOffPlanSearchUrl(params);
    try {
      const data = await request(`/api/off-plan?${params.toString()}`);
      state.projects = data.developments || [];
      state.loaded = true;
      renderList();
    } catch (error) {
      if (grid) grid.innerHTML = `<div class="md:col-span-2 rounded-2xl border border-red-100 bg-red-50 p-6 text-red-900"><strong>Projects could not be loaded.</strong><p class="text-sm mt-1">${escapeHtml(error.message)} Please try again.</p></div>`;
    } finally {
      state.loading = false;
      if (state.pendingReload) { state.pendingReload = false; loadProjects(); }
    }
  }

  function searchOffPlan(event) {
    if (event) event.preventDefault();
    track('off_plan_search', { query: clean(document.getElementById('off-plan-q')?.value), location: clean(document.getElementById('off-plan-location-area')?.value), bedrooms: clean(document.getElementById('off-plan-bedrooms')?.value) });
    closeOffPlanLocationSuggestions();
    loadProjects();
    return false;
  }
  function openOffPlanFromHero() {
    const heroQuery = clean(document.getElementById('hero-q')?.value);
    if (typeof window.showPage === 'function') window.showPage('off-plan'); else window.location.href = heroQuery ? `/off-plan?q=${encodeURIComponent(heroQuery)}` : '/off-plan';
    window.setTimeout(() => { const input = document.getElementById('off-plan-q'); if (input && heroQuery) { clearSelectedOffPlanLocation(); input.value = heroQuery; fetchOffPlanLocationSuggestions(heroQuery); loadProjects(); } }, 0);
  }

  async function ensureOffPlanGoogleMaps() {
    if (window.google?.maps) return true;
    if (typeof window.ensureGoogleMapsApi !== 'function') return false;
    return Boolean(await window.ensureGoogleMapsApi());
  }

  function clearOffPlanMarkers() {
    state.mapMarkers.forEach((marker) => marker?.setMap?.(null));
    state.mapMarkers = [];
  }

  function googleMapsLink(project) {
    const lat = number(project.latitude); const lng = number(project.longitude);
    const query = lat != null && lng != null ? `${lat},${lng}` : `${projectLocation(project)} ${project.name}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  async function renderOffPlanMap() {
    const shell = document.getElementById('off-plan-map-shell');
    const container = document.getElementById('off-plan-map');
    if (!shell || !container || shell.classList.contains('is-hidden')) return;
    const projects = state.projects.filter((project) => number(project.latitude) != null && number(project.longitude) != null);
    try {
      const ready = await ensureOffPlanGoogleMaps();
      if (!ready || !document.body.contains(container)) throw new Error('Google Maps unavailable');
      clearOffPlanMarkers();
      container.innerHTML = '';
      const map = new window.google.maps.Map(container, { center: { lat: 1.3733, lng: 32.2903 }, zoom: 7, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, scrollwheel: false });
      state.map = map;
      if (projects.length) {
        const bounds = new window.google.maps.LatLngBounds();
        const infoWindow = new window.google.maps.InfoWindow();
        projects.forEach((project) => {
          const lat = number(project.latitude); const lng = number(project.longitude);
          const position = { lat, lng };
          bounds.extend(position);
          const marker = new window.google.maps.Marker({ map, position, title: project.name, icon: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' });
          const content = `<div class="off-plan-map-popup"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(projectLocation(project))}</span><a href="/off-plan/${encodeURIComponent(project.slug)}">${escapeHtml(offPlanText('viewProfile'))}</a></div>`;
          marker.addListener('click', () => { infoWindow.setContent(content); infoWindow.open({ map, anchor: marker }); });
          marker.addListener('mouseover', () => { infoWindow.setContent(content); infoWindow.open({ map, anchor: marker }); });
          state.mapMarkers.push(marker);
        });
        if (projects.length === 1) map.setOptions({ center: { lat: number(projects[0].latitude), lng: number(projects[0].longitude) }, zoom: 12 });
        else { map.fitBounds(bounds, 32); window.google.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 12) map.setZoom(12); }); }
      }
    } catch (_error) {
      container.innerHTML = `<div class="h-full grid place-items-center px-6 text-center text-sm text-gray-600"><span><i class="fas fa-map-location-dot text-2xl text-red-600 block mb-2"></i>${escapeHtml(offPlanText('mapUnavailable'))}<a class="block mt-2 font-black text-green-800 underline" href="https://www.google.com/maps/search/?api=1&query=Uganda" target="_blank" rel="noopener noreferrer">${escapeHtml(offPlanText('openMaps'))}</a></span></div>`;
    }
  }

  function toggleOffPlanMap() {
    const shell = document.getElementById('off-plan-map-shell');
    const button = document.getElementById('off-plan-map-button');
    if (!shell) return;
    state.mapVisible = shell.classList.contains('is-hidden');
    shell.classList.toggle('is-hidden', !state.mapVisible);
    button?.setAttribute('aria-pressed', state.mapVisible ? 'true' : 'false');
    if (state.mapVisible) renderOffPlanMap();
  }

  function toggleOffPlanFilters() {
    const panel = document.getElementById('off-plan-advanced-filters');
    const button = document.getElementById('off-plan-filters-button');
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    button?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function toggleOffPlanAi() {
    const panel = document.getElementById('off-plan-ai-panel');
    const button = document.querySelector('[aria-controls="off-plan-ai-panel"]');
    if (!panel) return;
    const open = panel.hidden;
    panel.hidden = !open;
    button?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) panel.querySelector('[data-ai-message]')?.focus();
  }

  function clearOffPlanFilters() {
    clearSelectedOffPlanLocation();
    ['off-plan-q', 'off-plan-property-type', 'off-plan-bedrooms', 'off-plan-max-price', 'off-plan-payment-months', 'off-plan-completion-year'].forEach((id) => { const input = document.getElementById(id); if (input) input.value = ''; });
    document.querySelectorAll('.off-plan-location-chip.active').forEach((chip) => chip.classList.remove('active'));
    loadProjects();
  }

  function prepopulateOffPlanSearch() {
    if (!/^\/off-plan\/?$/i.test(location.pathname)) return;
    const params = new URLSearchParams(location.search);
    const q = clean(params.get('q') || params.get('query') || params.get('location') || params.get('area'));
    const area = clean(params.get('area'));
    const district = clean(params.get('district'));
    const query = document.getElementById('off-plan-q');
    if (query && q) query.value = q;
    if (area) {
      state.selectedLocation = { id: clean(params.get('location_id')), area, district, name: area };
      const keyInput = document.getElementById('off-plan-location-key'); if (keyInput) keyInput.value = state.selectedLocation.id;
      const areaInput = document.getElementById('off-plan-location-area'); if (areaInput) areaInput.value = area;
      const districtInput = document.getElementById('off-plan-location-district'); if (districtInput) districtInput.value = district;
    }
    const values = { 'off-plan-property-type': params.get('project_type'), 'off-plan-bedrooms': params.get('bedrooms'), 'off-plan-max-price': params.get('max_price_ugx'), 'off-plan-payment-months': params.get('max_payment_months'), 'off-plan-completion-year': params.get('completion_year') };
    Object.entries(values).forEach(([id, value]) => { const input = document.getElementById(id); if (input && value) input.value = value; });
  }

  function wireOffPlanDirectoryControls() {
    const root = document.getElementById('page-off-plan');
    const input = document.getElementById('off-plan-q');
    if (!root || root.dataset.directoryBound === '1') return;
    root.dataset.directoryBound = '1';
    input?.addEventListener('input', () => {
      if (state.selectedLocation && input.value !== state.selectedLocation.area) clearSelectedOffPlanLocation();
      window.clearTimeout(state.locationTimer);
      const query = input.value.trim();
      if (query.length < 2) { closeOffPlanLocationSuggestions(); return; }
      state.locationTimer = window.setTimeout(() => fetchOffPlanLocationSuggestions(query), 180);
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeOffPlanLocationSuggestions();
      if (event.key === 'Enter' && state.locationSuggestions[0] && document.getElementById('off-plan-location-suggestions')?.classList.contains('open')) {
        event.preventDefault();
        selectOffPlanLocation(state.locationSuggestions[0]);
      }
    });
    document.getElementById('off-plan-location-suggestions')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-off-plan-location-index]');
      if (button) selectOffPlanLocation(state.locationSuggestions[Number(button.dataset.offPlanLocationIndex)]);
    });
    document.getElementById('off-plan-location-chips')?.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-off-plan-area]');
      if (!chip) return;
      document.querySelectorAll('.off-plan-location-chip.active').forEach((item) => item.classList.toggle('active', item === chip));
      selectOffPlanLocation({ name: chip.dataset.offPlanArea, district: chip.dataset.offPlanDistrict });
    });
    document.getElementById('off-plan-results')?.addEventListener('click', (event) => {
      const projectLink = event.target.closest('[data-off-plan-project]');
      if (projectLink) { event.preventDefault(); openOffPlanDetail(projectLink.dataset.offPlanProject); return; }
      const enquiry = event.target.closest('[data-off-plan-enquire]');
      if (enquiry) { state.activeProject = state.projects.find((project) => String(project.id) === String(enquiry.dataset.offPlanEnquire)) || null; openOffPlanContactModal(enquiry.dataset.offPlanEnquire, 'project_interest'); }
    });
    document.addEventListener('click', (event) => { if (!event.target.closest('.off-plan-query-field')) closeOffPlanLocationSuggestions(); });
    root.querySelectorAll('#off-plan-property-type, #off-plan-bedrooms, #off-plan-max-price, #off-plan-payment-months, #off-plan-completion-year').forEach((control) => control.addEventListener('change', () => loadProjects()));
  }

  function galleryMarkup(project) {
    const allImages = project.images || [];
    const images = allImages.slice(0, 3);
    if (!images.length) return '<div class="rounded-3xl bg-gray-100 h-[360px]"></div>';
    while (images.length < 3) images.push(images[0]);
    const preview = `<div class="off-plan-gallery">${images.map((image, index) => `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.caption || project.name)}"><figcaption>${escapeHtml(image.caption || offPlanText('projectImage'))}</figcaption>${index === 2 && allImages.length > 3 ? `<button type="button" onclick="openOffPlanGallery()" class="absolute right-3 top-3 rounded-lg bg-white/95 text-gray-950 px-3 py-2 text-xs font-black"><i class="fas fa-images mr-1"></i>${escapeHtml(offPlanText('viewPhotos', { count: allImages.length }))}</button>` : ''}</figure>`).join('')}</div>`;
    if (allImages.length <= 3) return preview;
    return `${preview}<dialog id="off-plan-gallery-dialog" class="off-plan-gallery-dialog" aria-labelledby="off-plan-gallery-title"><div class="off-plan-gallery-dialog-head"><div><p class="text-xs font-black uppercase tracking-wide text-green-700">${escapeHtml(offPlanText('projectGallery'))}</p><h2 id="off-plan-gallery-title">${escapeHtml(project.name)}</h2></div><button type="button" onclick="closeOffPlanGallery()" aria-label="${escapeHtml(offPlanText('close'))}"><i class="fas fa-xmark" aria-hidden="true"></i></button></div><div class="off-plan-gallery-dialog-grid">${allImages.map((image) => `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.caption || project.name)}" loading="lazy"><figcaption>${escapeHtml(image.caption || offPlanText('projectImage'))}</figcaption></figure>`).join('')}</div></dialog>`;
  }

  function unitTable(project) {
    if (!(project.unit_types || []).length) return `<p class="text-sm text-gray-500">${escapeHtml(offPlanText('unitVerifying'))}</p>`;
    return `<div class="overflow-x-auto"><table class="off-plan-unit-table"><thead><tr><th>${escapeHtml(offPlanText('homeType'))}</th><th>${escapeHtml(offPlanText('bedrooms'))}</th><th>${escapeHtml(offPlanText('size'))}</th><th>${escapeHtml(offPlanText('guidePrice'))}</th><th></th></tr></thead><tbody>${project.unit_types.map((unit, index) => `<tr><td class="font-black text-gray-950">${escapeHtml(localizedUnitLabel(unit))}</td><td>${escapeHtml(unit.bedrooms ?? '—')}</td><td>${unit.size_sqm ? `${escapeHtml(unit.size_sqm)} m²` : escapeHtml(offPlanText('toConfirm'))}</td><td><strong class="block">${escapeHtml(formatUgx(unit.price_ugx))}</strong>${unit.price_original ? `<span class="block mt-1 text-xs text-gray-500">${escapeHtml(formatMoney(unit.price_original, unit.price_original_currency || 'USD'))}</span>` : ''}</td><td><button type="button" onclick="selectOffPlanUnit(${index})" class="rounded-lg border border-green-200 text-green-800 px-3 py-2 text-xs font-black">${escapeHtml(offPlanText('calculate'))}</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function paymentPlanMarkup(project) {
    const steps = project.payment_plan || [];
    const cards = steps.length ? steps.map((item, index) => `<div class="rounded-2xl ${index === 0 ? 'bg-green-800 text-white' : 'bg-green-50 text-green-950'} p-4"><span class="text-xs font-black uppercase tracking-wide opacity-70">${escapeHtml(offPlanText('step', { count: index + 1 }))}</span><strong class="block mt-1">${escapeHtml(localizedPaymentLabel(item))}</strong><span class="block text-sm mt-1">${item.percent != null ? `${escapeHtml(item.percent)}%` : item.amount_ugx ? formatUgx(item.amount_ugx) : item.months ? offPlanText('monthlyInstalments', { count: item.months }) : escapeHtml(item.due || offPlanText('termsVerify'))}</span></div>`).join('') : `<p class="text-sm text-gray-500">${escapeHtml(offPlanText('milestonesVerifying'))}</p>`;
    return `<div class="off-plan-payment-grid grid gap-3">${cards}<div class="rounded-2xl border-2 border-dashed border-green-300 bg-white p-4"><span class="text-xs font-black uppercase tracking-wide text-green-700">${escapeHtml(offPlanText('step', { count: steps.length + 1 }))}</span><strong class="block mt-1 text-gray-950">${escapeHtml(offPlanText('buildYourOwn'))}</strong><span class="block text-sm mt-1 text-gray-500">${escapeHtml(offPlanText('buildSchedule'))}</span></div></div>`;
  }

  function mapMarkup(project) {
    const lat = number(project.latitude); const lon = number(project.longitude);
    if (lat == null || lon == null) return `<div class="off-plan-map grid place-items-center text-center px-6"><div><i class="fas fa-map-location-dot text-3xl text-red-600"></i><strong class="block mt-3 text-gray-950">${escapeHtml(offPlanText('toConfirm'))}</strong><p class="text-sm text-gray-500 mt-1">${escapeHtml(offPlanText('confirmTravel'))}</p></div></div>`;
    return `<div id="off-plan-detail-map" class="off-plan-map" role="region" aria-label="${escapeHtml(offPlanText('locationArea'))}: ${escapeHtml(project.name)}"></div><a class="mt-3 inline-flex items-center gap-2 text-sm font-black text-green-800 hover:text-green-600" href="${escapeHtml(googleMapsLink(project))}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square text-red-600"></i>${escapeHtml(offPlanText('openMaps'))}</a>`;
  }

  function projectAgentPhoto(project) {
    return project.source_agent_profile_photo_url || (clean(project.source_agent_name).toLowerCase() === 'kazi honest' ? '/assets/agents/kazi-honest-professional-v2.jpg?v=20260901b' : '');
  }

  function agentCardMarkup(project) {
    const sourceName = clean(project.source_agent_name || project.source_display_name) || offPlanText('projectTeam');
    const sourceId = clean(project.source_agent_profile_id || project.source_agent_id);
    if (!sourceId) return '';
    const photo = projectAgentPhoto(project);
    const bio = clean(project.source_agent_bio);
    return `<section class="off-plan-panel"><p class="text-xs font-black uppercase tracking-wide text-green-700">${escapeHtml(offPlanText('projectContact'))}</p><div class="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div class="flex items-center gap-4">${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(sourceName)}" class="h-20 w-20 rounded-full object-cover border-4 border-green-50">` : `<span class="h-20 w-20 rounded-full bg-green-50 text-green-800 grid place-items-center text-2xl"><i class="fas fa-user"></i></span>`}<div><strong class="block text-lg text-gray-950">${escapeHtml(sourceName)}</strong>${project.source_agent_company ? `<span class="block text-sm text-gray-500">${escapeHtml(project.source_agent_company)}</span>` : ''}<span class="block text-sm text-gray-500">${escapeHtml(offPlanText('linkedProfile'))}</span></div></div><a href="/agents/${encodeURIComponent(sourceId)}" class="rounded-xl bg-green-50 text-green-800 px-4 py-2.5 text-sm font-black text-center">${escapeHtml(offPlanText('viewProfile'))}</a></div>${bio ? `<p class="mt-4 text-sm leading-6 text-gray-600">${escapeHtml(bio)}</p>` : ''}</section>`;
  }

  function calculatorMarkup(project, firstPrice) {
    const sourceUnit = (project.unit_types || []).find((unit) => number(unit.price_original) != null);
    const originalCurrency = sourceUnit?.price_original_currency || project.original_currency || 'USD';
    return `<div class="mt-6 rounded-2xl border border-green-100 bg-[#f4faf5] p-5"><h3 class="font-black text-gray-950">${escapeHtml(offPlanText('buildSchedule'))}</h3><div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-4"><label class="text-xs font-bold text-gray-700">${escapeHtml(offPlanText('currency'))}<select id="off-plan-calc-currency" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm" onchange="changeOffPlanCalculatorCurrency(this.value)"><option value="UGX">UGX</option><option value="${escapeHtml(originalCurrency)}">${escapeHtml(originalCurrency)}</option><option value="GBP">GBP</option><option value="EUR">EUR</option></select></label><label class="text-xs font-bold text-gray-700">${escapeHtml(offPlanText('homePrice'))}<input id="off-plan-calc-price" type="number" min="0" value="${escapeHtml(firstPrice)}" data-ugx-value="${escapeHtml(firstPrice)}" data-original-value="${escapeHtml(sourceUnit?.price_original || '')}" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm"></label><label class="text-xs font-bold text-gray-700">${escapeHtml(offPlanText('upfrontDeposit'))}<input id="off-plan-calc-deposit" type="number" min="0" max="100" value="${escapeHtml(project.payment_plan?.find((item) => item.percent)?.percent || 0)}" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm"></label><label class="text-xs font-bold text-gray-700">${escapeHtml(offPlanText('reservationFee'))}<input id="off-plan-calc-reservation" type="number" min="0" value="${escapeHtml(project.reservation_fee_ugx || 0)}" data-ugx-value="${escapeHtml(project.reservation_fee_ugx || 0)}" data-original-value="${escapeHtml(project.extra_fields?.reservation_fee_original || 1500)}" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm"></label><label class="text-xs font-bold text-gray-700">${escapeHtml(offPlanText('paymentMonths'))}<input id="off-plan-calc-months" type="number" min="1" max="120" value="${escapeHtml(project.payment_plan_months || 12)}" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm"></label></div><button type="button" onclick="calculateOffPlanPayments()" class="mt-4 rounded-xl bg-green-700 text-white px-5 py-3 font-black">${escapeHtml(offPlanText('calculateDates'))}</button><div id="off-plan-calculator-result" class="mt-4"></div></div><div class="mt-5 rounded-2xl border border-emerald-100 bg-white overflow-hidden"><button type="button" onclick="toggleOffPlanMortgage()" class="w-full flex items-center justify-between gap-3 px-5 py-4 text-left text-sm font-black text-green-800" aria-controls="off-plan-mortgage-panel" aria-expanded="false" id="off-plan-mortgage-toggle"><span><i class="fas fa-house-circle-check mr-2"></i>${escapeHtml(offPlanText('mortgageOptions'))}</span><i class="fas fa-chevron-down"></i></button><div id="off-plan-mortgage-panel" class="hidden border-t border-emerald-100 p-5"><p class="text-sm text-gray-600">${escapeHtml(offPlanText('mortgageIntro'))}</p><div id="off-plan-mortgage-results" class="mt-4 grid md:grid-cols-3 gap-3"></div></div></div>`;
  }

  function detailMarkup(project) {
    const units = project.unit_types || [];
    const firstPrice = units.map((unit) => number(unit.price_ugx)).find((value) => value && value > 0) || project.launch_price_ugx || '';
    const fullyVerified = project.verification_status === 'verified';
    const sourceName = clean(project.source_agent_name || project.source_display_name) || offPlanText('projectTeam');
    const soldLabel = project.units_sold == null || project.units_total == null ? offPlanText('toConfirm') : `${project.units_sold} / ${project.units_total}`;
    const description = project.slug === 'entebbe-victoria-palms' ? offPlanText('previewDescription') : (project.description || offPlanText('toConfirm'));
    const areaOverview = project.slug === 'entebbe-victoria-palms' ? offPlanDynamicText('areaOverview') : (clean(project.extra_fields?.area_overview) || offPlanText('areaOverviewFallback'));
    return `${galleryMarkup(project)}
      <div class="off-plan-detail-grid mt-7">
        <main class="min-w-0 space-y-6">
          <div><div class="flex flex-wrap gap-2"><span class="off-plan-pill ${fullyVerified ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-900'}"><i class="fas fa-circle-check"></i>${escapeHtml(fullyVerified ? offPlanText('verifiedProject') : offPlanText('sourceDetails'))}</span><span class="off-plan-pill bg-amber-100 text-amber-900">${escapeHtml(localizedProjectType(project.project_type || 'house'))}</span></div><h1 class="mt-3 text-3xl md:text-5xl font-black text-gray-950 leading-tight">${escapeHtml(project.name)}</h1><p class="mt-2 text-gray-500"><i class="fas fa-location-dot mr-1 text-red-600"></i>${escapeHtml(projectLocation(project))}${project.developer_name ? ` · ${escapeHtml(project.developer_name)}` : ''}</p></div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><div class="off-plan-stat"><span class="text-xs text-gray-500">${escapeHtml(offPlanText('expectedCompletion'))}</span><strong class="block mt-1">${escapeHtml(formatDate(project.completion_date))}</strong></div><div class="off-plan-stat"><span class="text-xs text-gray-500">${escapeHtml(offPlanText('construction'))}</span><strong class="block mt-1">${escapeHtml(number(project.construction_progress) == null ? offPlanText('toConfirm') : offPlanText('percentComplete', { count: project.construction_progress }))}</strong></div><div class="off-plan-stat"><span class="text-xs text-gray-500">${escapeHtml(offPlanText('homesSold'))}</span><strong class="block mt-1">${escapeHtml(soldLabel)}</strong></div><div class="off-plan-stat"><span class="text-xs text-gray-500">${escapeHtml(offPlanText('homesRemaining'))}</span><strong class="block mt-1">${escapeHtml(metricValue(project.units_available))}</strong></div></div>
          <section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">${escapeHtml(offPlanText('aboutDevelopment'))}</h2><p class="mt-3 text-sm md:text-base text-gray-700 leading-7 whitespace-pre-line">${escapeHtml(description)}</p></section>
          ${agentCardMarkup(project)}
          <section class="off-plan-panel"><div class="flex items-end justify-between gap-3"><div><p class="text-xs font-black uppercase tracking-wide text-green-700">${escapeHtml(offPlanText('chooseHome'))}</p><h2 class="mt-1 text-xl font-black text-gray-950">${escapeHtml(offPlanText('unitTypesPrices'))}</h2></div><span class="text-xs text-gray-500">${escapeHtml(offPlanText('guidePrices'))}</span></div><div class="mt-4">${unitTable(project)}</div></section>
          <section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">${escapeHtml(offPlanText('projectProgress'))}</h2><div class="grid sm:grid-cols-2 gap-6 mt-5">${progressMarkup(offPlanText('constructionCompleted'), project.construction_progress)}${progressMarkup(offPlanText('homesSold'), project.sales_progress)}</div></section>
          <section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">${escapeHtml(offPlanText('paymentPlan'))}</h2><div class="mt-4">${paymentPlanMarkup(project)}</div>${calculatorMarkup(project, firstPrice)}</section>
          <section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">${escapeHtml(offPlanText('locationArea'))}</h2><p class="mt-2 text-sm text-gray-600">${escapeHtml(projectLocation(project))}. ${escapeHtml(project.extra_fields?.map_precision === 'area_centroid' ? offPlanText('widerArea') : offPlanText('confirmTravel'))}</p><p class="mt-3 text-sm leading-6 text-gray-700">${escapeHtml(areaOverview)}</p><div class="mt-4">${mapMarkup(project)}</div><div class="mt-5"><h3 class="font-black text-gray-950">${escapeHtml(offPlanText('nearbyEssentials'))}</h3><p class="mt-1 text-xs text-gray-500">${escapeHtml(offPlanText('nearbyLive'))}</p><div id="off-plan-nearby-places" class="mt-3 grid sm:grid-cols-2 gap-3"></div></div></section>
          ${(project.videos || []).length ? `<section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">${escapeHtml(offPlanText('projectVideo'))}</h2><div class="mt-4 aspect-video rounded-2xl overflow-hidden bg-gray-950"><video controls preload="metadata" class="w-full h-full" src="${escapeHtml(project.videos[0].url)}"></video></div></section>` : ''}
          <section class="off-plan-risk-warning"><strong><i class="fas fa-triangle-exclamation mr-1"></i>${escapeHtml(offPlanText('disclaimerTitle'))}</strong><p class="mt-2">${escapeHtml(offPlanText('disclaimerBody'))}</p></section>
        </main>
        <aside class="off-plan-sticky-enquiry space-y-4"><div class="off-plan-panel shadow-[0_20px_60px_rgba(18,75,39,.12)]"><span class="text-xs text-gray-500">${escapeHtml(offPlanText('pricesFrom'))}</span><strong class="block text-2xl text-gray-950 mt-1">${escapeHtml(formatUgx(firstPrice))}</strong><p class="text-xs text-gray-500 mt-2">${escapeHtml(offPlanText('confirmPrice'))}</p><button type="button" onclick="openOffPlanContactModal('${escapeHtml(project.id)}','project_interest')" class="mt-5 w-full rounded-xl bg-green-700 hover:bg-green-600 text-white px-4 py-3 font-black"><i class="fab fa-whatsapp mr-2"></i>${escapeHtml(offPlanText('enquireThis', { name: sourceName }))}</button><a href="/api/off-plan/${encodeURIComponent(project.slug)}/brochure.pdf" class="mt-2 flex items-center justify-center gap-2 w-full rounded-xl border border-green-200 text-green-800 px-4 py-3 font-black" download><i class="fas fa-file-pdf"></i>${escapeHtml(offPlanText('downloadBrochure'))}</a></div><div class="off-plan-panel"><p class="text-xs font-black uppercase tracking-wide text-gray-500">${escapeHtml(offPlanText('shareProject'))}</p><div class="off-plan-share-row mt-3"><button onclick="shareOffPlan('native')" class="off-plan-share-button" aria-label="${escapeHtml(offPlanText('shareProject'))}"><i class="fas fa-share-nodes"></i><span>${escapeHtml(offPlanDynamicText('share'))}</span></button><button onclick="shareOffPlan('whatsapp')" class="off-plan-share-button is-whatsapp" aria-label="WhatsApp"><i class="fab fa-whatsapp"></i><span>WhatsApp</span></button><button onclick="shareOffPlan('x')" class="off-plan-share-button is-x" aria-label="Share on X"><span aria-hidden="true">𝕏</span></button></div></div></aside>
      </div>`;
  }

  function renderStoredNearbyPlaces(project) {
    const target = document.getElementById('off-plan-nearby-places');
    if (!target) return;
    const places = Array.isArray(project.nearby_places) ? project.nearby_places : [];
    target.innerHTML = places.length ? places.map((place) => `<article class="rounded-xl border border-gray-200 bg-gray-50 p-3"><span class="text-[10px] font-black uppercase tracking-wide text-red-600">${escapeHtml(place.category || offPlanText('nearbyEssentials'))}</span><strong class="block mt-1 text-sm text-gray-950">${escapeHtml(place.name)}</strong>${place.note ? `<p class="mt-1 text-xs leading-5 text-gray-500">${escapeHtml(offPlanLanguage() === 'en' ? place.note : offPlanText('confirmTravel'))}</p>` : ''}${place.source_url ? `<a class="mt-2 inline-block text-xs font-black text-green-800 underline" href="${escapeHtml(place.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(offPlanText('officialDetails'))}</a>` : ''}</article>`).join('') : `<p class="sm:col-span-2 text-sm text-gray-500">${escapeHtml(offPlanText('areaOverviewFallback'))}</p>`;
  }

  function renderLiveNearbyPlaces(results, project) {
    const target = document.getElementById('off-plan-nearby-places');
    if (!target || !Array.isArray(results) || !results.length) { renderStoredNearbyPlaces(project); return; }
    const unique = results.filter((place, index, rows) => rows.findIndex((item) => item.place_id === place.place_id) === index).slice(0, 8);
    target.innerHTML = unique.map((place) => {
      const category = place.types?.includes('school') ? 'School' : place.types?.includes('hospital') ? 'Healthcare' : offPlanText('nearbyEssentials');
      const mapsUrl = place.place_id ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.place_id)}&query=${encodeURIComponent(place.name || '')}` : googleMapsLink(project);
      return `<a class="rounded-xl border border-gray-200 bg-gray-50 p-3 hover:border-green-300" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer"><span class="text-[10px] font-black uppercase tracking-wide text-red-600">${escapeHtml(category)}</span><strong class="block mt-1 text-sm text-gray-950">${escapeHtml(place.name)}</strong><span class="block mt-1 text-xs text-gray-500">${escapeHtml(place.vicinity || offPlanText('confirmTravel'))}</span></a>`;
    }).join('');
  }

  async function renderOffPlanDetailMap(project) {
    const container = document.getElementById('off-plan-detail-map');
    const lat = number(project.latitude); const lng = number(project.longitude);
    if (!container || lat == null || lng == null) { renderStoredNearbyPlaces(project); return; }
    try {
      const ready = await ensureOffPlanGoogleMaps();
      if (!ready || !document.body.contains(container)) throw new Error('Google Maps unavailable');
      const position = { lat, lng };
      const map = new window.google.maps.Map(container, { center: position, zoom: project.extra_fields?.map_precision === 'area_centroid' ? 13 : 16, mapTypeControl: false, streetViewControl: false, scrollwheel: false });
      const marker = new window.google.maps.Marker({ map, position, title: project.name, icon: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' });
      const info = new window.google.maps.InfoWindow({ content: `<div class="off-plan-map-popup"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(projectLocation(project))}</span></div>` });
      marker.addListener('click', () => info.open({ map, anchor: marker }));
      state.detailMap = map;
      if (window.google.maps.places?.PlacesService) {
        const service = new window.google.maps.places.PlacesService(map);
        const queries = ['school', 'hospital'].map((type) => new Promise((resolve) => service.nearbySearch({ location: position, radius: 8000, type }, (places, status) => resolve(status === window.google.maps.places.PlacesServiceStatus.OK ? places : []))));
        const results = (await Promise.all(queries)).flat();
        renderLiveNearbyPlaces(results, project);
      } else renderStoredNearbyPlaces(project);
    } catch (_error) {
      container.innerHTML = `<div class="h-full grid place-items-center px-6 text-center text-sm text-gray-600"><span><i class="fas fa-map-location-dot text-3xl text-red-600 block mb-2"></i>${escapeHtml(offPlanText('mapUnavailable'))}</span></div>`;
      renderStoredNearbyPlaces(project);
    }
  }

  function mortgageProviderMarkup(provider) {
    const rate = number(provider.residentialRate ?? provider.residential_rate);
    const deposits = provider.minDepositPct || {};
    const years = provider.maxYears || {};
    const deposit = number(deposits.residential ?? provider.min_deposit_residential);
    const term = number(years.residential ?? provider.max_years_residential);
    return `<article class="rounded-2xl border border-gray-200 bg-gray-50 p-4"><strong class="block text-gray-950">${escapeHtml(provider.name || provider.provider_name)}</strong><dl class="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt class="text-gray-500">${escapeHtml(offPlanText('rate'))}</dt><dd class="mt-1 font-black text-gray-950">${rate == null ? escapeHtml(offPlanText('quoteRequired')) : `${rate}%`}</dd></div><div><dt class="text-gray-500">${escapeHtml(offPlanText('minDeposit'))}</dt><dd class="mt-1 font-black text-gray-950">${deposit == null ? escapeHtml(offPlanText('quoteRequired')) : `${deposit}%`}</dd></div><div><dt class="text-gray-500">${escapeHtml(offPlanText('term'))}</dt><dd class="mt-1 font-black text-gray-950">${term == null ? escapeHtml(offPlanText('quoteRequired')) : escapeHtml(offPlanText('years', { count: term }))}</dd></div></dl><p class="mt-3 text-[11px] leading-5 text-gray-500">${escapeHtml(provider.sourceNote || provider.source_note || offPlanText('quoteRequired'))}</p>${provider.sourceUrl || provider.source_url ? `<a class="mt-3 inline-flex items-center gap-1 text-xs font-black text-green-800 underline" href="${escapeHtml(provider.sourceUrl || provider.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(offPlanText('officialDetails'))}<i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}</article>`;
  }

  async function loadOffPlanMortgageProviders() {
    const target = document.getElementById('off-plan-mortgage-results');
    if (!target) return;
    target.innerHTML = `<p class="md:col-span-3 text-sm text-gray-500">${escapeHtml(offPlanText('loadingProjects'))}</p>`;
    try {
      if (!state.mortgageLoaded) {
        const payload = await request('/api/mortgage-rates');
        state.mortgageProviders = payload.data?.providers || payload.providers || [];
        state.mortgageLoaded = true;
      }
      const preferred = state.activeProject?.extra_fields?.mortgage_provider_keys || ['stanbic', 'dfcu', 'kcb'];
      const providers = state.mortgageProviders.filter((provider) => preferred.includes(provider.key || provider.provider_key));
      const selected = (providers.length ? providers : state.mortgageProviders).slice(0, 3);
      target.innerHTML = selected.length ? selected.map(mortgageProviderMarkup).join('') : `<p class="md:col-span-3 text-sm text-gray-500">${escapeHtml(offPlanText('quoteRequired'))}</p>`;
    } catch (error) { target.innerHTML = `<p class="md:col-span-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">${escapeHtml(error.message)}</p>`; }
  }

  function toggleOffPlanMortgage() {
    const panel = document.getElementById('off-plan-mortgage-panel');
    const button = document.getElementById('off-plan-mortgage-toggle');
    if (!panel) return;
    const open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    button?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) loadOffPlanMortgageProviders();
  }

  function changeOffPlanCalculatorCurrency(currency) {
    const code = clean(currency).toUpperCase() || 'UGX';
    const price = document.getElementById('off-plan-calc-price');
    const reservation = document.getElementById('off-plan-calc-reservation');
    const originalCurrency = clean(state.activeProject?.unit_types?.find((unit) => unit.price_original)?.price_original_currency || 'USD').toUpperCase();
    [price, reservation].forEach((input) => {
      if (!input) return;
      input.value = code === 'UGX' ? (input.dataset.ugxValue || '') : code === originalCurrency ? (input.dataset.originalValue || '') : '';
      input.placeholder = code === 'UGX' || code === originalCurrency ? '' : `${offPlanText('homePrice')} (${code})`;
    });
  }

  function hydrateOffPlanDetail(project) {
    renderOffPlanDetailMap(project);
  }

  async function openOffPlanDetail(slug, options = {}) {
    const list = document.getElementById('off-plan-list-view'); const detail = document.getElementById('off-plan-detail-view'); const content = document.getElementById('off-plan-detail-content');
    if (!detail || !content) return;
    if (list) list.classList.add('hidden'); detail.classList.remove('hidden');
    content.innerHTML = '<div class="off-plan-skeleton"></div>';
    if (options.history !== false) history.pushState({ page: 'off-plan', slug }, '', `/off-plan/${encodeURIComponent(slug)}`);
    try {
      const data = await request(`/api/off-plan/${encodeURIComponent(slug)}`);
      state.activeProject = data.development;
      track('off_plan_project_view', { slug: state.activeProject.slug, project_id: state.activeProject.id });
      content.innerHTML = detailMarkup(state.activeProject);
      hydrateOffPlanDetail(state.activeProject);
      document.title = `${state.activeProject.name} | Off Plan | makaug.com`;
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      content.innerHTML = `<div class="rounded-2xl bg-red-50 border border-red-100 p-6 text-red-900"><h1 class="font-black text-xl">Project not available</h1><p class="text-sm mt-2">${escapeHtml(error.message)}</p><button onclick="returnToOffPlanList()" class="mt-4 underline font-black">View off-plan projects</button></div>`;
    }
  }

  function returnToOffPlanList(options = {}) {
    document.getElementById('off-plan-list-view')?.classList.remove('hidden');
    document.getElementById('off-plan-detail-view')?.classList.add('hidden');
    state.activeProject = null;
    document.title = 'Off Plan Property in Uganda | makaug.com';
    if (options.history !== false) history.pushState({ page: 'off-plan' }, '', '/off-plan');
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (state.loaded) renderList();
    else if (!state.loading) loadProjects();
  }

  function selectOffPlanUnit(index) {
    const unit = state.activeProject?.unit_types?.[index];
    const input = document.getElementById('off-plan-calc-price');
    const currency = clean(document.getElementById('off-plan-calc-currency')?.value || 'UGX').toUpperCase();
    if (input && unit) {
      input.dataset.ugxValue = unit.price_ugx || '';
      input.dataset.originalValue = unit.price_original || '';
      input.value = currency === 'UGX' ? (unit.price_ugx || '') : currency === clean(unit.price_original_currency).toUpperCase() ? (unit.price_original || '') : '';
    }
    document.getElementById('off-plan-calc-price')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function calculateOffPlanPayments() {
    const result = document.getElementById('off-plan-calculator-result');
    if (!result) return;
    result.innerHTML = `<p class="text-sm text-gray-500">${escapeHtml(offPlanText('calculating'))}</p>`;
    try {
      const currency = clean(document.getElementById('off-plan-calc-currency')?.value || 'UGX').toUpperCase();
      const data = await request('/api/off-plan/calculate', { method: 'POST', body: { price: document.getElementById('off-plan-calc-price')?.value, deposit_percent: document.getElementById('off-plan-calc-deposit')?.value, reservationFee: document.getElementById('off-plan-calc-reservation')?.value, months: document.getElementById('off-plan-calc-months')?.value, currency } });
      const schedule = data.schedule;
      track('off_plan_payment_calculated', { project_id: state.activeProject?.id || null, months: schedule.months, currency: schedule.currency, price: schedule.price });
      result.innerHTML = `<div class="grid sm:grid-cols-3 gap-3"><div class="rounded-xl bg-white border border-green-100 p-3"><span class="text-xs text-gray-500">${escapeHtml(offPlanText('upfront'))}</span><strong class="block">${escapeHtml(formatMoney(schedule.upfront_amount, schedule.currency))}</strong></div><div class="rounded-xl bg-white border border-green-100 p-3"><span class="text-xs text-gray-500">${escapeHtml(offPlanText('monthlyFrom'))}</span><strong class="block">${escapeHtml(formatMoney(schedule.monthly_amount, schedule.currency))}</strong></div><div class="rounded-xl bg-white border border-green-100 p-3"><span class="text-xs text-gray-500">${escapeHtml(offPlanText('finalDate'))}</span><strong class="block">${escapeHtml(schedule.instalments.at(-1)?.due_date || '—')}</strong></div></div><details class="mt-3 rounded-xl bg-white border border-green-100 p-3"><summary class="cursor-pointer font-black text-sm">${escapeHtml(offPlanText('viewPayments', { count: schedule.months }))}</summary><div class="mt-3 max-h-64 overflow-auto divide-y">${schedule.instalments.map((item) => `<div class="py-2 flex justify-between gap-4 text-xs"><span>${escapeHtml(item.due_date)}</span><strong>${escapeHtml(formatMoney(item.amount, schedule.currency))}</strong></div>`).join('')}</div></details><p class="mt-3 text-xs text-gray-500">${escapeHtml(offPlanText('calcDisclaimer'))}</p>`;
    } catch (error) { result.innerHTML = `<p class="rounded-xl bg-red-50 p-3 text-sm text-red-900">${escapeHtml(error.message)}</p>`; }
  }

  function openOffPlanContactModal(developmentId = '', mode = 'listing_request') {
    state.contactDevelopmentId = developmentId || null; state.contactMode = mode || 'listing_request';
    const modal = document.getElementById('off-plan-contact-modal');
    const title = document.getElementById('off-plan-contact-title');
    if (title) title.textContent = state.contactMode === 'project_interest'
      ? offPlanText('enquireProject', { name: state.activeProject?.name || 'this project' })
      : offPlanText('listProject');
    document.getElementById('off-plan-listing-readiness')?.classList.toggle('hidden', state.contactMode !== 'listing_request');
    document.getElementById('off-plan-contact-details-wrap')?.classList.toggle('hidden', state.contactMode !== 'listing_request');
    document.getElementById('off-plan-contact-truth-wrap')?.classList.toggle('hidden', state.contactMode !== 'listing_request');
    document.getElementById('off-plan-contact-project-note')?.classList.toggle('hidden', state.contactMode !== 'project_interest');
    const truth = document.getElementById('off-plan-contact-truth');
    if (truth) { truth.required = state.contactMode === 'listing_request'; truth.checked = false; }
    const projectNote = document.getElementById('off-plan-contact-project-note');
    if (projectNote) projectNote.textContent = offPlanText('contactKaziNote', { name: clean(state.activeProject?.source_agent_name || state.activeProject?.source_display_name) || offPlanText('projectTeam') });
    if (modal) { modal.hidden = false; document.body.style.overflow = 'hidden'; }
    selectOffPlanContactChannel('whatsapp');
    track('off_plan_contact_opened', { mode: state.contactMode, development_id: state.contactDevelopmentId });
  }
  function closeOffPlanContactModal() { const modal = document.getElementById('off-plan-contact-modal'); if (modal) modal.hidden = true; document.body.style.overflow = ''; }
  function selectOffPlanContactChannel(channel) {
    const safe = ['whatsapp','email','call'].includes(channel) ? channel : 'whatsapp';
    const input = document.getElementById('off-plan-contact-channel'); if (input) input.value = safe;
    const phoneInput = document.getElementById('off-plan-contact-phone');
    const emailInput = document.getElementById('off-plan-contact-email');
    const callbackInput = document.getElementById('off-plan-contact-callback');
    if (phoneInput) phoneInput.required = safe === 'whatsapp' || safe === 'call';
    if (emailInput) emailInput.required = safe === 'email';
    if (callbackInput) callbackInput.required = safe === 'call';
    document.querySelectorAll('[data-off-plan-channel]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.offPlanChannel === safe ? 'true' : 'false'));
    document.getElementById('off-plan-callback-wrap')?.classList.toggle('hidden', safe !== 'call');
    const button = document.getElementById('off-plan-contact-submit'); if (button) button.textContent = safe === 'whatsapp' ? offPlanText('submitWhatsApp') : safe === 'email' ? offPlanText('submitEmail') : offPlanText('submitCall');
  }

  async function submitOffPlanContact(event) {
    event.preventDefault();
    const channel = clean(document.getElementById('off-plan-contact-channel')?.value);
    const status = document.getElementById('off-plan-contact-status'); const button = document.getElementById('off-plan-contact-submit');
    if (status) status.className = 'hidden'; if (button) button.disabled = true;
    try {
      const suppliedDetails = clean(document.getElementById('off-plan-contact-details')?.value);
      const data = await request('/api/off-plan/enquiries', { method: 'POST', body: { development_id: state.contactDevelopmentId, enquiry_type: state.contactMode, preferred_contact_channel: channel, name: clean(document.getElementById('off-plan-contact-name')?.value), phone: clean(document.getElementById('off-plan-contact-phone')?.value), email: clean(document.getElementById('off-plan-contact-email')?.value), requested_callback_at: channel === 'call' ? clean(document.getElementById('off-plan-contact-callback')?.value) : null, message: state.contactMode === 'project_interest' ? `I would like to enquire about ${state.activeProject?.name || 'this off-plan project'}.` : `I would like to enquire about listing a new off-plan project.${suppliedDetails ? ` Project details supplied: ${suppliedDetails}` : ''}`, source_path: location.pathname, metadata: { truth_confirmed: state.contactMode === 'listing_request' ? Boolean(document.getElementById('off-plan-contact-truth')?.checked) : null, supplied_project_details: suppliedDetails || null, project_contact_name: state.activeProject?.source_agent_name || null } } });
      if (status) { status.className = 'text-sm rounded-xl p-3 bg-green-50 text-green-900'; status.textContent = data.message; }
      if (channel === 'whatsapp' && data.whatsapp_url) window.open(data.whatsapp_url, '_blank', 'noopener,noreferrer');
      track('off_plan_enquiry_submitted', { channel, mode: state.contactMode, development_id: state.contactDevelopmentId });
      document.getElementById('off-plan-contact-form')?.reset(); selectOffPlanContactChannel(channel);
    } catch (error) { if (status) { status.className = 'text-sm rounded-xl p-3 bg-red-50 text-red-900'; status.textContent = error.message; } }
    finally { if (button) button.disabled = false; }
  }

  function shareOffPlan(channel) {
    const project = state.activeProject; if (!project) return;
    const url = `${location.origin}/off-plan/${project.slug}`; const text = `${project.name} — off-plan in ${projectLocation(project)} on makaug.com`;
    track('off_plan_project_shared', { channel, project_id: project.id });
    if (channel === 'native' && navigator.share) { navigator.share({ title: project.name, text, url }).catch(() => {}); return; }
    const target = channel === 'whatsapp' ? `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` : `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  }
  function openOffPlanGallery() {
    const dialog = document.getElementById('off-plan-gallery-dialog');
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
  }
  function closeOffPlanGallery() {
    const dialog = document.getElementById('off-plan-gallery-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    document.body.style.overflow = '';
  }

  function managementProjectCard(project, role) {
    const blockers = project.publication_blockers || [];
    return `<article class="off-plan-dashboard-card" data-off-plan-managed-id="${escapeHtml(project.id)}"><div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4"><div class="min-w-0"><div class="flex flex-wrap gap-2"><span class="off-plan-pill ${project.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}">${escapeHtml(project.status.replace(/_/g,' '))}</span><span class="off-plan-pill bg-gray-100 text-gray-700">${escapeHtml(project.verification_status.replace(/_/g,' '))}</span></div><h4 class="mt-2 text-lg font-black text-gray-950">${escapeHtml(project.name)}</h4><p class="text-xs text-gray-500 mt-1">${escapeHtml(projectLocation(project))} · source ${escapeHtml(project.source_display_name || 'not recorded')}</p></div><div class="flex flex-wrap gap-2"><button onclick="uploadOffPlanMedia('${escapeHtml(project.id)}','${role}','images')" class="rounded-lg border border-blue-200 text-blue-800 px-3 py-2 text-xs font-black"><i class="fas fa-images mr-1"></i>Images</button><button onclick="uploadOffPlanMedia('${escapeHtml(project.id)}','${role}','floor-plans')" class="rounded-lg border border-purple-200 text-purple-800 px-3 py-2 text-xs font-black"><i class="fas fa-ruler-combined mr-1"></i>Floor plan</button><button onclick="downloadOffPlanBrochure('${escapeHtml(project.id)}','${role}','${escapeHtml(project.slug)}')" class="rounded-lg border border-gray-200 px-3 py-2 text-xs font-black"><i class="fas fa-file-pdf mr-1"></i>Brochure</button><button onclick="createOffPlanWalkthroughBrief('${escapeHtml(project.id)}','${role}')" class="rounded-lg border border-purple-200 text-purple-800 px-3 py-2 text-xs font-black"><i class="fas fa-person-walking-arrow-right mr-1"></i>Walkthrough</button></div></div>
      <div class="grid md:grid-cols-4 gap-3 mt-4"><label class="text-xs font-bold">Completion %<input data-op-edit="construction_progress" value="${escapeHtml(project.construction_progress ?? '')}" type="number" min="0" max="100" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Units total<input data-op-edit="units_total" value="${escapeHtml(project.units_total ?? '')}" type="number" min="0" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Units sold<input data-op-edit="units_sold" value="${escapeHtml(project.units_sold ?? '')}" type="number" min="0" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Expected completion<input data-op-edit="completion_date" value="${escapeHtml((project.completion_date || '').slice(0,10))}" type="date" class="mt-1 w-full rounded-lg border px-3 py-2"></label></div>
      <details class="mt-4 rounded-xl border border-gray-200 p-4"><summary class="cursor-pointer text-sm font-black text-gray-900">Project facts and publication fields</summary>
        <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          <label class="text-xs font-bold">Developer<input data-op-edit="developer_name" value="${escapeHtml(project.developer_name || '')}" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Source agent UUID<input data-op-edit="source_agent_id" value="${escapeHtml(project.source_agent_id || '')}" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs"></label>
          <label class="text-xs font-bold">Source display name<input data-op-edit="source_display_name" value="${escapeHtml(project.source_display_name || '')}" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Area<input data-op-edit="area" value="${escapeHtml(project.area || '')}" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">District<input data-op-edit="district" value="${escapeHtml(project.district || '')}" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Address<input data-op-edit="address" value="${escapeHtml(project.address || '')}" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Latitude<input data-op-edit="latitude" value="${escapeHtml(project.latitude ?? '')}" type="number" step="0.0000001" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Longitude<input data-op-edit="longitude" value="${escapeHtml(project.longitude ?? '')}" type="number" step="0.0000001" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Launch price UGX<input data-op-edit="launch_price_ugx" value="${escapeHtml(project.launch_price_ugx ?? '')}" type="number" min="0" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Original currency<input data-op-edit="original_currency" value="${escapeHtml(project.original_currency || 'USD')}" maxlength="3" class="mt-1 w-full rounded-lg border px-3 py-2 uppercase"></label>
          <label class="text-xs font-bold">Discount %<input data-op-edit="discount_percentage" value="${escapeHtml(project.discount_percentage ?? '')}" type="number" min="0" max="100" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Reservation fee UGX<input data-op-edit="reservation_fee_ugx" value="${escapeHtml(project.reservation_fee_ugx ?? '')}" type="number" min="0" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Payment months<input data-op-edit="payment_plan_months" value="${escapeHtml(project.payment_plan_months ?? '')}" type="number" min="1" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Promotion video URL<input data-op-video value="${escapeHtml(project.videos?.[0]?.url || '')}" type="url" class="mt-1 w-full rounded-lg border px-3 py-2"></label>
          <label class="text-xs font-bold">Verification<select data-op-edit="verification_status" class="mt-1 w-full rounded-lg border px-3 py-2"><option value="needs_verification" ${project.verification_status === 'needs_verification' ? 'selected' : ''}>Needs verification</option><option value="partially_verified" ${project.verification_status === 'partially_verified' ? 'selected' : ''}>Partially verified</option><option value="verified" ${project.verification_status === 'verified' ? 'selected' : ''}>Verified by staff</option></select></label>
        </div>
        <label class="block mt-3 text-xs font-bold">Description<textarea data-op-edit="description" rows="4" class="mt-1 w-full rounded-lg border px-3 py-2">${escapeHtml(project.description || '')}</textarea></label>
        <div class="grid lg:grid-cols-2 gap-3 mt-3">
          <label class="text-xs font-bold">Unit types (JSON)<textarea data-op-json="unit_types" rows="7" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]">${escapeHtml(JSON.stringify(project.unit_types || [], null, 2))}</textarea></label>
          <label class="text-xs font-bold">Payment plan (JSON)<textarea data-op-json="payment_plan" rows="7" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]">${escapeHtml(JSON.stringify(project.payment_plan || [], null, 2))}</textarea></label>
          <label class="text-xs font-bold">Nearby places (JSON)<textarea data-op-json="nearby_places" rows="7" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]">${escapeHtml(JSON.stringify(project.nearby_places || [], null, 2))}</textarea></label>
          <label class="text-xs font-bold">Amenities (JSON)<textarea data-op-json="amenities" rows="7" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]">${escapeHtml(JSON.stringify(project.amenities || [], null, 2))}</textarea></label>
          <label class="text-xs font-bold">Brochure settings (JSON)<textarea data-op-json="brochure_settings" data-op-json-default="object" rows="7" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]">${escapeHtml(JSON.stringify(project.brochure_settings || {}, null, 2))}</textarea></label>
          <label class="text-xs font-bold">Extra fields and area notes (JSON)<textarea data-op-json="extra_fields" data-op-json-default="object" rows="7" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]">${escapeHtml(JSON.stringify(project.extra_fields || {}, null, 2))}</textarea></label>
        </div>
      </details>
      <div class="mt-4 flex flex-col md:flex-row md:items-center justify-between gap-3"><div class="text-xs ${blockers.length ? 'text-amber-900' : 'text-green-800'}"><strong>${blockers.length ? `${blockers.length} publication check${blockers.length === 1 ? '' : 's'} remaining` : 'Ready for explicit publication approval'}</strong>${blockers.length ? `<details class="mt-1"><summary class="cursor-pointer">View checks</summary><ul class="list-disc pl-5 mt-1">${blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''}</div><div class="flex flex-wrap gap-2"><button onclick="setOffPlanProjectStatus('${escapeHtml(project.id)}','${role}','changes_requested')" class="rounded-lg border border-amber-200 text-amber-800 px-4 py-2 text-xs font-black">Request changes</button>${!blockers.length && project.status !== 'published' ? `<button onclick="setOffPlanProjectStatus('${escapeHtml(project.id)}','${role}','published')" class="rounded-lg bg-green-700 text-white px-4 py-2 text-xs font-black">Publish verified project</button>` : ''}<button onclick="saveOffPlanProgress('${escapeHtml(project.id)}','${role}')" class="rounded-lg bg-slate-900 text-white px-4 py-2 text-xs font-black">Save project</button></div></div></article>`;
  }

  async function loadOffPlanManagement(role = 'staff') {
    const container = document.getElementById(`${role}-off-plan-projects`); if (!container) return;
    const enquiryContainer = document.getElementById(`${role}-off-plan-enquiries`);
    container.innerHTML = '<p class="text-sm text-gray-500">Loading off-plan projects...</p>';
    try {
      const base = `/api/${role === 'admin' ? 'admin' : 'staff'}/off-plan`;
      const headers = managementHeaders(role);
      const [data, enquiryData] = await Promise.all([request(`${base}/developments`, { headers }), request(`${base}/enquiries`, { headers })]);
      container.innerHTML = data.developments?.length ? data.developments.map((project) => managementProjectCard(project, role)).join('') : '<p class="text-sm text-gray-500">No off-plan projects are in the review queue.</p>';
      if (enquiryContainer) enquiryContainer.innerHTML = enquiryData.enquiries?.length ? enquiryData.enquiries.map((enquiry) => `<div class="rounded-xl border border-gray-200 p-3"><strong class="text-gray-950">${escapeHtml(enquiry.name)}</strong><span class="ml-2 off-plan-pill bg-gray-100 text-gray-700">${escapeHtml(enquiry.preferred_contact_channel)}</span><p class="mt-1 text-xs">${escapeHtml(enquiry.development_name || enquiry.enquiry_type.replace(/_/g,' '))} · ${escapeHtml(enquiry.phone || enquiry.email || 'contact not supplied')}</p><p class="mt-1 text-xs text-gray-500">${escapeHtml(enquiry.message || '')}</p></div>`).join('') : 'No new off-plan enquiries.';
      state.managementLoaded[role] = true;
    } catch (error) { container.innerHTML = `<p class="text-sm text-red-700">${escapeHtml(error.message)}</p>`; }
  }

  async function saveOffPlanProgress(id, role) {
    const card = document.querySelector(`[data-off-plan-managed-id="${CSS.escape(id)}"]`); if (!card) return;
    const body = {}; card.querySelectorAll('[data-op-edit]').forEach((input) => { body[input.dataset.opEdit] = input.value === '' ? null : input.value; });
    try { card.querySelectorAll('[data-op-json]').forEach((input) => { body[input.dataset.opJson] = JSON.parse(input.value || (input.dataset.opJsonDefault === 'object' ? '{}' : '[]')); }); }
    catch (_error) { alert('Project JSON fields must contain valid JSON.'); return; }
    const videoUrl = clean(card.querySelector('[data-op-video]')?.value); body.videos = videoUrl ? [{ url: videoUrl, kind: 'promotion_video' }] : [];
    try { await request(`/api/${role === 'admin' ? 'admin' : 'staff'}/off-plan/developments/${encodeURIComponent(id)}`, { method: 'PATCH', headers: managementHeaders(role), body }); await loadOffPlanManagement(role); }
    catch (error) { alert(error.message); }
  }

  async function setOffPlanProjectStatus(id, role, status) {
    if (status === 'published' && !confirm('Publish this verified project to the public Off Plan page now?')) return;
    try { await request(`/api/${role === 'admin' ? 'admin' : 'staff'}/off-plan/developments/${encodeURIComponent(id)}/status`, { method: 'POST', headers: managementHeaders(role), body: { status } }); await loadOffPlanManagement(role); }
    catch (error) { alert(error.payload?.blockers?.join('\n') || error.message); }
  }

  async function createOffPlanWalkthroughBrief(id, role, suppliedFloorPlanUrl = '') {
    const floorPlanUrl = suppliedFloorPlanUrl || prompt('Paste the reviewed floor-plan URL. No video is generated or published until staff approval.');
    if (!floorPlanUrl) return;
    try { await request(`/api/${role === 'admin' ? 'admin' : 'staff'}/off-plan/developments/${encodeURIComponent(id)}/walkthroughs`, { method: 'POST', headers: managementHeaders(role), body: { floor_plan_url: floorPlanUrl } }); alert('Walkthrough brief created for staff review. No public video has been generated.'); }
    catch (error) { alert(error.message); }
  }

  function dataUrlForFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('File could not be read'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadOffPlanMedia(id, role, kind) {
    const isFloorPlan = kind === 'floor-plans';
    if (!confirm(`I confirm makaug has permission to use the selected ${isFloorPlan ? 'floor plan' : 'project images'} for this project.`)) return;
    const input = document.createElement('input'); input.type = 'file'; input.multiple = !isFloorPlan; input.accept = isFloorPlan ? 'image/jpeg,image/png,image/webp,application/pdf' : 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      const files = Array.from(input.files || []).slice(0, 20); if (!files.length) return;
      try {
        const media = await Promise.all(files.map(async (file) => ({ url: await dataUrlForFile(file), filename: file.name, caption: file.name, kind: isFloorPlan ? 'floor_plan' : 'project_photo' })));
        const field = isFloorPlan ? 'floor_plans' : 'images';
        const data = await request(`/api/${role === 'admin' ? 'admin' : 'staff'}/off-plan/developments/${encodeURIComponent(id)}/${kind}`, { method: 'POST', headers: managementHeaders(role), body: { confirm_rights: true, [field]: media } });
        await loadOffPlanManagement(role);
        if (isFloorPlan && data.floor_plans?.[0]?.url && confirm('Floor plan uploaded. Create a concept walkthrough brief now?')) await createOffPlanWalkthroughBrief(id, role, data.floor_plans[0].url);
      } catch (error) { alert(error.message); }
    };
    input.click();
  }

  async function downloadOffPlanBrochure(id, role, slug = 'off-plan-project') {
    try {
      const path = `/api/${role === 'admin' ? 'admin' : 'staff'}/off-plan/developments/${encodeURIComponent(id)}/brochure.pdf`;
      const response = await fetch(path, { credentials: 'same-origin', headers: managementHeaders(role) });
      if (!response.ok) throw new Error(`Brochure preview failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${slug}-makaug-review-brochure.pdf`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) { alert(error.message); }
  }

  function openOffPlanCreateModal(role = 'staff') {
    const modal = document.getElementById('off-plan-create-modal');
    const roleInput = document.getElementById('off-plan-create-role');
    if (roleInput) roleInput.value = role === 'admin' ? 'admin' : 'staff';
    if (modal) { modal.hidden = false; modal.closest('.page')?.style.setProperty('display', 'block'); document.body.style.overflow = 'hidden'; }
  }

  function closeOffPlanCreateModal() {
    const modal = document.getElementById('off-plan-create-modal');
    if (modal) { modal.hidden = true; modal.closest('.page')?.style.removeProperty('display'); }
    document.body.style.overflow = '';
  }

  async function submitOffPlanProject(event) {
    event.preventDefault();
    const role = document.getElementById('off-plan-create-role')?.value === 'admin' ? 'admin' : 'staff';
    const status = document.getElementById('off-plan-create-status');
    try {
      const data = await request(`/api/${role === 'admin' ? 'admin' : 'staff'}/off-plan/developments`, { method: 'POST', headers: managementHeaders(role), body: { name: clean(document.getElementById('off-plan-create-name')?.value), area: clean(document.getElementById('off-plan-create-area')?.value), district: clean(document.getElementById('off-plan-create-district')?.value), source_display_name: clean(document.getElementById('off-plan-create-source')?.value), source_agent_id: clean(document.getElementById('off-plan-create-source-id')?.value) || null, project_type: clean(document.getElementById('off-plan-create-type')?.value) || 'development', completion_date: clean(document.getElementById('off-plan-create-completion')?.value) || null, latitude: clean(document.getElementById('off-plan-create-latitude')?.value) || null, longitude: clean(document.getElementById('off-plan-create-longitude')?.value) || null, description: clean(document.getElementById('off-plan-create-description')?.value), status: 'pending_review', verification_status: 'needs_verification' } });
      if (status) { status.className = 'rounded-xl p-3 text-sm bg-green-50 text-green-900'; status.textContent = `${data.development.name} was created in private staff review.`; }
      event.target.reset();
      await loadOffPlanManagement(role);
    } catch (error) { if (status) { status.className = 'rounded-xl p-3 text-sm bg-red-50 text-red-900'; status.textContent = error.message; } }
  }

  function initializeOffPlanPage() {
    track('off_plan_page_view', { path: location.pathname });
    applyOffPlanLanguageUI();
    wireOffPlanDirectoryControls();
    prepopulateOffPlanSearch();
    loadLocations();
    const match = location.pathname.match(/^\/off-plan\/([a-z0-9-]+)\/?$/i);
    if (match) openOffPlanDetail(match[1], { history: false });
    else returnToOffPlanList({ history: false });
  }

  Object.assign(window, { applyOffPlanLanguageUI, calculateOffPlanPayments, changeOffPlanCalculatorCurrency, clearOffPlanFilters, closeOffPlanContactModal, closeOffPlanCreateModal, closeOffPlanGallery, createOffPlanWalkthroughBrief, downloadOffPlanBrochure, initializeOffPlanPage, loadOffPlanManagement, openOffPlanContactModal, openOffPlanCreateModal, openOffPlanDetail, openOffPlanFromHero, openOffPlanGallery, returnToOffPlanList, saveOffPlanProgress, searchOffPlan, selectOffPlanContactChannel, selectOffPlanUnit, setOffPlanProjectStatus, shareOffPlan, submitOffPlanContact, submitOffPlanProject, toggleOffPlanAi, toggleOffPlanFilters, toggleOffPlanMap, toggleOffPlanMortgage, uploadOffPlanMedia });
  if (/^\/off-plan(?:\/|$)/i.test(location.pathname)) initializeOffPlanPage();
  if (document.getElementById('page-staff-dashboard')?.classList.contains('active')) loadOffPlanManagement('staff');
  if (document.getElementById('page-admin-dashboard')?.classList.contains('active')) loadOffPlanManagement('admin');
})();
