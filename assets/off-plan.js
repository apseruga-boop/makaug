(function initializeOffPlanFeature() {
  'use strict';

  const state = {
    loaded: false,
    loading: false,
    projects: [],
    activeProject: null,
    contactMode: 'listing_request',
    contactDevelopmentId: null,
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

  function offPlanLanguage() {
    const code = clean(document.documentElement.lang || 'en').toLowerCase().split('-')[0];
    return OFF_PLAN_I18N[code] ? code : 'en';
  }

  function offPlanText(key, replacements = {}) {
    const pack = OFF_PLAN_I18N[offPlanLanguage()] || OFF_PLAN_I18N.en;
    let value = pack[key] || OFF_PLAN_I18N.en[key] || key;
    Object.entries(replacements).forEach(([name, replacement]) => { value = value.replaceAll(`{${name}}`, String(replacement)); });
    return value;
  }

  function refreshOffPlanContactCopy() {
    const title = document.getElementById('off-plan-contact-title');
    if (title) title.textContent = state.contactMode === 'project_interest'
      ? offPlanText('enquireProject', { name: state.activeProject?.name || OFF_PLAN_I18N.en.listProject })
      : offPlanText('listProject');
    const selectedChannel = clean(document.getElementById('off-plan-contact-channel')?.value) || 'whatsapp';
    selectOffPlanContactChannel(selectedChannel);
  }

  function applyOffPlanLanguageUI() {
    const root = document.getElementById('page-off-plan');
    if (!root) return;
    root.querySelectorAll('[data-off-plan-i18n]').forEach((element) => { element.textContent = offPlanText(element.dataset.offPlanI18n); });
    root.querySelectorAll('[data-off-plan-i18n-placeholder]').forEach((element) => { element.setAttribute('placeholder', offPlanText(element.dataset.offPlanI18nPlaceholder)); });
    root.querySelectorAll('[data-off-plan-i18n-aria]').forEach((element) => { element.setAttribute('aria-label', offPlanText(element.dataset.offPlanI18nAria)); });
    if (state.loaded && !state.activeProject) renderList();
    refreshOffPlanContactCopy();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  function formatUgx(value) {
    const amount = number(value);
    return amount == null ? 'Price on request' : `USh ${Math.round(amount).toLocaleString('en-UG')}`;
  }
  function formatDate(value) {
    if (!value) return 'To be confirmed';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString('en-UG', { month: 'short', year: 'numeric' });
  }
  function projectLocation(project) { return [project.area, project.district].filter(Boolean).join(', ') || 'Uganda'; }
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
    return `<div><div class="flex items-center justify-between gap-3 text-xs"><span class="font-bold text-gray-700">${escapeHtml(label)}</span><span class="font-black text-green-800">${known ? `${width}%` : 'To verify'}</span></div><div class="off-plan-meter mt-2"><span style="width:${width}%"></span></div></div>`;
  }

  function projectCard(project) {
    const unitPrices = (project.unit_types || []).map((unit) => number(unit.price_ugx)).filter((value) => value != null && value > 0);
    const launch = number(project.launch_price_ugx) || (unitPrices.length ? Math.min(...unitPrices) : null);
    const availability = project.units_available == null ? 'Availability confirmed on enquiry' : `${project.units_available} home${project.units_available === 1 ? '' : 's'} available`;
    return `<article class="off-plan-card cursor-pointer" onclick="openOffPlanDetail('${escapeHtml(project.slug)}')" tabindex="0" onkeydown="if(event.key==='Enter')openOffPlanDetail('${escapeHtml(project.slug)}')">
      <div class="off-plan-card-image"><img src="${escapeHtml(imageUrl(project))}" alt="${escapeHtml(imageCaption(project))}" loading="lazy"><span class="off-plan-pill absolute top-3 left-3 bg-white/95 text-green-800"><i class="fas fa-check-circle"></i>Staff verified</span><span class="off-plan-pill absolute bottom-3 left-3 bg-black/70 text-white"><i class="fas fa-calendar"></i>${escapeHtml(formatDate(project.completion_date))}</span></div>
      <div class="p-5"><p class="text-xs font-black uppercase tracking-wide text-green-700">${escapeHtml(project.project_type || 'New development')}</p><h3 class="mt-1 text-xl font-black text-gray-950">${escapeHtml(project.name)}</h3><p class="mt-1 text-sm text-gray-500"><i class="fas fa-location-dot mr-1"></i>${escapeHtml(projectLocation(project))}</p>
        <div class="grid grid-cols-2 gap-4 mt-5">${progressMarkup('Construction', project.construction_progress)}${progressMarkup('Homes sold', project.sales_progress)}</div>
        <div class="mt-5 pt-4 border-t border-gray-100 flex items-end justify-between gap-3"><div><span class="text-xs text-gray-500">From</span><strong class="block text-lg text-gray-950">${escapeHtml(formatUgx(launch))}</strong></div><span class="text-xs font-bold text-green-800 text-right">${escapeHtml(availability)}</span></div>
      </div>
    </article>`;
  }

  function renderList() {
    const grid = document.getElementById('off-plan-results');
    const summary = document.getElementById('off-plan-result-summary');
    if (!grid) return;
    if (!state.projects.length) {
      grid.innerHTML = `<div class="md:col-span-2 rounded-3xl border border-green-100 bg-white p-8 md:p-12 text-center"><div class="mx-auto h-14 w-14 rounded-2xl bg-green-50 text-green-700 grid place-items-center text-xl"><i class="fas fa-building-circle-check"></i></div><h3 class="mt-4 text-xl font-black text-gray-950">${escapeHtml(offPlanText('noProjectsTitle'))}</h3><p class="mt-2 text-sm text-gray-600 max-w-xl mx-auto">${escapeHtml(offPlanText('noProjectsBody'))}</p><button onclick="openOffPlanContactModal()" class="mt-5 rounded-xl bg-green-700 text-white px-5 py-3 font-black">${escapeHtml(offPlanText('listProject'))}</button></div>`;
      if (summary) summary.textContent = offPlanText('noProjectsSummary');
      return;
    }
    grid.innerHTML = state.projects.map(projectCard).join('');
    if (summary) summary.textContent = offPlanText('projectsFound', { count: state.projects.length });
  }

  async function loadLocations() {
    const select = document.getElementById('off-plan-location');
    if (!select || select.dataset.loaded === '1') return;
    try {
      const data = await request('/api/off-plan/locations');
      const seen = new Set();
      (data.locations || []).forEach((item) => {
        const value = clean(item.area || item.district);
        if (!value || seen.has(value.toLowerCase())) return;
        seen.add(value.toLowerCase());
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${value} (${item.project_count})`;
        select.appendChild(option);
      });
      select.dataset.loaded = '1';
    } catch (_error) {}
  }

  async function loadProjects() {
    if (state.loading) return;
    state.loading = true;
    const grid = document.getElementById('off-plan-results');
    if (grid) grid.innerHTML = '<div class="off-plan-skeleton"></div><div class="off-plan-skeleton"></div>';
    const params = new URLSearchParams();
    const q = clean(document.getElementById('off-plan-q')?.value);
    const location = clean(document.getElementById('off-plan-location')?.value);
    const bedrooms = clean(document.getElementById('off-plan-bedrooms')?.value);
    const maxPrice = clean(document.getElementById('off-plan-max-price')?.value);
    if (q) params.set('q', q);
    if (location) params.set('q', [q, location].filter(Boolean).join(' '));
    if (bedrooms) params.set('bedrooms', bedrooms);
    if (maxPrice) params.set('max_price_ugx', maxPrice);
    try {
      const data = await request(`/api/off-plan?${params.toString()}`);
      state.projects = data.developments || [];
      state.loaded = true;
      renderList();
    } catch (error) {
      if (grid) grid.innerHTML = `<div class="md:col-span-2 rounded-2xl border border-red-100 bg-red-50 p-6 text-red-900"><strong>Projects could not be loaded.</strong><p class="text-sm mt-1">${escapeHtml(error.message)} Please try again.</p></div>`;
    } finally { state.loading = false; }
  }

  function searchOffPlan(event) {
    if (event) event.preventDefault();
    track('off_plan_search', { query: clean(document.getElementById('off-plan-q')?.value), location: clean(document.getElementById('off-plan-location')?.value), bedrooms: clean(document.getElementById('off-plan-bedrooms')?.value) });
    loadProjects();
    return false;
  }
  function openOffPlanFromHero() { if (typeof window.showPage === 'function') window.showPage('off-plan'); else window.location.href = '/off-plan'; }

  function galleryMarkup(project) {
    const images = (project.images || []).slice(0, 3);
    if (!images.length) return '<div class="rounded-3xl bg-gray-100 h-[360px]"></div>';
    while (images.length < 3) images.push(images[0]);
    return `<div class="off-plan-gallery">${images.map((image, index) => `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.caption || project.name)}"><figcaption>${escapeHtml(image.caption || 'Project image')}</figcaption>${index === 2 && project.images.length > 3 ? `<button type="button" onclick="openOffPlanGallery()" class="absolute right-3 top-3 rounded-lg bg-white/95 text-gray-950 px-3 py-2 text-xs font-black"><i class="fas fa-images mr-1"></i>All ${project.images.length} photos</button>` : ''}</figure>`).join('')}</div>`;
  }

  function unitTable(project) {
    if (!(project.unit_types || []).length) return '<p class="text-sm text-gray-500">Unit details are being verified.</p>';
    return `<div class="overflow-x-auto"><table class="off-plan-unit-table"><thead><tr><th>Home type</th><th>Bedrooms</th><th>Size</th><th>Price</th><th></th></tr></thead><tbody>${project.unit_types.map((unit, index) => `<tr><td class="font-black text-gray-950">${escapeHtml(unit.label || unit.property_type || 'Home')}</td><td>${escapeHtml(unit.bedrooms ?? '—')}</td><td>${unit.size_sqm ? `${escapeHtml(unit.size_sqm)} m²` : 'To verify'}</td><td class="font-black">${escapeHtml(formatUgx(unit.price_ugx))}</td><td><button type="button" onclick="selectOffPlanUnit(${index})" class="rounded-lg border border-green-200 text-green-800 px-3 py-2 text-xs font-black">Calculate</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function paymentPlanMarkup(project) {
    if (!(project.payment_plan || []).length) return '<p class="text-sm text-gray-500">The payment milestones are being verified.</p>';
    return `<div class="off-plan-payment-grid grid gap-3">${project.payment_plan.map((item, index) => `<div class="rounded-2xl ${index === 0 ? 'bg-green-800 text-white' : 'bg-green-50 text-green-950'} p-4"><span class="text-xs font-black uppercase tracking-wide opacity-70">Step ${index + 1}</span><strong class="block mt-1">${escapeHtml(item.label || 'Payment milestone')}</strong><span class="block text-sm mt-1">${item.percent != null ? `${escapeHtml(item.percent)}%` : item.amount_ugx ? formatUgx(item.amount_ugx) : item.months ? `${escapeHtml(item.months)} monthly instalments` : escapeHtml(item.due || 'Terms to verify')}</span></div>`).join('')}</div>`;
  }

  function mapMarkup(project) {
    const lat = number(project.latitude); const lon = number(project.longitude);
    if (lat == null || lon == null) return '<div class="off-plan-map grid place-items-center text-center px-6"><div><i class="fas fa-map-location-dot text-3xl text-green-700"></i><strong class="block mt-3 text-gray-950">Exact map location available after verification</strong><p class="text-sm text-gray-500 mt-1">The project area is shown only after staff confirm the pin.</p></div></div>';
    const delta = .012;
    const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(',');
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
    return `<iframe class="off-plan-map" loading="lazy" title="Map of ${escapeHtml(project.name)}" src="${src}"></iframe>`;
  }

  function detailMarkup(project) {
    const units = project.unit_types || [];
    const firstPrice = units.map((unit) => number(unit.price_ugx)).find((value) => value && value > 0) || project.launch_price_ugx || '';
    return `${galleryMarkup(project)}
      <div class="mt-7 grid lg:grid-cols-[minmax(0,1fr)_330px] gap-8 items-start">
        <main class="space-y-6">
          <div><div class="flex flex-wrap gap-2"><span class="off-plan-pill bg-green-100 text-green-800"><i class="fas fa-check-circle"></i>Staff verified</span><span class="off-plan-pill bg-amber-100 text-amber-900">${escapeHtml(project.project_type || 'Off plan')}</span></div><h1 class="mt-3 text-3xl md:text-5xl font-black text-gray-950 leading-tight">${escapeHtml(project.name)}</h1><p class="mt-2 text-gray-500"><i class="fas fa-location-dot mr-1"></i>${escapeHtml(projectLocation(project))}${project.developer_name ? ` · by ${escapeHtml(project.developer_name)}` : ''}</p></div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><div class="off-plan-stat"><span class="text-xs text-gray-500">Expected completion</span><strong class="block mt-1">${escapeHtml(formatDate(project.completion_date))}</strong></div><div class="off-plan-stat"><span class="text-xs text-gray-500">Construction</span><strong class="block mt-1">${project.construction_progress}% complete</strong></div><div class="off-plan-stat"><span class="text-xs text-gray-500">Homes sold</span><strong class="block mt-1">${project.units_sold} of ${project.units_total}</strong></div><div class="off-plan-stat"><span class="text-xs text-gray-500">Homes remaining</span><strong class="block mt-1">${project.units_available}</strong></div></div>
          <section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">About the development</h2><p class="mt-3 text-sm md:text-base text-gray-700 leading-7 whitespace-pre-line">${escapeHtml(project.description)}</p></section>
          <section class="off-plan-panel"><div class="flex items-end justify-between gap-3"><div><p class="text-xs font-black uppercase tracking-wide text-green-700">Choose a home</p><h2 class="mt-1 text-xl font-black text-gray-950">Unit types and prices</h2></div><span class="text-xs text-gray-500">Prices in UGX</span></div><div class="mt-4">${unitTable(project)}</div></section>
          <section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">Project progress</h2><div class="grid sm:grid-cols-2 gap-6 mt-5">${progressMarkup('Construction completed', project.construction_progress)}${progressMarkup('Homes sold', project.sales_progress)}</div></section>
          <section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">Payment plan</h2><div class="mt-4">${paymentPlanMarkup(project)}</div><div class="mt-6 rounded-2xl border border-green-100 bg-[#f4faf5] p-5"><h3 class="font-black text-gray-950">Build your illustrative schedule</h3><div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4"><label class="text-xs font-bold text-gray-700">Home price (UGX)<input id="off-plan-calc-price" type="number" min="0" value="${escapeHtml(firstPrice)}" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm"></label><label class="text-xs font-bold text-gray-700">Upfront deposit %<input id="off-plan-calc-deposit" type="number" min="0" max="100" value="${escapeHtml(project.payment_plan?.find((item) => item.percent)?.percent || 0)}" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm"></label><label class="text-xs font-bold text-gray-700">Reservation fee (UGX)<input id="off-plan-calc-reservation" type="number" min="0" value="${escapeHtml(project.reservation_fee_ugx || 0)}" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm"></label><label class="text-xs font-bold text-gray-700">Payment months<input id="off-plan-calc-months" type="number" min="1" max="120" value="${escapeHtml(project.payment_plan_months || 12)}" class="mt-1 w-full h-11 rounded-xl border border-gray-300 px-3 text-sm"></label></div><button type="button" onclick="calculateOffPlanPayments()" class="mt-4 rounded-xl bg-green-700 text-white px-5 py-3 font-black">Calculate payment dates</button><div id="off-plan-calculator-result" class="mt-4"></div></div><a href="/mortgage" onclick="showPage('mortgage')" class="inline-flex items-center gap-2 mt-5 text-sm font-black text-green-800 hover:text-green-600"><i class="fas fa-house-circle-check"></i>Compare with the mortgage calculator <i class="fas fa-arrow-right"></i></a></section>
          <section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">Location and area</h2><p class="mt-2 text-sm text-gray-600">${escapeHtml(projectLocation(project))}. Confirm travel times and the exact site before making a commitment.</p><div class="mt-4">${mapMarkup(project)}</div></section>
          ${(project.videos || []).length ? `<section class="off-plan-panel"><h2 class="text-xl font-black text-gray-950">Project video</h2><div class="mt-4 aspect-video rounded-2xl overflow-hidden bg-gray-950"><video controls preload="metadata" class="w-full h-full" src="${escapeHtml(project.videos[0].url)}"></video></div></section>` : ''}
          <section class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><strong><i class="fas fa-triangle-exclamation mr-1"></i>Off-plan information can change.</strong><p class="mt-1">Verify approvals, title, developer identity, the sale agreement, payment destination, specifications, dates and current availability. Artist impressions may differ from the finished project. Consider independent legal and financial advice.</p></section>
        </main>
        <aside class="off-plan-sticky-enquiry space-y-4"><div class="off-plan-panel shadow-[0_20px_60px_rgba(18,75,39,.12)]"><span class="text-xs text-gray-500">Prices from</span><strong class="block text-2xl text-gray-950 mt-1">${escapeHtml(formatUgx(firstPrice))}</strong><p class="text-xs text-gray-500 mt-2">Confirm the current price and availability before payment.</p><button type="button" onclick="openOffPlanContactModal('${escapeHtml(project.id)}','project_interest')" class="mt-5 w-full rounded-xl bg-green-700 hover:bg-green-600 text-white px-4 py-3 font-black"><i class="fab fa-whatsapp mr-2"></i>Enquire about this project</button><a href="/api/off-plan/${encodeURIComponent(project.slug)}/brochure.pdf" class="mt-2 flex items-center justify-center gap-2 w-full rounded-xl border border-green-200 text-green-800 px-4 py-3 font-black" download><i class="fas fa-file-pdf"></i>Download brochure</a></div><div class="off-plan-panel"><p class="text-xs font-black uppercase tracking-wide text-gray-500">Share this project</p><div class="grid grid-cols-3 gap-2 mt-3"><button onclick="shareOffPlan('native')" class="h-11 rounded-xl bg-gray-100" aria-label="Share"><i class="fas fa-share-nodes"></i></button><button onclick="shareOffPlan('whatsapp')" class="h-11 rounded-xl bg-green-50 text-green-700" aria-label="Share on WhatsApp"><i class="fab fa-whatsapp"></i></button><button onclick="shareOffPlan('x')" class="h-11 rounded-xl bg-gray-950 text-white" aria-label="Share on X">𝕏</button></div></div></aside>
      </div>`;
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
  }

  function selectOffPlanUnit(index) {
    const unit = state.activeProject?.unit_types?.[index];
    const input = document.getElementById('off-plan-calc-price');
    if (input && unit?.price_ugx) input.value = unit.price_ugx;
    document.getElementById('off-plan-calc-price')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function calculateOffPlanPayments() {
    const result = document.getElementById('off-plan-calculator-result');
    if (!result) return;
    result.innerHTML = '<p class="text-sm text-gray-500">Calculating...</p>';
    try {
      const data = await request('/api/off-plan/calculate', { method: 'POST', body: { price_ugx: document.getElementById('off-plan-calc-price')?.value, deposit_percent: document.getElementById('off-plan-calc-deposit')?.value, reservation_fee_ugx: document.getElementById('off-plan-calc-reservation')?.value, months: document.getElementById('off-plan-calc-months')?.value, currency: 'UGX' } });
      const schedule = data.schedule;
      track('off_plan_payment_calculated', { project_id: state.activeProject?.id || null, months: schedule.months, price_ugx: schedule.price });
      result.innerHTML = `<div class="grid sm:grid-cols-3 gap-3"><div class="rounded-xl bg-white border border-green-100 p-3"><span class="text-xs text-gray-500">Upfront</span><strong class="block">${formatUgx(schedule.upfront_amount)}</strong></div><div class="rounded-xl bg-white border border-green-100 p-3"><span class="text-xs text-gray-500">Monthly from</span><strong class="block">${formatUgx(schedule.monthly_amount)}</strong></div><div class="rounded-xl bg-white border border-green-100 p-3"><span class="text-xs text-gray-500">Final payment date</span><strong class="block">${escapeHtml(schedule.instalments.at(-1)?.due_date || '—')}</strong></div></div><details class="mt-3 rounded-xl bg-white border border-green-100 p-3"><summary class="cursor-pointer font-black text-sm">View all ${schedule.months} payment dates</summary><div class="mt-3 max-h-64 overflow-auto divide-y">${schedule.instalments.map((item) => `<div class="py-2 flex justify-between gap-4 text-xs"><span>${escapeHtml(item.due_date)}</span><strong>${formatUgx(item.amount)}</strong></div>`).join('')}</div></details><p class="mt-3 text-xs text-gray-500">Illustration only. Confirm the signed payment plan, fees, taxes and exchange-rate effects with the developer and your adviser.</p>`;
    } catch (error) { result.innerHTML = `<p class="rounded-xl bg-red-50 p-3 text-sm text-red-900">${escapeHtml(error.message)}</p>`; }
  }

  function openOffPlanContactModal(developmentId = '', mode = 'listing_request') {
    state.contactDevelopmentId = developmentId || null; state.contactMode = mode || 'listing_request';
    const modal = document.getElementById('off-plan-contact-modal');
    const title = document.getElementById('off-plan-contact-title');
    if (title) title.textContent = state.contactMode === 'project_interest'
      ? offPlanText('enquireProject', { name: state.activeProject?.name || 'this project' })
      : offPlanText('listProject');
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
      const data = await request('/api/off-plan/enquiries', { method: 'POST', body: { development_id: state.contactDevelopmentId, enquiry_type: state.contactMode, preferred_contact_channel: channel, name: clean(document.getElementById('off-plan-contact-name')?.value), phone: clean(document.getElementById('off-plan-contact-phone')?.value), email: clean(document.getElementById('off-plan-contact-email')?.value), requested_callback_at: channel === 'call' ? clean(document.getElementById('off-plan-contact-callback')?.value) : null, message: state.contactMode === 'project_interest' ? `I would like to enquire about ${state.activeProject?.name || 'this off-plan project'}.` : 'I would like to enquire about listing a new off-plan project.', source_path: location.pathname } });
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
  function openOffPlanGallery() { document.querySelector('#off-plan-detail-content .off-plan-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  function managementProjectCard(project, role) {
    const blockers = project.publication_blockers || [];
    return `<article class="off-plan-dashboard-card" data-off-plan-managed-id="${escapeHtml(project.id)}"><div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4"><div class="min-w-0"><div class="flex flex-wrap gap-2"><span class="off-plan-pill ${project.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}">${escapeHtml(project.status.replace(/_/g,' '))}</span><span class="off-plan-pill bg-gray-100 text-gray-700">${escapeHtml(project.verification_status.replace(/_/g,' '))}</span></div><h4 class="mt-2 text-lg font-black text-gray-950">${escapeHtml(project.name)}</h4><p class="text-xs text-gray-500 mt-1">${escapeHtml(projectLocation(project))} · source ${escapeHtml(project.source_display_name || 'not recorded')}</p></div><div class="flex flex-wrap gap-2"><button onclick="uploadOffPlanMedia('${escapeHtml(project.id)}','${role}','images')" class="rounded-lg border border-blue-200 text-blue-800 px-3 py-2 text-xs font-black"><i class="fas fa-images mr-1"></i>Images</button><button onclick="uploadOffPlanMedia('${escapeHtml(project.id)}','${role}','floor-plans')" class="rounded-lg border border-purple-200 text-purple-800 px-3 py-2 text-xs font-black"><i class="fas fa-ruler-combined mr-1"></i>Floor plan</button><button onclick="downloadOffPlanBrochure('${escapeHtml(project.id)}','${role}','${escapeHtml(project.slug)}')" class="rounded-lg border border-gray-200 px-3 py-2 text-xs font-black"><i class="fas fa-file-pdf mr-1"></i>Brochure</button><button onclick="createOffPlanWalkthroughBrief('${escapeHtml(project.id)}','${role}')" class="rounded-lg border border-purple-200 text-purple-800 px-3 py-2 text-xs font-black"><i class="fas fa-person-walking-arrow-right mr-1"></i>Walkthrough</button></div></div>
      <div class="grid md:grid-cols-4 gap-3 mt-4"><label class="text-xs font-bold">Completion %<input data-op-edit="construction_progress" value="${escapeHtml(project.construction_progress ?? '')}" type="number" min="0" max="100" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Units total<input data-op-edit="units_total" value="${escapeHtml(project.units_total ?? '')}" type="number" min="0" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Units sold<input data-op-edit="units_sold" value="${escapeHtml(project.units_sold ?? '')}" type="number" min="0" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Expected completion<input data-op-edit="completion_date" value="${escapeHtml((project.completion_date || '').slice(0,10))}" type="date" class="mt-1 w-full rounded-lg border px-3 py-2"></label></div>
      <details class="mt-4 rounded-xl border border-gray-200 p-4"><summary class="cursor-pointer text-sm font-black text-gray-900">Project facts and publication fields</summary><div class="grid md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4"><label class="text-xs font-bold">Developer<input data-op-edit="developer_name" value="${escapeHtml(project.developer_name || '')}" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Area<input data-op-edit="area" value="${escapeHtml(project.area || '')}" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">District<input data-op-edit="district" value="${escapeHtml(project.district || '')}" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Latitude<input data-op-edit="latitude" value="${escapeHtml(project.latitude ?? '')}" type="number" step="0.0000001" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Longitude<input data-op-edit="longitude" value="${escapeHtml(project.longitude ?? '')}" type="number" step="0.0000001" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Launch price UGX<input data-op-edit="launch_price_ugx" value="${escapeHtml(project.launch_price_ugx ?? '')}" type="number" min="0" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Reservation fee UGX<input data-op-edit="reservation_fee_ugx" value="${escapeHtml(project.reservation_fee_ugx ?? '')}" type="number" min="0" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Payment months<input data-op-edit="payment_plan_months" value="${escapeHtml(project.payment_plan_months ?? '')}" type="number" min="1" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Promotion video URL<input data-op-video value="${escapeHtml(project.videos?.[0]?.url || '')}" type="url" class="mt-1 w-full rounded-lg border px-3 py-2"></label><label class="text-xs font-bold">Verification<select data-op-edit="verification_status" class="mt-1 w-full rounded-lg border px-3 py-2"><option value="needs_verification" ${project.verification_status === 'needs_verification' ? 'selected' : ''}>Needs verification</option><option value="partially_verified" ${project.verification_status === 'partially_verified' ? 'selected' : ''}>Partially verified</option><option value="verified" ${project.verification_status === 'verified' ? 'selected' : ''}>Verified by staff</option></select></label></div><label class="block mt-3 text-xs font-bold">Description<textarea data-op-edit="description" rows="4" class="mt-1 w-full rounded-lg border px-3 py-2">${escapeHtml(project.description || '')}</textarea></label><div class="grid lg:grid-cols-2 gap-3 mt-3"><label class="text-xs font-bold">Unit types (JSON)<textarea data-op-json="unit_types" rows="5" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]">${escapeHtml(JSON.stringify(project.unit_types || [], null, 2))}</textarea></label><label class="text-xs font-bold">Payment plan (JSON)<textarea data-op-json="payment_plan" rows="5" class="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-[11px]">${escapeHtml(JSON.stringify(project.payment_plan || [], null, 2))}</textarea></label></div></details>
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
    try { card.querySelectorAll('[data-op-json]').forEach((input) => { body[input.dataset.opJson] = JSON.parse(input.value || '[]'); }); }
    catch (_error) { alert('Unit types and payment plan must be valid JSON.'); return; }
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
      const data = await request(`/api/${role === 'admin' ? 'admin' : 'staff'}/off-plan/developments`, { method: 'POST', headers: managementHeaders(role), body: { name: clean(document.getElementById('off-plan-create-name')?.value), area: clean(document.getElementById('off-plan-create-area')?.value), district: clean(document.getElementById('off-plan-create-district')?.value), source_display_name: clean(document.getElementById('off-plan-create-source')?.value), project_type: clean(document.getElementById('off-plan-create-type')?.value) || 'development', description: clean(document.getElementById('off-plan-create-description')?.value), status: 'pending_review', verification_status: 'needs_verification' } });
      if (status) { status.className = 'rounded-xl p-3 text-sm bg-green-50 text-green-900'; status.textContent = `${data.development.name} was created in private staff review.`; }
      event.target.reset();
      await loadOffPlanManagement(role);
    } catch (error) { if (status) { status.className = 'rounded-xl p-3 text-sm bg-red-50 text-red-900'; status.textContent = error.message; } }
  }

  function initializeOffPlanPage() {
    track('off_plan_page_view', { path: location.pathname });
    applyOffPlanLanguageUI();
    loadLocations();
    const match = location.pathname.match(/^\/off-plan\/([a-z0-9-]+)\/?$/i);
    if (match) openOffPlanDetail(match[1], { history: false });
    else { returnToOffPlanList({ history: false }); if (!state.loaded) loadProjects(); }
  }

  Object.assign(window, { applyOffPlanLanguageUI, calculateOffPlanPayments, closeOffPlanContactModal, closeOffPlanCreateModal, createOffPlanWalkthroughBrief, downloadOffPlanBrochure, initializeOffPlanPage, loadOffPlanManagement, openOffPlanContactModal, openOffPlanCreateModal, openOffPlanDetail, openOffPlanFromHero, openOffPlanGallery, returnToOffPlanList, saveOffPlanProgress, searchOffPlan, selectOffPlanContactChannel, selectOffPlanUnit, setOffPlanProjectStatus, shareOffPlan, submitOffPlanContact, submitOffPlanProject, uploadOffPlanMedia });
  if (/^\/off-plan(?:\/|$)/i.test(location.pathname)) initializeOffPlanPage();
  if (document.getElementById('page-staff-dashboard')?.classList.contains('active')) loadOffPlanManagement('staff');
  if (document.getElementById('page-admin-dashboard')?.classList.contains('active')) loadOffPlanManagement('admin');
})();
