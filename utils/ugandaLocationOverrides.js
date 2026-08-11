function rows(names, district, town = '') {
  return names.map((name) => ({
    name,
    district,
    town: town || name,
    level: 'area',
    aliases: [name],
    source: 'makaug_verified_location_override'
  }));
}

// These rows close known source ambiguities and listing-heavy gaps. They are
// deliberately small; the nationwide parish/subcounty coverage comes from the
// generated administrative gazetteer, not from hand-maintained UI lists.
const CURATED_UGANDA_LOCATION_OVERRIDES = [
  {
    name: 'Bujjuko', district: 'Wakiso', town: 'Wakiso', level: 'area',
    aliases: ['Bujjuko', 'Bujuuko', 'Bujuko'], lat: 0.374, lng: 32.389,
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Kakiri', district: 'Wakiso', town: 'Wakiso', level: 'area',
    aliases: ['Kakiri', 'Kakiri Masulita Hoima Road'], lat: 0.409, lng: 32.38,
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Kalagi', district: 'Mukono', town: 'Mukono', level: 'area',
    aliases: ['Kalagi', 'Kalagi Town', 'Kalagi Trading Centre', 'Kalagi Trading Center'],
    lat: 0.531, lng: 32.743,
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Kololo', district: 'Kampala', town: 'Kampala', level: 'area',
    aliases: ['Kololo'], lat: 0.356, lng: 32.612,
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Banda', district: 'Kampala', town: 'Kampala', level: 'area',
    aliases: ['Banda'],
    source: 'makaug_verified_parent_mapping'
  },
  {
    name: 'Bala', district: 'Kole', town: 'Bala', level: 'town',
    aliases: ['Bala'], lat: 2.166111, lng: 32.755,
    source: 'openstreetmap_verified_override'
  },
  {
    name: 'Aber', district: 'Oyam', town: 'Aber', level: 'town',
    aliases: ['Aber'], lat: 2.193181, lng: 32.345454,
    source: 'openstreetmap_verified_override'
  },
  {
    name: 'Kapir', district: 'Ngora', town: 'Kapir', level: 'town',
    aliases: ['Kapir'], lat: 1.6537334, lng: 33.7865097,
    source: 'openstreetmap_verified_override'
  },
  ...rows(['Bunya'], 'Mayuge', 'Bunya'),
  ...rows(['Sanga'], 'Kiruhura', 'Sanga'),
  ...rows(['Kuru'], 'Yumbe', 'Kuru'),
  ...rows(['Ngoma'], 'Nakaseke', 'Ngoma'),
  ...rows(['Bugongi'], 'Sheema', 'Bugongi'),
  ...rows(['Senior Quarters'], 'Gulu', 'Gulu'),
  {
    name: 'Kassanda', district: 'Kassanda', town: 'Kassanda', level: 'district',
    aliases: ['Kassanda', 'Kasanda', 'Kassanda District', 'Kasanda District'],
    source: 'makaug_verified_spelling_alias'
  },
  {
    name: 'Namasuba', district: 'Wakiso', town: 'Makindye-Ssabagabo', level: 'area',
    aliases: ['Namasuba', 'Namasuba Ndejje', 'Ndejje Namasuba'], lat: 0.258, lng: 32.558,
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Nakawa', district: 'Kampala', town: 'Kampala', level: 'area',
    aliases: ['Nakawa', 'MUBS', 'Makerere University Business School'],
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Akright City', district: 'Wakiso', town: 'Bwebajja', level: 'area',
    aliases: ['Akright', 'Arkright', 'Akright City', 'Arkright City', 'Akright Estate', 'Arkright Estate'],
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Ndejje', district: 'Wakiso', town: 'Makindye-Ssabagabo', level: 'area',
    aliases: ['Ndejje', 'Ndejje Lubugumu'], lat: 0.244, lng: 32.553,
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Kireka', district: 'Wakiso', town: 'Kira', level: 'area',
    aliases: ['Kireka', 'Kireka Namugongo Road', 'Kireka-Namugongo Road'],
    lat: 0.347, lng: 32.649,
    source: 'makaug_verified_location_override'
  },
  {
    name: 'Ssenge', district: 'Wakiso', town: 'Nansana', level: 'area',
    aliases: ['Ssenge', 'Senge'], lat: 0.4167, lng: 32.5167,
    source: 'makaug_verified_location_override'
  },

  ...rows([
    'Najjanankumbi', 'Mutundwe', 'Bukasa', 'Kitintale', 'Mbuya', 'Luzira',
    'Kyambogo', 'Kibuli', 'Nsooba', 'Kabuusu', 'Salaama', 'Kawaala',
    'Nakulabye', 'Kavule', 'Namungoona', 'Kitebi', 'Lubya', 'Nabulagala',
    'Wankulukuku', 'Gangu', 'Kigowa', 'Kulambiro', 'Kisugu', 'Namuwongo',
    'Wabigalo', 'Kagugube', 'Bakuli', 'Lusaze', 'Kabusu', 'Katanga', 'Kivulu',
    'Kisenyi', 'Nakivubo', 'Kinawataka', 'Butabika', 'Kalinabiri', 'Kikaya'
  ], 'Kampala', 'Kampala'),

  ...rows([
    'Ssabagabo', 'Maganjo', 'Kawanda', 'Namulonge', 'Bunamwaya', 'Kiwenda',
    'Ssisa', 'Mutungo', 'Sentema', 'Kirinya', 'Katalemwa',
    'Kabojja', 'Kawuku', 'Nkumba', 'Nyanama', 'Wampewo', 'Kitala', 'Bulenga',
    'Buwambo', 'Kabubbu', 'Busabala', 'Namulanda', 'Busukuma', 'Masajja',
    'Kigungu', 'Nakawuka', 'Bwerenga', 'Nsamizi'
  ], 'Wakiso', 'Wakiso'),

  {
    name: 'Buwaate', district: 'Wakiso', town: 'Wakiso', level: 'area',
    aliases: ['Buwaate', 'Buwate'],
    source: 'openstreetmap_verified_override'
  },
  {
    name: 'Lweza', district: 'Wakiso', town: 'Wakiso', level: 'area',
    aliases: ['Lweza', 'Lweeza', 'Upper Lweza'],
    source: 'makaug_verified_spelling_alias'
  },
  ...rows(['Mbalwa', 'Nakwero', 'Nsaggu'], 'Wakiso', 'Wakiso'),
  ...rows(['Mayangayanga'], 'Mukono', 'Mukono'),

  // These names have more than one verified Uganda parent. Keeping one node
  // per parent makes an unqualified exact lookup ambiguous by construction;
  // a supplied district can still select the intended canonical node.
  ...rows(['Gobero'], 'Wakiso', 'Wakiso'),
  ...rows(['Gobero'], 'Mukono', 'Mukono'),
  ...rows(['Nakasajja'], 'Wakiso', 'Wakiso'),
  ...rows(['Nakasajja'], 'Mukono', 'Mukono'),
  ...rows(['Busika'], 'Luwero', 'Luwero'),
  ...rows(['Busika'], 'Kyankwanzi', 'Kyankwanzi'),
  ...rows(['Lugogo'], 'Kampala', 'Kampala'),
  ...rows(['Lugogo'], 'Nakasongola', 'Nakasongola'),

  // Dave's 1,019-place audit exposed five aliases for which the UBOS import
  // contained only one district instance. List every verified parent here so
  // the bare name is disambiguated instead of silently selecting one region.
  {
    name: 'Mateete', district: 'Kyenjojo', town: 'Butunduzi', level: 'parish',
    aliases: ['Mateete'], source: 'ubos_and_openstreetmap_verified_override'
  },
  {
    name: 'Mateete', district: 'Sembabule', town: 'Mateete', level: 'town',
    aliases: ['Mateete'], source: 'ubos_and_openstreetmap_verified_override'
  },
  {
    name: 'Migyera', district: 'Isingiro', town: 'Ruhiira', level: 'neighborhood',
    aliases: ['Migyera'], source: 'ubos_and_openstreetmap_verified_override'
  },
  {
    name: 'Migyera', district: 'Nakasongola', town: 'Migyera', level: 'town',
    aliases: ['Migyera', 'Migeera'], source: 'ubos_and_openstreetmap_verified_override'
  },
  {
    name: 'Labongo', district: 'Masindi', town: 'Labongo', level: 'parish',
    aliases: ['Labongo'], source: 'ubos_and_openstreetmap_verified_override'
  },
  {
    name: 'Labongo', district: 'Kitgum', town: 'Kitgum', level: 'area',
    aliases: ['Labongo'], source: 'ubos_and_openstreetmap_verified_override'
  },
  {
    name: 'Labongo', district: 'Pader', town: 'Pader', level: 'area',
    aliases: ['Labongo'], source: 'openstreetmap_verified_override'
  },
  {
    name: 'Bukuuku', district: 'Nakaseke', town: 'Kaasangombe', level: 'parish',
    aliases: ['Bukuuku'], source: 'ubos_and_openstreetmap_verified_override'
  },
  {
    name: 'Bukuuku', district: 'Kabarole', town: 'Fort Portal', level: 'area',
    aliases: ['Bukuuku'], source: 'openstreetmap_verified_override'
  },
  {
    name: 'Kyeeya', district: 'Kamuli', town: 'Namwendwa', level: 'parish',
    aliases: ['Kyeeya'], source: 'ubos_verified_override'
  },
  {
    name: 'Kyeeya', district: 'Kyenjojo', town: 'Kyenjojo', level: 'area',
    aliases: ['Kyeeya'], source: 'openstreetmap_verified_override'
  },
  {
    name: 'Bushenyi-Ishaka', district: 'Bushenyi', town: 'Bushenyi-Ishaka', level: 'city',
    aliases: ['Bushenyi-Ishaka', 'Bushenyi Ishaka', 'Bushenyi-Ishaka Municipality'],
    source: 'ubos_verified_municipality_alias'
  },

  ...rows([
    'Nakifuma', 'Kasawo', 'Kyampisi', 'Bukerere', 'Namilyango', 'Namataba',
    'Kasenge', 'Kabembe', 'Kojja', 'Kibuye'
  ], 'Mukono', 'Mukono'),

  ...rows(['Mpumudde', 'Walukuba', 'Kimaka', 'Mafubira'], 'Jinja', 'Jinja'),
  ...rows(['Nkoma', 'Malukhu', 'Namakwekwe', 'Wanale'], 'Mbale', 'Mbale'),
  ...rows(['Laroo'], 'Gulu', 'Gulu'),
  ...rows(['Oli', 'Mvara'], 'Arua', 'Arua'),
  ...rows(['Ojwina'], 'Lira', 'Lira'),
  ...rows(['Kamukuzi', 'Kakiika', 'Nyamityobora'], 'Mbarara', 'Mbarara'),
  ...rows(['Mpanga', 'Kagote'], 'Kabarole', 'Fort Portal'),
  ...rows(['Kahoora'], 'Hoima', 'Hoima'),

  ...rows(['Bombo', 'Wobulenzi'], 'Luwero'),
  ...rows(['Gombe'], 'Butambala'),
  ...rows(['Kalisizo', 'Mutukula'], 'Kyotera'),
  ...rows(['Kyazanga'], 'Lwengo'),
  ...rows(['Lukaya'], 'Kalungu'),
  ...rows(['Namayumba'], 'Wakiso'),
  ...rows(['Nkokonjeru'], 'Buikwe'),
  ...rows(['Kakira', 'Buwenge'], 'Jinja'),
  ...rows(['Mpondwe', 'Bwera'], 'Kasese'),
  ...rows(['Paidha'], 'Zombo'),
  ...rows(['Kihiihi'], 'Kanungu'),
  ...rows(['Kabuyanda'], 'Isingiro'),
  ...rows(['Kibingo'], 'Sheema'),
  ...rows(['Rwimi'], 'Bunyangabu'),
  ...rows(['Kyarusozi'], 'Kyenjojo'),
  ...rows(['Elegu'], 'Amuru'),
  ...rows(['Kalongo'], 'Agago'),

  ...rows(['Bughendera'], 'Bundibugyo'),
  ...rows(['Budiope East', 'Budiope West'], 'Buyende'),
  ...rows(['Aswa', 'Cereleno'], 'Gulu'),
  ...rows(['Bugahya', 'Buhaguzi'], 'Hoima'),
  ...rows(['Burahya'], 'Kabarole'),
  ...rows(['Bukonzo'], 'Kasese'),
  ...rows(['Buruuli', 'Budyebo'], 'Nakasongola'),
  ...rows(['Jonam'], 'Pakwach'),
  ...rows(['Rujumbura'], 'Rukungiri'),
  ...rows(['West Budama'], 'Tororo'),
  ...rows(['Kirombo'], 'Arua'),
  ...rows(['Myene'], 'Oyam'),
  ...rows(['Kicuumu'], 'Rwampara'),
  ...rows(['Kibinge'], 'Bukomansimbi'),

  // UBOS legacy spellings and worklist shorthand. The nationwide data remains
  // generated; these aliases reconcile names whose 2024 label has changed or
  // whose source probe omitted a county/division suffix.
  ...rows(['Bunyole'], 'Butaleja'),
  ...rows(['Kinkiizi'], 'Kanungu'),
  ...rows(['Chua'], 'Kitgum'),
  ...rows(['Kyaka'], 'Kyegegwa'),
  ...rows(['Bamunanika', 'Butuntumula', 'Zirobwe', 'Kamira', 'Nyimbwa', 'Makulubita'], 'Luwero'),
  ...rows(['Kashari', 'Rwebikoona', 'Bwizibwera'], 'Mbarara'),
  ...rows(['Lwemiyaga', 'Mawogola', 'Ntuusi', 'Lugusulu', 'Lwebitakuli'], 'Sembabule'),
  ...rows(['Busembatya'], 'Bugweri'),
  ...rows(['Kikagati'], 'Isingiro'),
  ...rows(['Kichinjaji'], 'Soroti'),
  ...rows(['Ewuata', 'Dadamu', 'Manibe', 'Adumi', 'Pajulu', 'Oluko'], 'Arua'),
  ...rows(['Kabundaire'], 'Fort Portal City', 'Fort Portal'),
  ...rows(['Tula', 'Kanjokya', 'Kabega'], 'Kampala', 'Kampala'),
  ...rows(['Lunya', 'Nasuuti', 'Namumira', 'Nabbaale', 'Kome'], 'Mukono', 'Mukono'),
  ...rows(['Kyanamukaaka', 'Kabonera', 'Mukungwe'], 'Masaka'),
  ...rows(['Mukujju'], 'Tororo'),
  ...rows(['Ngetta'], 'Lira'),
  ...rows(['Nyaravur'], 'Nebbi'),
  ...rows(['Acholibur'], 'Pader'),
  ...rows(['Galiraaya'], 'Kayunga'),
  ...rows(['Kkingo'], 'Lwengo'),
  ...rows(['Bageza'], 'Mubende'),
  ...rows(['Nawaningi'], 'Iganga'),
  ...rows(['Cegere'], 'Apac'),
  ...rows(['Chawente'], 'Kwania'),
  ...rows(['Sidok'], 'Kaabong'),
  ...rows(['Lotuke'], 'Abim'),
  ...rows(['Kitholhu'], 'Kasese'),
  ...rows(['Rwentobo'], 'Ntungamo')
];

module.exports = {
  CURATED_UGANDA_LOCATION_OVERRIDES
};
