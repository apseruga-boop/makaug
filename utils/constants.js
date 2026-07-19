const DISTRICTS = [
  'Abim', 'Adjumani', 'Agago', 'Alebtong', 'Amolatar', 'Amudat', 'Amuria', 'Amuru', 'Apac', 'Arua', 'Arua City',
  'Budaka', 'Bududa', 'Bugiri', 'Bugweri', 'Buhweju', 'Buikwe', 'Bukedea', 'Bukomansimbi', 'Bukwo', 'Bulambuli',
  'Buliisa', 'Bundibugyo', 'Bunyangabu', 'Bushenyi', 'Busia', 'Butaleja', 'Butambala', 'Butebo', 'Buvuma', 'Buyende', 'Dokolo',
  'Fort Portal City', 'Gomba', 'Gulu', 'Gulu City', 'Hoima', 'Hoima City', 'Ibanda', 'Iganga', 'Isingiro', 'Jinja', 'Jinja City', 'Kaabong', 'Kabale', 'Kabarole',
  'Kaberamaido', 'Kagadi', 'Kakumiro', 'Kalaki', 'Kalangala', 'Kaliro', 'Kalungu', 'Kampala', 'Kamuli', 'Kamwenge',
  'Kanungu', 'Kapchorwa', 'Kapelebyong', 'Karenga', 'Kassanda', 'Kasese', 'Katakwi', 'Kayunga', 'Kazo', 'Kibaale',
  'Kiboga', 'Kibuku', 'Kikuube', 'Kiruhura', 'Kiryandongo', 'Kisoro', 'Kitagwenda', 'Kitgum', 'Koboko', 'Kole',
  'Kotido', 'Kumi', 'Kwania', 'Kween', 'Kyankwanzi', 'Kyegegwa', 'Kyenjojo', 'Kyotera', 'Lamwo', 'Lira', 'Lira City',
  'Luuka', 'Luwero', 'Lwengo', 'Lyantonde', 'Madi-Okollo', 'Manafwa', 'Maracha', 'Masaka', 'Masaka City', 'Masindi', 'Mayuge',
  'Mbale', 'Mbale City', 'Mbarara', 'Mbarara City', 'Mitooma', 'Mityana', 'Moroto', 'Moyo', 'Mpigi', 'Mubende', 'Mukono', 'Nabilatuk',
  'Nakapiripirit', 'Nakaseke', 'Nakasongola', 'Namayingo', 'Namisindwa', 'Namutumba', 'Napak', 'Nebbi', 'Ngora', 'Ntoroko',
  'Ntungamo', 'Nwoya', 'Obongi', 'Omoro', 'Otuke', 'Oyam', 'Pader', 'Pakwach', 'Pallisa', 'Rakai',
  'Rubanda', 'Rubirizi', 'Rukiga', 'Rukungiri', 'Rwampara', 'Sembabule', 'Serere', 'Sheema', 'Sironko', 'Soroti', 'Soroti City', 'Terego', 'Tororo',
  'Wakiso', 'Yumbe', 'Zombo'
];

const UNIVERSITIES = [
  'Makerere University',
  'Kyambogo University',
  'Mbarara University of Science and Technology (MUST)',
  'Gulu University',
  'Busitema University',
  'Kabale University',
  'Lira University',
  'Muni University',
  'Makerere University Business School (MUBS)',
  'Uganda Christian University (UCU)',
  'Nkumba University',
  'Kampala International University (KIU)',
  'Ndejje University',
  'Uganda Martyrs University (UMU)',
  'Islamic University in Uganda (IUIU)',
  'Bishop Stuart University',
  'Bugema University',
  'Mountains of the Moon University',
  'Victoria University',
  'St. Lawrence University',
  'Cavendish University Uganda',
  'ISBAT University',
  'Aga Khan University (Uganda Campus)',
  'Clarke International University',
  'LivingStone International University',
  'Metropolitan International University',
  'Uganda Pentecostal University',
  'All Saints University Lango',
  'Team University',
  'Great Lakes Regional University',
  'African Bible University',
  'Kumi University',
  'Uganda Technology and Management University',
  'King Caesar University',
  'Virtual University Uganda',
  'African Rural University',
  'Ibanda University',
  'Ankole Western University',
  'Nile University of Uganda',
  'International Health Sciences University',
  'Kabojja International University',
  'Noah Ark University',
  'Soroti University',
  'Uganda National Institute of Teacher Education (UNITE)'
];

const LISTING_TYPES = ['sale', 'rent', 'land', 'commercial', 'student', 'students'];
const PROPERTY_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'hidden', 'deleted', 'archived', 'sold'];

module.exports = {
  DISTRICTS,
  UNIVERSITIES,
  LISTING_TYPES,
  PROPERTY_STATUSES
};
