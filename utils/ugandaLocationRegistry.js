const { DISTRICTS } = require('./constants');
const administrativeGazetteer = require('./ugandaLocationGazetteer.generated.json');
const { CURATED_UGANDA_LOCATION_OVERRIDES } = require('./ugandaLocationOverrides');
const {
  freeTextLocationQueryAttempts: sharedFreeTextLocationQueryAttempts,
  locationQueryAttempts: sharedLocationQueryAttempts,
  normalizeLocationQueryCandidates: sharedNormalizeLocationQueryCandidates
} = require('./locationQueryNormalization');

const DETAILED_LOCATIONS = [
  { name: 'Kampala', district: 'Kampala', level: 'district', lat: 0.3476, lng: 32.5825, aliases: ['Kampala', 'Kampala City', 'Central Kampala'] },
  { name: 'Nakasero', district: 'Kampala', lat: 0.318, lng: 32.582 },
  { name: 'Kololo', district: 'Kampala', lat: 0.356, lng: 32.612 },
  { name: 'Old Kampala', district: 'Kampala', lat: 0.313, lng: 32.569 },
  { name: 'Makerere', district: 'Kampala', lat: 0.335, lng: 32.568 },
  { name: 'Wandegeya', district: 'Kampala', lat: 0.336, lng: 32.57 },
  { name: 'Nakawa', district: 'Kampala', lat: 0.334, lng: 32.61 },
  { name: 'Ntinda', district: 'Kampala', lat: 0.357, lng: 32.612 },
  { name: 'Naguru', district: 'Kampala', lat: 0.338, lng: 32.611 },
  { name: 'Bukoto', district: 'Kampala', lat: 0.346, lng: 32.591, aliases: ['Bukoto', 'Bukotto'] },
  { name: 'Kisaasi', district: 'Kampala', lat: 0.364, lng: 32.589, aliases: ['Kisaasi', 'Kisasi'] },
  { name: 'Kyanja', district: 'Kampala', lat: 0.384, lng: 32.596, aliases: ['Kyanja', 'Komamboga Kyanja'] },
  { name: 'Komamboga', district: 'Kampala', lat: 0.394, lng: 32.598 },
  { name: 'Kiwatule', district: 'Kampala', lat: 0.372, lng: 32.625 },
  { name: 'Bugolobi', district: 'Kampala', lat: 0.317, lng: 32.612 },
  { name: 'Makindye', district: 'Kampala', lat: 0.301, lng: 32.586 },
  { name: 'Muyenga', district: 'Kampala', lat: 0.285, lng: 32.594 },
  { name: 'Ggaba', district: 'Kampala', lat: 0.274, lng: 32.619, aliases: ['Ggaba', 'Gaba'] },
  { name: 'Kansanga', district: 'Kampala', lat: 0.289, lng: 32.607 },
  { name: 'Buziga', district: 'Kampala', lat: 0.277, lng: 32.596 },
  { name: 'Bunga', district: 'Kampala', lat: 0.262, lng: 32.623 },
  { name: 'Kabalagala', district: 'Kampala', lat: 0.298, lng: 32.603 },
  { name: 'Munyonyo', district: 'Kampala', lat: 0.236, lng: 32.623, aliases: ['Munyonyo', 'Munyonjo'] },
  { name: 'Rubaga', district: 'Kampala', lat: 0.298, lng: 32.545, aliases: ['Rubaga', 'Lubaga'] },
  { name: 'Nateete', district: 'Kampala', lat: 0.318, lng: 32.536 },
  { name: 'Mengo', district: 'Kampala', lat: 0.306, lng: 32.557, aliases: ['Mengo', 'Mmengo'] },
  { name: 'Lungujja', district: 'Kampala', lat: 0.302, lng: 32.548 },
  { name: 'Kasubi', district: 'Kampala', lat: 0.333, lng: 32.555 },
  { name: 'Kikoni', district: 'Kampala', lat: 0.333, lng: 32.565 },
  { name: 'Ndeeba', district: 'Kampala', lat: 0.301, lng: 32.548 },
  { name: 'Kikuubo', district: 'Kampala', lat: 0.314, lng: 32.576 },
  { name: 'Kawempe', district: 'Kampala', level: 'city', lat: 0.379, lng: 32.557, aliases: ['Kawempe', 'Kawempe Division'] },
  { name: 'Bwaise', district: 'Kampala', lat: 0.36, lng: 32.557 },
  { name: 'Kalerwe', district: 'Kampala', lat: 0.371, lng: 32.57 },
  { name: 'Mulago', district: 'Kampala', lat: 0.34, lng: 32.577 },
  { name: 'Kanyanya', district: 'Kampala', lat: 0.389, lng: 32.578 },
  { name: 'Mpererwe', district: 'Kampala', lat: 0.411, lng: 32.585 },
  { name: 'Kyebando', district: 'Kampala', lat: 0.365, lng: 32.574 },
  { name: 'Kamwokya', district: 'Kampala', lat: 0.349, lng: 32.598 },
  { name: 'Nsambya', district: 'Kampala', lat: 0.303, lng: 32.589 },
  { name: 'Katwe', district: 'Kampala', lat: 0.305, lng: 32.574 },
  { name: 'Namirembe', district: 'Kampala', lat: 0.315, lng: 32.559 },
  { name: 'Kabowa', district: 'Kampala', lat: 0.285, lng: 32.54 },
  { name: 'Bukesa', district: 'Kampala', lat: 0.325, lng: 32.567 },
  { name: 'Busega', district: 'Kampala', lat: 0.309, lng: 32.526 },

  { name: 'Wakiso', district: 'Wakiso', level: 'district', lat: 0.4044, lng: 32.4594, aliases: ['Wakiso', 'Wakiso District'] },
  { name: 'Entebbe', district: 'Wakiso', level: 'city', lat: 0.0512, lng: 32.4637, aliases: ['Entebbe', 'Entebbe Town', 'Entebbe Municipality'] },
  { name: 'Kitoro', district: 'Wakiso', lat: 0.055, lng: 32.464 },
  { name: 'Nakiwogo', district: 'Wakiso', lat: 0.061, lng: 32.458 },
  { name: 'Bugonga', district: 'Wakiso', lat: 0.045, lng: 32.453 },
  { name: 'Katabi', district: 'Wakiso', lat: 0.071, lng: 32.499 },
  { name: 'Abayita Ababiri', district: 'Wakiso', lat: 0.106, lng: 32.525, aliases: ['Abayita Ababiri', 'Abaita Ababiri'] },
  { name: 'Kitende', district: 'Wakiso', lat: 0.198, lng: 32.533 },
  { name: 'Kajjansi', district: 'Wakiso', lat: 0.208, lng: 32.552, aliases: ['Kajjansi', 'Kajansi'] },
  { name: 'Bwebajja', district: 'Wakiso', lat: 0.179, lng: 32.541 },
  { name: 'Kigo', district: 'Wakiso', lat: 0.196, lng: 32.615 },
  { name: 'Lubowa', district: 'Wakiso', lat: 0.237, lng: 32.576, aliases: ['Lubowa', 'Lubowa Estate'] },
  { name: 'Namasuba', district: 'Wakiso', lat: 0.258, lng: 32.558, aliases: ['Namasuba', 'Namasuba Ndejje', 'Ndejje Namasuba'] },
  { name: 'Ndejje', district: 'Wakiso', lat: 0.244, lng: 32.553 },
  { name: 'Lubugumu', district: 'Wakiso', lat: 0.239, lng: 32.554 },
  { name: 'Seguku', district: 'Wakiso', lat: 0.247, lng: 32.555, aliases: ['Seguku', 'Sseguku'] },
  { name: 'Kira', district: 'Wakiso', level: 'city', lat: 0.3978, lng: 32.6414, aliases: ['Kira', 'Kiira', 'Kira Town', 'Kiira Town', 'Kira Municipality'] },
  { name: 'Namugongo', district: 'Wakiso', lat: 0.363, lng: 32.636 },
  { name: 'Kireka', district: 'Wakiso', lat: 0.347, lng: 32.649 },
  { name: 'Bweyogerere', district: 'Wakiso', lat: 0.351, lng: 32.676 },
  { name: 'Kyaliwajjala', district: 'Wakiso', lat: 0.377, lng: 32.639 },
  { name: 'Naalya', district: 'Wakiso', lat: 0.366, lng: 32.636, aliases: ['Naalya', 'Naalya Estate'] },
  { name: 'Najjera', district: 'Wakiso', lat: 0.396, lng: 32.615, aliases: ['Najjera', 'Najjeera'] },
  { name: 'Bulindo', district: 'Wakiso', lat: 0.418, lng: 32.633 },
  { name: 'Sonde', district: 'Wakiso', lat: 0.378, lng: 32.698 },
  { name: 'Kira-Mulawa', district: 'Wakiso', lat: 0.412, lng: 32.65, aliases: ['Kira-Mulawa', 'Kira Mulawa', 'Mulawa'] },
  { name: 'Kira-Nsasa', district: 'Wakiso', lat: 0.428, lng: 32.665, aliases: ['Kira-Nsasa', 'Kira Nsasa', 'Nsasa'] },
  { name: 'Nansana', district: 'Wakiso', level: 'city', lat: 0.364, lng: 32.52, aliases: ['Nansana', 'Nansana Town', 'Nansana Municipality'] },
  { name: 'Nabweru', district: 'Wakiso', lat: 0.378, lng: 32.525 },
  { name: 'Wamala', district: 'Wakiso', lat: 0.373, lng: 32.506 },
  { name: 'Gganda', district: 'Wakiso', lat: 0.352, lng: 32.536 },
  { name: 'Wakiso Central', district: 'Wakiso', lat: 0.404, lng: 32.459 },
  { name: 'Kakiri', district: 'Wakiso', lat: 0.409, lng: 32.38 },
  { name: 'Bujjuko', district: 'Wakiso', lat: 0.374, lng: 32.389, aliases: ['Bujjuko', 'Bujuuko', 'Bujjuko Akright', 'Bujuuko Akright', 'Akright'] },
  { name: 'Masulita', district: 'Wakiso', lat: 0.51, lng: 32.46 },
  { name: 'Kasanje', district: 'Wakiso', lat: 0.217, lng: 32.383 },
  { name: 'Kasangati', district: 'Wakiso', lat: 0.434, lng: 32.61, aliases: ['Kasangati', 'Kasangati-Nangabo', 'Kasangati Nangabo', 'Nangabo'] },
  { name: 'Gayaza', district: 'Wakiso', lat: 0.452, lng: 32.606, aliases: ['Gayaza', 'Gayaza Town'] },
  { name: 'Matugga', district: 'Wakiso', lat: 0.463, lng: 32.525 },
  { name: 'Maya', district: 'Wakiso', lat: 0.253, lng: 32.418 },
  { name: 'Garuga', district: 'Wakiso', lat: 0.09, lng: 32.543 },
  { name: 'Buloba', district: 'Wakiso', lat: 0.328, lng: 32.444 },
  { name: 'Nsangi', district: 'Wakiso', lat: 0.24, lng: 32.456 },
  { name: 'Zana', district: 'Wakiso', lat: 0.251, lng: 32.56 },
  { name: 'Kisubi', district: 'Wakiso', lat: 0.119, lng: 32.533 },
  { name: 'Nabbingo', district: 'Wakiso', lat: 0.295, lng: 32.477 },
  { name: 'Kyengera', district: 'Wakiso', level: 'city', lat: 0.294, lng: 32.501, aliases: ['Kyengera', 'Kyengera Town'] },

  { name: 'Kalagi', district: 'Mukono', lat: 0.531, lng: 32.743, aliases: ['Kalagi', 'Kalagi Town', 'Kalagi Trading Centre', 'Kalagi Trading Center'] },

  { name: 'Mukono', district: 'Mukono', level: 'district', lat: 0.353, lng: 32.753, aliases: ['Mukono', 'Mukono Town'] },
  { name: 'Seeta', district: 'Mukono', lat: 0.361, lng: 32.705 },
  { name: 'Goma', district: 'Mukono', lat: 0.383, lng: 32.742 },
  { name: 'Namanve', district: 'Mukono', lat: 0.348, lng: 32.697 },
  { name: 'Bajjo', district: 'Mukono', lat: 0.333, lng: 32.741 },
  { name: 'Katosi', district: 'Mukono', lat: 0.181, lng: 32.797, aliases: ['Katosi', 'Mpunge', 'Mpungwe', 'Katosi Mpunge'] },

  { name: 'Jinja', district: 'Jinja', level: 'district', lat: 0.424, lng: 33.204, aliases: ['Jinja', 'Jinja City', 'Jinja Town', 'Jinja Central'] },
  { name: 'Masese', district: 'Jinja', lat: 0.406, lng: 33.209 },
  { name: 'Nalufenya', district: 'Jinja', lat: 0.427, lng: 33.222 },
  { name: 'Bugembe', district: 'Jinja', lat: 0.457, lng: 33.231 },

  { name: 'Mbarara', district: 'Mbarara', level: 'district', lat: -0.607, lng: 30.654, aliases: ['Mbarara', 'Mbarara City', 'Mbarara Town'] },
  { name: 'Nyamitanga', district: 'Mbarara', lat: -0.62, lng: 30.646 },
  { name: 'Kakoba', district: 'Mbarara', lat: -0.605, lng: 30.664 },
  { name: 'Ruti', district: 'Mbarara', lat: -0.633, lng: 30.654 },
  { name: 'Biharwe', district: 'Mbarara', lat: -0.556, lng: 30.643 },

  { name: 'Gulu', district: 'Gulu', level: 'district', lat: 2.775, lng: 32.299, aliases: ['Gulu', 'Gulu City', 'Gulu Central'] },
  { name: 'Pece', district: 'Gulu', lat: 2.789, lng: 32.293 },
  { name: 'Layibi', district: 'Gulu', lat: 2.767, lng: 32.292 },
  { name: 'Bardege', district: 'Gulu', lat: 2.787, lng: 32.315 },
  { name: 'Kanyagoga', district: 'Gulu', lat: 2.755, lng: 32.301 },

  { name: 'Mbale', district: 'Mbale', level: 'district', lat: 1.062, lng: 34.175, aliases: ['Mbale', 'Mbale City', 'Mbale Town', 'Mbale Central'] },
  { name: 'Industrial Area', district: 'Mbale', lat: 1.061, lng: 34.186 },
  { name: 'Namatala', district: 'Mbale', lat: 1.08, lng: 34.19 },
  { name: 'Senior Quarters Mbale', district: 'Mbale', lat: 1.055, lng: 34.17, aliases: ['Senior Quarters Mbale'] },

  { name: 'Lira', district: 'Lira', level: 'district', lat: 2.249, lng: 32.899, aliases: ['Lira', 'Lira City', 'Lira Central'] },
  { name: 'Adyel', district: 'Lira', lat: 2.268, lng: 32.895 },
  { name: 'Barapwo', district: 'Lira', lat: 2.234, lng: 32.887 },
  { name: 'Ireda', district: 'Lira', lat: 2.241, lng: 32.912 },

  { name: 'Arua', district: 'Arua', level: 'district', lat: 3.02, lng: 30.91, aliases: ['Arua', 'Arua City', 'Arua Central'] },
  { name: 'Olua', district: 'Arua', lat: 3.037, lng: 30.912 },
  { name: 'Awindiri', district: 'Arua', lat: 3.006, lng: 30.89 },
  { name: 'Pokea', district: 'Arua', lat: 3.028, lng: 30.932 },

  { name: 'Luwero', district: 'Luwero', level: 'district', lat: 0.8492, lng: 32.4731, aliases: ['Luwero', 'Luweero', 'Luwero Town', 'Luweero Town'] },
  { name: 'Ndibulungi', district: 'Luwero', aliases: ['Ndibulungi', 'Luwero Ndibulungi', 'Luweero Ndibulungi'] },

  { name: 'Fort Portal', district: 'Kabarole', level: 'city', lat: 0.671, lng: 30.254, aliases: ['Fort Portal', 'Fort Portal City', 'Fort Portal Central'] },
  { name: 'Kijura', district: 'Kabarole', lat: 0.679, lng: 30.272 },
  { name: 'Boma', district: 'Kabarole', lat: 0.675, lng: 30.248 },
  { name: 'Rwengoma', district: 'Kabarole', lat: 0.665, lng: 30.243 },

  { name: 'Hoima', district: 'Hoima', level: 'district', lat: 1.434, lng: 31.352, aliases: ['Hoima', 'Hoima City', 'Hoima Central'] },
  { name: 'Kasingo', district: 'Hoima', lat: 1.446, lng: 31.361 },
  { name: 'Busiisi', district: 'Hoima', lat: 1.419, lng: 31.344 },
  { name: 'Kyentale', district: 'Hoima', lat: 1.441, lng: 31.337 },

  { name: 'Masindi', district: 'Masindi', level: 'district', lat: 1.683, lng: 31.715, aliases: ['Masindi', 'Masindi Town', 'Masindi Municipality', 'Masindi Central'] },
  { name: 'Kijura', district: 'Masindi', lat: 1.69, lng: 31.72 },
  { name: 'Kisanja', district: 'Masindi', lat: 1.676, lng: 31.711 },
  { name: 'Nyangahya', district: 'Masindi', lat: 1.704, lng: 31.725 },
  { name: 'Kigulya', district: 'Masindi', lat: 1.697, lng: 31.706 },

  { name: 'Masaka', district: 'Masaka', level: 'district', lat: -0.333, lng: 31.733, aliases: ['Masaka', 'Masaka City', 'Masaka Central'] },
  { name: 'Nyendo', district: 'Masaka', lat: -0.343, lng: 31.725 },
  { name: 'Ssenyange', district: 'Masaka', lat: -0.326, lng: 31.737 },
  { name: 'Kimaanya', district: 'Masaka', lat: -0.325, lng: 31.724 },

  { name: 'Kabale', district: 'Kabale', level: 'district', lat: -1.249, lng: 29.989, aliases: ['Kabale', 'Kabale Town', 'Kabale Municipality', 'Kabale Central'] },
  { name: 'Rutooma', district: 'Kabale', lat: -1.257, lng: 29.996 },
  { name: 'Kekubo', district: 'Kabale', lat: -1.241, lng: 29.981 },
  { name: 'Butobere', district: 'Kabale', lat: -1.253, lng: 30.001 },

  // Canonical coverage for districts that have appeared in marketplace inventory.
  // These are real towns/sub-counties, never generated "Central/East/West" placeholders.
  { name: 'Njeru', district: 'Buikwe', level: 'city', lat: 0.449, lng: 33.177 },
  { name: 'Lugazi', district: 'Buikwe', level: 'city', lat: 0.378, lng: 32.924 },
  { name: 'Najjembe', district: 'Buikwe', lat: 0.423, lng: 32.99 },
  { name: 'Buwama', district: 'Mpigi', level: 'city', lat: 0.057, lng: 32.096 },
  { name: 'Kammengo', district: 'Mpigi', lat: 0.16, lng: 32.2 },
  { name: 'Muduuma', district: 'Mpigi', lat: 0.31, lng: 32.25 },
  { name: 'Busunju', district: 'Mityana', level: 'city', lat: 0.568, lng: 32.21 },
  { name: 'Zigoti', district: 'Mityana', lat: 0.48, lng: 32.18 },
  { name: 'Ttamu', district: 'Mityana', lat: 0.43, lng: 32.09 },
  { name: 'Kangulumira', district: 'Kayunga', lat: 0.516, lng: 32.75 },
  { name: 'Nazigo', district: 'Kayunga', lat: 0.538, lng: 32.82 },
  { name: 'Bbaale', district: 'Kayunga', lat: 1.01, lng: 32.88 },
  { name: 'Bugulumbya', district: 'Kamuli', lat: 0.95, lng: 33.12 },
  { name: 'Namwendwa', district: 'Kamuli', lat: 1.08, lng: 33.16 },
  { name: 'Mbulamuti', district: 'Kamuli', lat: 0.74, lng: 33.14 },
  { name: 'Busei', district: 'Iganga', lat: 0.62, lng: 33.47 },
  { name: 'Nakalama', district: 'Iganga', lat: 0.66, lng: 33.48 },
  { name: 'Nambale', district: 'Iganga', lat: 0.56, lng: 33.52 },
  { name: 'Dabani', district: 'Busia', lat: 0.5, lng: 34.0 },
  { name: 'Masafu', district: 'Busia', lat: 0.45, lng: 34.02 },
  { name: 'Lumino', district: 'Busia', lat: 0.33, lng: 33.98 },
  { name: 'Malaba', district: 'Tororo', level: 'city', lat: 0.635, lng: 34.268 },
  { name: 'Nagongera', district: 'Tororo', lat: 0.77, lng: 34.02 },
  { name: 'Osukuru', district: 'Tororo', lat: 0.67, lng: 34.12 },
  { name: 'Madera', district: 'Soroti', lat: 1.72, lng: 33.61 },
  { name: 'Nakatunya', district: 'Soroti', lat: 1.69, lng: 33.62 },
  { name: 'Pamba', district: 'Soroti', lat: 1.71, lng: 33.6 },
  { name: 'Nyamwamba', district: 'Kasese', lat: 0.18, lng: 30.08 },
  { name: 'Kilembe', district: 'Kasese', lat: 0.2, lng: 30.02 },
  { name: 'Hima', district: 'Kasese', level: 'city', lat: 0.29, lng: 30.18 },
  { name: 'Ishaka', district: 'Bushenyi', level: 'city', lat: -0.54, lng: 30.14 },
  { name: 'Nyakabirizi', district: 'Bushenyi', lat: -0.56, lng: 30.19 },
  { name: 'Ruharo', district: 'Bushenyi', lat: -0.53, lng: 30.21 },
  { name: 'Rubaare', district: 'Ntungamo', lat: -0.79, lng: 30.26 },
  { name: 'Rwashamaire', district: 'Ntungamo', lat: -0.76, lng: 30.31 },
  { name: 'Itojo', district: 'Ntungamo', lat: -0.93, lng: 30.25 },
  { name: 'Buyanja', district: 'Rukungiri', lat: -0.79, lng: 29.93 },
  { name: 'Kebisoni', district: 'Rukungiri', lat: -0.73, lng: 29.98 },
  { name: 'Nyakagyeme', district: 'Rukungiri', lat: -0.84, lng: 29.96 },
  { name: 'Kabwohe', district: 'Sheema', level: 'city', lat: -0.58, lng: 30.38 },
  { name: 'Itendero', district: 'Sheema', lat: -0.55, lng: 30.35 },
  { name: 'Kigarama', district: 'Sheema', lat: -0.62, lng: 30.33 },
  { name: 'Kacheera', district: 'Rakai', lat: -0.94, lng: 31.05 },
  { name: 'Ddwaniro', district: 'Rakai', lat: -0.76, lng: 31.16 },
  { name: 'Lwamaggwa', district: 'Rakai', lat: -0.88, lng: 31.18 }
];

const EXCLUDED_LOCATION_ONLY_PATTERNS = [
  /\b(?:lake victoria|victoria lake|lake albert|lake kyoga|lake edward|lake george)\b/i,
  /\b(?:central|eastern|northern|western|greater kampala metropolitan)\s+region\b/i,
  /\b(?:road|rd|street|st|avenue|ave|highway|bypass|expressway)\b/i
];

function normalizeLocationKey(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function locationQueryAttempts(value = '') {
  return sharedLocationQueryAttempts(value, {
    countryCode: 'UG',
    countryCodes: ['UG', 'ZA'],
    normalizeKey: normalizeLocationKey
  });
}

function normalizeLocationQueryCandidates(value = '') {
  return sharedNormalizeLocationQueryCandidates(value, {
    countryCode: 'UG',
    countryCodes: ['UG', 'ZA'],
    normalizeKey: normalizeLocationKey
  });
}

function freeTextLocationQueryAttempts(value = '') {
  return sharedFreeTextLocationQueryAttempts(value, {
    countryCode: 'UG',
    countryCodes: ['UG', 'ZA'],
    normalizeKey: normalizeLocationKey
  });
}

const canonicalDistrictByKey = new Map();
DISTRICTS.forEach((district) => {
  const normalized = normalizeLocationKey(district).replace(/\s+city$/, '');
  if (!canonicalDistrictByKey.has(normalized)) {
    canonicalDistrictByKey.set(normalized, district.replace(/\s+City$/, ''));
  }
});
canonicalDistrictByKey.set('fort portal', 'Kabarole');
canonicalDistrictByKey.set('luweero', 'Luwero');

function normalizeDistrict(value = '') {
  const key = normalizeLocationKey(value)
    .replace(/\s+(?:district|city|municipality)$/, '')
    .trim();
  return canonicalDistrictByKey.get(key) || '';
}

const overrideAliasKeysByDistrict = new Map();
CURATED_UGANDA_LOCATION_OVERRIDES.forEach((entry) => {
  const district = normalizeDistrict(entry.district) || String(entry.district || '').trim();
  if (!district) return;
  if (!overrideAliasKeysByDistrict.has(district)) overrideAliasKeysByDistrict.set(district, new Set());
  [entry.name, ...(entry.aliases || [])]
    .map(normalizeLocationKey)
    .filter(Boolean)
    .forEach((aliasKey) => overrideAliasKeysByDistrict.get(district).add(aliasKey));
});

const sourceLocations = [
  ...CURATED_UGANDA_LOCATION_OVERRIDES,
  ...DETAILED_LOCATIONS,
  ...(administrativeGazetteer.locations || [])
];

const registryByKey = new Map();
sourceLocations.forEach((entry, index) => {
  const name = String(entry.name || '').trim();
  const district = normalizeDistrict(entry.district) || String(entry.district || '').trim();
  if (!name || !DISTRICTS.includes(district)) return;
  const isOverride = index < CURATED_UGANDA_LOCATION_OVERRIDES.length;
  const sourceAliasKeys = [name, ...(entry.aliases || [])].map(normalizeLocationKey).filter(Boolean);
  const sameDistrictOverrideAliases = overrideAliasKeysByDistrict.get(district) || new Set();
  if (!isOverride && sourceAliasKeys.some((aliasKey) => sameDistrictOverrideAliases.has(aliasKey))) return;
  const key = `${normalizeLocationKey(district)}:${normalizeLocationKey(name)}`;
  if (registryByKey.has(key)) return;
  registryByKey.set(key, {
    ...entry,
    name,
    district,
    town: String(entry.town || '').trim()
      || (entry.level === 'city' ? name : `${district} Town`),
    level: entry.level || 'area',
    aliases: Array.from(new Set([name, ...(entry.aliases || [])])).filter(Boolean),
    key
  });
});

const registry = Array.from(registryByKey.values());

// Every valid Uganda district is a searchable canonical node, including
// districts whose neighborhood centroids have not been mapped yet.
Array.from(new Set(canonicalDistrictByKey.values())).forEach((district) => {
  const key = `${normalizeLocationKey(district)}:${normalizeLocationKey(district)}`;
  const existingIndex = registry.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0 && registry[existingIndex].level === 'district') return;
  if (existingIndex >= 0) registry.splice(existingIndex, 1);
  const representative = registry.find((entry) => entry.district === district && entry.level === 'city')
    || registry.find((entry) => entry.district === district);
  registry.push({
    name: district,
    district,
    level: 'district',
    lat: Number.isFinite(representative?.lat) ? representative.lat : null,
    lng: Number.isFinite(representative?.lng) ? representative.lng : null,
    aliases: [district, `${district} District`],
    key
  });
});

const aliasRows = registry
  .flatMap((entry) => entry.aliases.map((alias) => ({
    alias,
    aliasKey: normalizeLocationKey(alias),
    entry
  })))
  .filter((row) => row.aliasKey)
  .sort((a, b) => b.aliasKey.length - a.aliasKey.length);

function isExcludedLocationOnly(value = '') {
  const clean = String(value || '').trim();
  return EXCLUDED_LOCATION_ONLY_PATTERNS.some((pattern) => pattern.test(clean));
}

function aliasAppearsInValue(aliasKey, valueKey) {
  if (aliasKey === valueKey) return true;
  return (` ${valueKey} `).includes(` ${aliasKey} `);
}

const LOCATION_LEVEL_PRIORITY = Object.freeze({
  city: 90,
  town: 80,
  area: 70,
  neighborhood: 50,
  parish: 40,
  subcounty: 30,
  county: 20,
  district: 10,
  region: 0
});

// Free-form source captions should prefer the most specific place mentioned
// (for example Kigo over the broader Entebbe city wording). Exact duplicate
// aliases are ranked separately by selectProminentCandidate below.
const TEXT_LOCATION_LEVEL_PRIORITY = Object.freeze({
  neighborhood: 7,
  area: 7,
  parish: 7,
  town: 6,
  city: 6,
  subcounty: 5,
  county: 4,
  district: 1,
  region: 0
});

const KNOWN_MAJOR_LOCALITY_BY_ALIAS = new Map(Object.entries({
  nakasero: 'kampala:nakasero',
  muyenga: 'kampala:muyenga',
  ndeeba: 'kampala:ndeeba',
  mengo: 'kampala:mengo',
  mmengo: 'kampala:mengo',
  katwe: 'kampala:katwe',
  nsambya: 'kampala:nsambya',
  wandegeya: 'kampala:wandegeya',
  bunga: 'kampala:bunga',
  kasubi: 'kampala:kasubi',
  bukesa: 'kampala:bukesa',
  kabowa: 'kampala:kabowa',
  kyanja: 'kampala:kyanja',
  bukoto: 'kampala:bukoto',
  kikoni: 'kampala:kikoni',
  kanyanya: 'kampala:kanyanya',
  namirembe: 'kampala:namirembe',
  kyebando: 'kampala:kyebando',
  kitende: 'wakiso:kitende',
  gayaza: 'wakiso:gayaza',
  namugongo: 'wakiso:namugongo',
  kisubi: 'wakiso:kisubi',
  kasanje: 'wakiso:kasanje',
  goma: 'mukono:goma',
  lugazi: 'buikwe:lugazi',
  njeru: 'buikwe:njeru'
}));

function districtHintFromQuery(value = '', suppliedDistrict = '') {
  const supplied = normalizeDistrict(suppliedDistrict);
  if (supplied) return supplied;
  const parts = String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
  for (const part of parts.slice(1)) {
    const district = normalizeDistrict(part);
    if (district) return district;
  }
  return '';
}

function exactAliasCandidates(value = '', suppliedDistrict = '', options = {}) {
  const raw = String(value || '').trim();
  const needle = normalizeLocationKey(raw);
  const districtHint = normalizeDistrict(suppliedDistrict);
  if (!needle || isExcludedLocationOnly(raw)) return [];
  if (options.noiseStripped && normalizeDistrict(raw)) return [];
  const matches = aliasRows
    .filter((row) => row.aliasKey === needle)
    .filter((row) => !districtHint || row.entry.district === districtHint)
    .filter((row) => !(options.noiseStripped && row.entry.level === 'district'))
    .map((row) => row.entry);
  const unique = new Map(matches.map((entry) => [entry.key, entry]));
  return Array.from(unique.values()).sort((a, b) => (
    (LOCATION_LEVEL_PRIORITY[b.level] || 0) - (LOCATION_LEVEL_PRIORITY[a.level] || 0)
    || a.name.localeCompare(b.name)
  ));
}

function candidateListingCount(entry, counts = new Map()) {
  if (counts instanceof Map) return Math.max(0, Number(counts.get(entry.key)) || 0);
  return Math.max(0, Number(counts?.[entry.key]) || 0);
}

function selectProminentCandidate(candidates = [], aliasKey = '', counts = new Map()) {
  if (candidates.length <= 1) return candidates[0] || null;
  const ranked = candidates.map((entry) => ({
    entry,
    level: LOCATION_LEVEL_PRIORITY[entry.level] || 0,
    listingCount: candidateListingCount(entry, counts),
    knownMajor: KNOWN_MAJOR_LOCALITY_BY_ALIAS.get(aliasKey) === entry.key ? 1 : 0
  })).sort((a, b) => (
    b.level - a.level
    || b.listingCount - a.listingCount
    || b.knownMajor - a.knownMajor
    || a.entry.name.localeCompare(b.entry.name)
  ));
  const [first, second] = ranked;
  if (first.level > second.level) return first.entry;
  const listingLeadIsClear = first.listingCount >= 3
    && first.listingCount >= Math.max(second.listingCount + 3, second.listingCount * 2);
  if (listingLeadIsClear) return first.entry;
  if (first.knownMajor > second.knownMajor) return first.entry;
  return null;
}

function resolveCanonicalUgandaLocation(value = '', suppliedDistrict = '', options = {}) {
  const districtHint = districtHintFromQuery(value, suppliedDistrict);
  const attempts = locationQueryAttempts(value);
  const firstSegment = String(value || '').split(',')[0].trim();
  if (firstSegment && String(value || '').includes(',')) {
    const firstSegmentKey = normalizeLocationKey(firstSegment);
    if (firstSegmentKey && !attempts.some((attempt) => attempt.normalized === firstSegmentKey)) {
      attempts.unshift({
        value: firstSegment,
        normalized: firstSegmentKey,
        noise_stripped: false
      });
    }
  }
  let candidates = [];
  let matchedAttempt = null;
  for (const attempt of attempts) {
    candidates = exactAliasCandidates(attempt.value, districtHint, { noiseStripped: attempt.noise_stripped });
    if (candidates.length) {
      matchedAttempt = attempt;
      break;
    }
  }
  if (!candidates.length) {
    return { status: 'unmatched', match: null, candidates: [], confidence: 0, match_type: 'unmatched' };
  }
  const firstSegmentKey = matchedAttempt?.normalized || normalizeLocationKey(String(value || '').split(',')[0]);
  const directDistrict = candidates.find((entry) => (
    entry.level === 'district'
    && normalizeLocationKey(entry.district) === firstSegmentKey
  ));
  if (directDistrict && !suppliedDistrict) {
    return {
      status: 'matched',
      match: { ...directDistrict },
      candidates: [{ ...directDistrict }],
      confidence: 1,
      match_type: 'exact_alias',
      matched_query: matchedAttempt?.value || String(value || '').trim()
    };
  }
  const districts = new Set(candidates.map((entry) => entry.district));
  const prominent = districts.size > 1 && !districtHint
    ? selectProminentCandidate(candidates, matchedAttempt?.normalized || '', options.counts)
    : candidates[0];
  if (districts.size > 1 && !districtHint && !prominent) {
    return {
      status: 'ambiguous',
      match: null,
      candidates: candidates.map((entry) => ({ ...entry })),
      confidence: 0,
      match_type: 'ambiguous_exact_alias',
      matched_query: matchedAttempt?.value || String(value || '').trim()
    };
  }
  return {
    status: 'matched',
    match: { ...(prominent || candidates[0]) },
    candidates: candidates.map((entry) => ({ ...entry })),
    confidence: 1,
    match_type: 'exact_alias',
    matched_query: matchedAttempt?.value || String(value || '').trim()
  };
}

const TEXT_LOCATION_ALIAS_STOP_KEYS = new Set([
  'central', 'city', 'district', 'division', 'east', 'home', 'north', 'parish',
  'region', 'south', 'town', 'uganda', 'ward', 'west'
]);

function resolveCanonicalUgandaLocationFromText(value = '', suppliedDistrict = '') {
  const valueKey = normalizeLocationKey(value);
  const suppliedDistrictName = normalizeDistrict(suppliedDistrict);
  if (!valueKey) {
    return { status: 'unmatched', match: null, candidates: [], confidence: 0, match_type: 'unmatched' };
  }

  const found = aliasRows
    .filter((row) => row.aliasKey.length >= 4)
    .filter((row) => !TEXT_LOCATION_ALIAS_STOP_KEYS.has(row.aliasKey))
    .filter((row) => aliasAppearsInValue(row.aliasKey, valueKey))
    .filter((row) => {
      const aliasDistrict = normalizeDistrict(row.aliasKey);
      return !aliasDistrict
        || row.entry.district === aliasDistrict
        || suppliedDistrictName === row.entry.district;
    })
    .filter((row) => !suppliedDistrictName || row.entry.district === suppliedDistrictName)
    .map((row) => ({
      ...row,
      tokenCount: row.aliasKey.split(' ').length,
      levelPriority: TEXT_LOCATION_LEVEL_PRIORITY[row.entry.level] || 0
    }));

  if (!found.length) {
    return { status: 'unmatched', match: null, candidates: [], confidence: 0, match_type: 'unmatched' };
  }

  const bestTokenCount = Math.max(...found.map((row) => row.tokenCount));
  const tokenMatches = found.filter((row) => row.tokenCount === bestTokenCount);
  const bestLevelPriority = Math.max(...tokenMatches.map((row) => row.levelPriority));
  let bestMatches = tokenMatches.filter((row) => row.levelPriority === bestLevelPriority);
  const bestAliasLength = Math.max(...bestMatches.map((row) => row.aliasKey.length));
  bestMatches = bestMatches.filter((row) => row.aliasKey.length === bestAliasLength);

  const unique = new Map(bestMatches.map((row) => [row.entry.key, row.entry]));
  let candidates = Array.from(unique.values());
  if (candidates.length > 1 && !suppliedDistrictName) {
    const mentionedDistricts = Array.from(new Set(
      registry
        .filter((entry) => entry.level === 'district')
        .filter((entry) => entry.aliases.some((alias) => aliasAppearsInValue(normalizeLocationKey(alias), valueKey)))
        .map((entry) => entry.district)
    ));
    if (mentionedDistricts.length === 1) {
      const districtMatches = candidates.filter((entry) => entry.district === mentionedDistricts[0]);
      if (districtMatches.length) candidates = districtMatches;
    }
  }

  if (candidates.length > 1) {
    const candidateKeys = new Set(candidates.map((entry) => entry.key));
    const matchingAliasKeys = new Set(
      bestMatches
        .filter((row) => candidateKeys.has(row.entry.key))
        .map((row) => row.aliasKey)
    );
    if (matchingAliasKeys.size === 1) {
      const [aliasKey] = matchingAliasKeys;
      const prominent = selectProminentCandidate(candidates, aliasKey);
      if (prominent) candidates = [prominent];
    }
  }

  if (candidates.length !== 1) {
    return {
      status: 'ambiguous',
      match: null,
      candidates: candidates.map((entry) => ({ ...entry })),
      confidence: 0,
      match_type: 'ambiguous_exact_alias_in_text'
    };
  }
  return {
    status: 'matched',
    match: { ...candidates[0] },
    candidates: candidates.map((entry) => ({ ...entry })),
    confidence: 1,
    match_type: 'exact_alias_in_text'
  };
}

function canonicalUgandaDistrictsMentionedInText(value = '') {
  const valueKey = normalizeLocationKey(value);
  if (!valueKey) return [];
  const aliases = new Map();
  aliasRows
    .filter((row) => row.aliasKey.length >= 4)
    .filter((row) => !TEXT_LOCATION_ALIAS_STOP_KEYS.has(row.aliasKey))
    .filter((row) => aliasAppearsInValue(row.aliasKey, valueKey))
    .forEach((row) => {
      if (!aliases.has(row.aliasKey)) aliases.set(row.aliasKey, new Set());
      aliases.get(row.aliasKey).add(row.entry.district);
    });

  const mentions = [];
  aliases.forEach((districts, aliasKey) => {
    // An unqualified alias shared by districts is not safe evidence.
    if (districts.size !== 1) return;
    mentions.push({
      district: Array.from(districts)[0],
      position: (` ${valueKey} `).indexOf(` ${aliasKey} `)
    });
  });
  return Array.from(new Map(
    mentions
      .sort((a, b) => a.position - b.position)
      .map((mention) => [mention.district, mention.district])
  ).values());
}

function canonicalizeUgandaLocation(area = '', district = '') {
  const rawArea = String(area || '').split(',')[0].trim();
  const districtName = normalizeDistrict(district);
  if (!rawArea && !districtName) return null;

  if (rawArea) {
    const resolution = resolveCanonicalUgandaLocation(area, districtName);
    if (resolution.status === 'matched') return resolution.match;
    if (isExcludedLocationOnly(rawArea)) return null;
  }

  const areaDistrict = normalizeDistrict(rawArea);
  if (rawArea && !areaDistrict) return null;
  const fallbackDistrict = areaDistrict || districtName;
  if (!fallbackDistrict) return null;
  const existing = registry.find((entry) => entry.level === 'district' && entry.district === fallbackDistrict);
  if (existing) return { ...existing };
  return {
    name: fallbackDistrict,
    district: fallbackDistrict,
    level: 'district',
    lat: null,
    lng: null,
    aliases: [fallbackDistrict],
    key: `${normalizeLocationKey(fallbackDistrict)}:${normalizeLocationKey(fallbackDistrict)}`
  };
}

function aliasesForCanonicalLocation(location = {}) {
  const key = location.key || `${normalizeLocationKey(location.district)}:${normalizeLocationKey(location.name)}`;
  const matched = registry.find((entry) => entry.key === key);
  return (matched?.aliases || [location.name]).map(normalizeLocationKey).filter(Boolean);
}

function aliasesForDistrict(district = '') {
  const canonicalDistrict = normalizeDistrict(district);
  return Array.from(new Set(
    registry
      .filter((entry) => entry.district === canonicalDistrict)
      .flatMap((entry) => entry.aliases)
      .map(normalizeLocationKey)
      .filter(Boolean)
  ));
}

function canonicalizeLocationRows(rows = []) {
  const aggregates = new Map();
  rows.forEach((row) => {
    const canonicalId = row.canonical_location_id
      || row?.extra_fields?.canonical_location_id
      || row?.admin_extra_fields?.canonical_location_id;
    const canonical = canonicalLocationByKey(canonicalId)
      || canonicalizeUgandaLocation('', row.district);
    if (!canonical) return;
    const count = Math.max(0, Number(row.listing_count) || 0);
    const existing = aggregates.get(canonical.key) || {
      canonical_key: canonical.key,
      location: canonical.name,
      district: canonical.district,
      level: canonical.level,
      latitude: Number.isFinite(canonical.lat) ? canonical.lat : null,
      longitude: Number.isFinite(canonical.lng) ? canonical.lng : null,
      aliases: canonical.aliases || [canonical.name],
      listing_count: 0
    };
    existing.listing_count += count;
    aggregates.set(canonical.key, existing);
  });
  return Array.from(aggregates.values())
    .filter((row) => row.listing_count > 0)
    .sort((a, b) => b.listing_count - a.listing_count || a.location.localeCompare(b.location));
}

function canonicalLocationOptions() {
  return registry.map((entry) => ({
    canonical_key: entry.key,
    location: entry.name,
    district: entry.district,
    town: entry.town,
    level: entry.level,
    latitude: Number.isFinite(entry.lat) ? entry.lat : null,
    longitude: Number.isFinite(entry.lng) ? entry.lng : null,
    aliases: entry.aliases,
    listing_count: 0
  }));
}

function canonicalLocationByKey(value = '') {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  const matched = registry.find((entry) => entry.key === key);
  return matched ? { ...matched, aliases: [...matched.aliases] } : null;
}

function canonicalLocationForRow(row = {}) {
  const extra = row?.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const adminExtra = row?.admin_extra_fields && typeof row.admin_extra_fields === 'object' ? row.admin_extra_fields : {};
  const canonicalId = row.canonical_location_id
    || extra.canonical_location_id
    || adminExtra.canonical_location_id;
  return canonicalLocationByKey(canonicalId)
    || canonicalizeUgandaLocation('', row.district);
}

function canonicalDisplayLocationForRow(row = {}) {
  const canonical = canonicalLocationForRow(row);
  if (!canonical) {
    return { canonical: null, area: null, district: normalizeDistrict(row.district) || null, level: null };
  }
  return {
    canonical,
    area: ['district', 'region'].includes(canonical.level) ? null : canonical.name,
    district: canonical.district,
    level: canonical.level
  };
}

function trigrams(value = '') {
  const normalized = `  ${normalizeLocationKey(value)} `;
  const grams = new Set();
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

function trigramSimilarity(left = '', right = '') {
  const a = trigrams(left);
  const b = trigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((gram) => {
    if (b.has(gram)) overlap += 1;
  });
  return (2 * overlap) / (a.size + b.size);
}

function levenshteinDistance(left = '', right = '') {
  const a = normalizeLocationKey(left);
  const b = normalizeLocationKey(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function editSimilarity(left = '', right = '') {
  const a = normalizeLocationKey(left);
  const b = normalizeLocationKey(right);
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - (levenshteinDistance(a, b) / longest) : 0;
}

function canonicalLocationSuggestions(query = '', counts = new Map(), limit = 8) {
  const attempts = locationQueryAttempts(query);
  const freeTextAttempts = freeTextLocationQueryAttempts(query);
  if (!attempts.length && !freeTextAttempts.length) return [];
  const exactResolution = resolveCanonicalUgandaLocation(query, '', { counts });
  const resolutionCandidateKeys = new Set(exactResolution.candidates.map((entry) => entry.key));
  const searchableAttempts = attempts.filter((attempt) => (
    !isExcludedLocationOnly(attempt.value)
    && !(attempt.noise_stripped && normalizeDistrict(attempt.value))
  ));
  const scoreEntry = (entry) => {
    const aliasKeys = entry.aliases.map(normalizeLocationKey).filter(Boolean);
    const exactAttemptIndex = attempts.findIndex((attempt) => (
      aliasKeys.includes(attempt.normalized)
      && !(attempt.noise_stripped && normalizeDistrict(attempt.value))
    ));
    const selectedExact = exactResolution.status === 'matched'
      && exactResolution.match?.key === entry.key;
    const resolutionExact = exactResolution.status === 'matched'
      && resolutionCandidateKeys.has(entry.key);
    const exact = exactAttemptIndex >= 0 || resolutionExact;
    const freeTextMatches = freeTextAttempts
      .map((attempt) => ({ attempt, aliasIndex: aliasKeys.indexOf(attempt.normalized) }))
      .filter((match) => match.aliasIndex >= 0)
      .sort((left, right) => (
        right.attempt.token_count - left.attempt.token_count
        || left.attempt.position - right.attempt.position
      ));
    const freeTextMatch = !exact ? freeTextMatches[0] : null;
    const comparableNeedles = searchableAttempts.map((attempt) => attempt.normalized);
    const prefix = !exact && !freeTextMatch && comparableNeedles.some((needle) => aliasKeys.some((alias) => alias.startsWith(needle)));
    const contains = !exact && !freeTextMatch && comparableNeedles.some((needle) => aliasKeys.some((alias) => alias.includes(needle)));
    const fuzzyPairs = comparableNeedles.flatMap((needle) => aliasKeys.map((alias) => ({
      alias,
      score: Math.max(trigramSimilarity(needle, alias), editSimilarity(needle, alias))
    })));
    const bestFuzzy = fuzzyPairs.sort((left, right) => right.score - left.score)[0];
    const fuzzy = comparableNeedles.length
      ? bestFuzzy?.score || 0
      : 0;
    const fuzzyEligible = comparableNeedles.some((needle) => needle.length >= 5);
    const matchRank = exact ? 5 : freeTextMatch ? 4 : prefix ? 3 : contains ? 2 : (fuzzyEligible && fuzzy >= 0.72) ? 1 : 0;
    if (!matchRank) return null;
    const alternativeExact = resolutionExact && !selectedExact;
    const prominentAlias = bestFuzzy?.alias || freeTextMatch?.attempt.normalized || '';
    const knownMajor = KNOWN_MAJOR_LOCALITY_BY_ALIAS.get(prominentAlias) === entry.key;
    return {
      canonical_key: entry.key,
      location: entry.name,
      district: entry.district,
      town: entry.town,
      level: entry.level,
      latitude: Number.isFinite(entry.lat) ? entry.lat : null,
      longitude: Number.isFinite(entry.lng) ? entry.lng : null,
      aliases: [...entry.aliases],
      listing_count: Number(counts.get(entry.key) || 0),
      match: exact ? (alternativeExact ? 'alternative_exact_alias' : 'exact_alias') : freeTextMatch ? 'free_text_exact' : prefix ? 'prefix' : contains ? 'contains' : 'fuzzy',
      did_you_mean: alternativeExact || Boolean(freeTextMatch) || (!exact && !prefix && !contains),
      match_rank: matchRank,
      score: matchRank * 10 + (freeTextMatch ? 0 : fuzzy)
        + (exact ? Math.max(0, 1 - (exactAttemptIndex * 0.01)) : 0)
        + (freeTextMatch ? Math.max(0, 1 - (freeTextMatch.attempt.position * 0.1)) + (freeTextMatch.attempt.token_count * 0.01) : 0),
      confidence: exact || freeTextMatch ? 1 : prefix ? 0.94 : contains ? 0.88 : Number(fuzzy.toFixed(3)),
      auto_resolvable: selectedExact,
      known_major: knownMajor,
      free_text_position: freeTextMatch?.attempt.position ?? null
    };
  };
  const ranked = registry
    .map(scoreEntry)
    .filter(Boolean)
    .sort((a, b) => b.match_rank - a.match_rank
      || Number(b.auto_resolvable) - Number(a.auto_resolvable)
      || ((a.match === 'free_text_exact' && b.match === 'free_text_exact') ? (a.free_text_position - b.free_text_position) : 0)
      || Number(b.known_major) - Number(a.known_major)
      || b.listing_count - a.listing_count
      || b.score - a.score
      || a.location.localeCompare(b.location));
  const exactRanked = exactResolution.status === 'matched'
    ? ranked.filter((entry) => resolutionCandidateKeys.has(entry.canonical_key))
    : ranked;
  return exactRanked.slice(0, Math.max(1, Math.min(8, Number(limit) || 8)));
}

function canonicalLocationSearchScope(keys = [], nearbyKm = 0) {
  const selected = Array.from(new Set(keys))
    .map(canonicalLocationByKey)
    .filter(Boolean)
    .slice(0, 5);
  const exact = new Map();
  const nearby = new Map();
  const radius = Math.max(0, Math.min(7, Number(nearbyKm) || 0));
  selected.forEach((location) => {
    exact.set(location.key, location);
    // Exact means the requested canonical ID only. City and district nodes used
    // to expand silently here, which made nearby=0 return other areas.
    if (!radius) return;
    registry
      .filter((entry) => entry.level !== 'district' && entry.key !== location.key)
      .forEach((entry) => {
        const distance = haversineKm(location, entry);
        if (distance != null && distance <= radius && !exact.has(entry.key)) {
          nearby.set(entry.key, { ...entry, distance_km: Number(distance.toFixed(2)) });
        }
      });
  });
  return {
    selected,
    exact: Array.from(exact.values()),
    nearby: Array.from(nearby.values()).sort((a, b) => a.distance_km - b.distance_km),
  };
}

function canonicalLocationRollupCounts(counts = new Map()) {
  const direct = counts instanceof Map ? counts : new Map(Object.entries(counts || {}));
  const rolled = new Map(direct);
  registry.forEach((location) => {
    if (!['city', 'district'].includes(location.level)) return;
    const descendants = location.level === 'district'
      ? registry.filter((entry) => entry.district === location.district)
      : registry.filter((entry) => {
        if (entry.district !== location.district) return false;
        const distance = haversineKm(location, entry);
        return distance != null && distance <= 7;
      });
    const total = descendants.reduce((sum, child) => sum + Math.max(0, Number(direct.get(child.key)) || 0), 0);
    rolled.set(location.key, total);
  });
  return rolled;
}

function haversineKm(a = {}, b = {}) {
  if (![a.lat, a.lng, b.lat, b.lng].every((value) => Number.isFinite(Number(value)))) return null;
  const toRadians = (degrees) => (Number(degrees) * Math.PI) / 180;
  const dLat = toRadians(Number(b.lat) - Number(a.lat));
  const dLng = toRadians(Number(b.lng) - Number(a.lng));
  const chord = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord)));
}

module.exports = {
  CANONICAL_LOCATION_COUNT: registry.length,
  canonicalLocationByKey,
  canonicalLocationForRow,
  canonicalDisplayLocationForRow,
  canonicalizeUgandaLocation,
  resolveCanonicalUgandaLocation,
  resolveCanonicalUgandaLocationFromText,
  canonicalUgandaDistrictsMentionedInText,
  canonicalizeLocationRows,
  canonicalLocationOptions,
  canonicalLocationRollupCounts,
  canonicalLocationSearchScope,
  canonicalLocationSuggestions,
  aliasesForCanonicalLocation,
  aliasesForDistrict,
  normalizeDistrict,
  normalizeLocationKey,
  normalizeLocationQueryCandidates,
  freeTextLocationQueryAttempts,
  haversineKm,
  isExcludedLocationOnly,
  trigramSimilarity,
  editSimilarity
};
