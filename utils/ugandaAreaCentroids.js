'use strict';

/**
 * Points for catalogue areas that had none, so the list-property map can name
 * the nearest known area to a pin (26 Oct 2026, "Kira Junior School" left the
 * region/district/area empty).
 *
 * Source: OpenStreetMap Nominatim place nodes (data © OpenStreetMap
 * contributors, ODbL), cached lookups at about one request a second, with a
 * proper application User-Agent and no runtime geocoding. The first batch
 * was on 26 Oct 2026. A second batch on 10 Nov 2026 filled catalogue areas
 * that still had no point, so unpinned live listings could be auto-pinned at
 * the area centre. A point was kept only when the OSM name matched, the OSM
 * object was a place, boundary, or (for Zitwe and Nkumba) a named school or
 * university in that place, it was in the same district (or, for Namulanda
 * and Nkumba, in Entebbe City, which OSM split out of Wakiso), and it was
 * checked against the listing's district. Areas OSM placed in a different
 * district, or where the only live listing's title named a different place,
 * were left out rather than guessed. Kampala Bukasa is now included from
 * the Makindye suburb node.
 */
const UGANDA_AREA_CENTROIDS = Object.freeze([
  { district: 'Buikwe', name: 'Zitwe', lat: 0.1189, lng: 32.9588 }, // node/4027565984 Zitwe Primary School, 10 Nov 2026
  { district: 'Kampala', name: 'Bakuli', lat: 0.313, lng: 32.5641 }, // node/9635351902
  { district: 'Kampala', name: 'Bukasa', lat: 0.2891, lng: 32.6269 }, // node/583203193 suburb, Makindye, 10 Nov 2026
  { district: 'Kampala', name: 'Butabika', lat: 0.3191, lng: 32.6567 }, // node/9635290216
  { district: 'Kampala', name: 'Kagugube', lat: 0.3268, lng: 32.5678 }, // node/9626381893
  { district: 'Kampala', name: 'Kalinabiri', lat: 0.3609, lng: 32.6103 }, // node/9635290265
  { district: 'Kampala', name: 'Katwe I', lat: 0.2952, lng: 32.5742 }, // relation/10548163
  { district: 'Kampala', name: 'Kawaala', lat: 0.343, lng: 32.5502 }, // node/2317915139
  { district: 'Kampala', name: 'Kibuli', lat: 0.3117, lng: 32.5958 }, // node/609009114
  { district: 'Kampala', name: 'Kibuye I', lat: 0.2936, lng: 32.5757 }, // relation/10548162
  { district: 'Kampala', name: 'Kibuye Ii', lat: 0.2908, lng: 32.5729 }, // relation/10546827
  { district: 'Kampala', name: 'Kigowa', lat: 0.3617, lng: 32.6133 }, // node/2321067285
  { district: 'Kampala', name: 'Kikaya', lat: 0.3657, lng: 32.5868 }, // node/2321012259
  { district: 'Kampala', name: 'Kinawataka', lat: 0.3328, lng: 32.632 }, // node/9635290261
  { district: 'Kampala', name: 'Kisugu', lat: 0.3025, lng: 32.6037 }, // node/583203195
  { district: 'Kampala', name: 'Kiswa', lat: 0.3234, lng: 32.6128 }, // node/582809248
  { district: 'Kampala', name: 'Kitebi', lat: 0.2735, lng: 32.5469 }, // node/3911665471
  { district: 'Kampala', name: 'Kitintale', lat: 0.3093, lng: 32.6376 }, // node/582813166
  { district: 'Kampala', name: 'Kulambiro', lat: 0.3744, lng: 32.6089 }, // node/1152720979
  { district: 'Kampala', name: 'Kyambogo', lat: 0.3562, lng: 32.6267 }, // node/602638401
  { district: 'Kampala', name: 'Lubya', lat: 0.3319, lng: 32.5452 }, // node/2085494881
  { district: 'Kampala', name: 'Lugogo', lat: 0.3272, lng: 32.6036 }, // node/2316887641
  { district: 'Kampala', name: 'Lukuli', lat: 0.2866, lng: 32.5879 }, // node/2321491273
  { district: 'Kampala', name: 'Lusaze', lat: 0.3211, lng: 32.5444 }, // node/9635392876
  { district: 'Kampala', name: 'Luwafu', lat: 0.2715, lng: 32.5943 }, // node/2321514995
  { district: 'Kampala', name: 'Luzira', lat: 0.2975, lng: 32.6528 }, // node/2229118215
  { district: 'Kampala', name: 'Luzira Prisons', lat: 0.298, lng: 32.6402 }, // node/9635278798
  { district: 'Kampala', name: 'Makindye Ii', lat: 0.2818, lng: 32.5786 }, // relation/10548558
  { district: 'Kampala', name: 'Mbuya', lat: 0.3226, lng: 32.6266 }, // node/582809250
  { district: 'Kampala', name: 'Mutundwe', lat: 0.2827, lng: 32.5327 }, // node/2259657962
  { district: 'Kampala', name: 'Mutungo', lat: 0.3159, lng: 32.6426 }, // node/582809402
  { district: 'Kampala', name: 'Nabulagala', lat: 0.3245, lng: 32.551 }, // node/9635392865
  { district: 'Kampala', name: 'Naguru I', lat: 0.3309, lng: 32.6099 }, // node/9635290163
  { district: 'Kampala', name: 'Nakivubo', lat: 0.3114, lng: 32.5749 }, // node/2320948710
  { district: 'Kampala', name: 'Nakulabye', lat: 0.3281, lng: 32.5635 }, // node/294017597
  { district: 'Kampala', name: 'Namungoona', lat: 0.3329, lng: 32.5407 }, // node/2317915140
  { district: 'Kampala', name: 'Namuwongo', lat: 0.3116, lng: 32.6007 }, // node/583203196
  { district: 'Kampala', name: 'Nsambya Central', lat: 0.3041, lng: 32.5864 }, // node/9626452752
  { district: 'Kampala', name: 'Nsooba', lat: 0.3495, lng: 32.5747 }, // node/2295438006
  { district: 'Kampala', name: 'Salaama', lat: 0.248, lng: 32.615 }, // node/2321535930
  { district: 'Kampala', name: 'Wankulukuku', lat: 0.2815, lng: 32.553 }, // node/9635392855
  { district: 'Luwero', name: 'Bombo', lat: 0.577, lng: 32.537 }, // node/3533063859 town, 10 Nov 2026
  { district: 'Luwero', name: 'Busiika', lat: 0.596, lng: 32.6565 }, // node/2229102582 village Busika, 10 Nov 2026
  { district: 'Luwero', name: 'Busika', lat: 0.596, lng: 32.6565 }, // node/2229102582 same place, catalogue spelling, 10 Nov 2026
  { district: 'Luwero', name: 'Kamira', lat: 0.9554, lng: 32.6804 }, // node/3315059248 village, 10 Nov 2026
  { district: 'Mpigi', name: 'Sekiwunga', lat: 0.2718, lng: 32.4117 }, // node/9660234445 village, 10 Nov 2026
  { district: 'Mukono', name: 'Kabembe', lat: 0.4461, lng: 32.7628 }, // node/2229109173
  { district: 'Mukono', name: 'Ddundu', lat: 0.4836, lng: 32.7128 }, // node/9413114634 village, 10 Nov 2026
  { district: 'Mukono', name: 'Kasawo', lat: 0.6792, lng: 32.8269 }, // node/13316968017
  { district: 'Mukono', name: 'Kigunga', lat: 0.3692, lng: 32.7263 }, // node/9427419839
  { district: 'Mukono', name: 'Kyampisi', lat: 0.5017, lng: 32.7189 }, // node/2229117785
  { district: 'Mukono', name: 'Mayangayanga', lat: 0.4293, lng: 32.8926 }, // node/9395191496 village, 10 Nov 2026
  { district: 'Mukono', name: 'Nakifuma', lat: 0.5436, lng: 32.79 }, // node/2229120592
  { district: 'Mukono', name: 'Namataba', lat: 0.3906, lng: 32.8706 }, // node/2229120799
  { district: 'Mukono', name: 'Namumira', lat: 0.3302, lng: 32.7592 }, // node/9430864146
  { district: 'Mukono', name: 'Nantabulirwa', lat: 0.3546, lng: 32.7017 }, // node/9427419855
  { district: 'Mukono', name: 'Nasuuti', lat: 0.3742, lng: 32.7576 }, // node/4150930694
  { district: 'Mukono', name: 'Nsanja', lat: 0.1682, lng: 32.7894 }, // node/9360635071
  { district: 'Mukono', name: 'Nyenje', lat: 0.4, lng: 32.7333 }, // node/2229122960
  { district: 'Wakiso', name: 'Akright City', lat: 0.3303, lng: 32.677 }, // way/303073186 Akright Estate, Kirinnya, 10 Nov 2026
  { district: 'Wakiso', name: 'Bukalango', lat: 0.4247, lng: 32.414 }, // node/4895269249
  { district: 'Wakiso', name: 'Bulenga', lat: 0.3216, lng: 32.5031 }, // node/2229101503
  { district: 'Wakiso', name: 'Bunamwaya', lat: 0.2651, lng: 32.546 }, // node/3911468159
  { district: 'Wakiso', name: 'Busabala', lat: 0.2097, lng: 32.6178 }, // node/5163763464
  { district: 'Wakiso', name: 'Busujja', lat: 0.4493, lng: 32.384 }, // node/9636088428
  { district: 'Wakiso', name: 'Busukuma', lat: 0.5074, lng: 32.6085 }, // node/9635363657
  { district: 'Wakiso', name: 'Buwaate', lat: 0.4062, lng: 32.6216 }, // node/9645561471
  { district: 'Wakiso', name: 'Buwambo', lat: 0.5028, lng: 32.548 }, // node/2229104169
  { district: 'Wakiso', name: 'Kabojja', lat: 0.2935, lng: 32.5067 }, // node/9645572810
  { district: 'Wakiso', name: 'Kamuli', lat: 0.4669, lng: 32.3776 }, // node/9635990341
  { district: 'Wakiso', name: 'Kasenge', lat: 0.259, lng: 32.5073 }, // node/3998327649
  { district: 'Wakiso', name: 'Katalemwa', lat: 0.4445, lng: 32.5235 }, // node/9635585025
  { district: 'Wakiso', name: 'Katereke', lat: 0.2878, lng: 32.4392 }, // node/2229112634
  { district: 'Wakiso', name: 'Kawanda', lat: 0.4173, lng: 32.5355 }, // node/3632456748
  { district: 'Wakiso', name: 'Kikajjo', lat: 0.2576, lng: 32.5175 }, // node/5513729060
  { district: 'Wakiso', name: 'Kikandwa', lat: 0.4437, lng: 32.3524 }, // node/9635990332
  { district: 'Wakiso', name: 'Kikubampanga', lat: 0.4188, lng: 32.4102 }, // node/9636088432
  { district: 'Wakiso', name: 'Kimwanyi', lat: 0.4489, lng: 32.6376 }, // node/9645561469
  { district: 'Wakiso', name: 'Kisozi', lat: 0.2486, lng: 32.486 }, // node/3998327651
  { district: 'Wakiso', name: 'Kiteezi', lat: 0.4176, lng: 32.5715 }, // node/2229117174
  { district: 'Wakiso', name: 'Kitukutwe', lat: 0.4427, lng: 32.6574 }, // node/9645561473
  { district: 'Wakiso', name: 'Kiwenda', lat: 0.5511, lng: 32.6249 }, // node/9635363639
  { district: 'Wakiso', name: 'Kiwologoma', lat: 0.4374, lng: 32.6458 }, // node/9645561478
  { district: 'Wakiso', name: 'Lugeye', lat: 0.4421, lng: 32.4004 }, // node/9636088425
  { district: 'Wakiso', name: 'Luwunga', lat: 0.4, lng: 32.4 }, // node/2229118210
  { district: 'Wakiso', name: 'Lweza', lat: 0.2246, lng: 32.5475 }, // node/292850772
  { district: 'Wakiso', name: 'Magoggo', lat: 0.4374, lng: 32.3155 }, // node/9635990343
  { district: 'Wakiso', name: 'Manyangwa', lat: 0.4636, lng: 32.625 }, // node/3409287615
  { district: 'Wakiso', name: 'Masajja', lat: 0.2741, lng: 32.5723 }, // node/2321514992
  { district: 'Wakiso', name: 'Masooli', lat: 0.4167, lng: 32.5833 }, // node/2229119175
  { district: 'Wakiso', name: 'Mbalwa', lat: 0.3643, lng: 32.6496 }, // node/2321082818
  { district: 'Wakiso', name: 'Mutungo', lat: 0.2097, lng: 32.5778 }, // node/9651787410 village, Kigo Road, 10 Nov 2026
  { district: 'Wakiso', name: 'Nakwero', lat: 0.4667, lng: 32.65 }, // node/2229120652
  { district: 'Wakiso', name: 'Nalumunye', lat: 0.2617, lng: 32.527 }, // node/2194033578
  { district: 'Wakiso', name: 'Namayumba', lat: 0.5289, lng: 32.2486 }, // node/2229120806
  { district: 'Wakiso', name: 'Namulanda', lat: 0.1522, lng: 32.544 }, // node/292850769 village; OSM files this under Entebbe City, 10 Nov 2026
  { district: 'Wakiso', name: 'Namulonge', lat: 0.5256, lng: 32.6137 }, // node/2229121073
  { district: 'Wakiso', name: 'Namusera', lat: 0.4139, lng: 32.463 }, // node/9651812329 village, 10 Nov 2026
  { district: 'Wakiso', name: 'Nampunge', lat: 0.4667, lng: 32.3167 }, // node/2229120920 village, 10 Nov 2026
  { district: 'Wakiso', name: 'Nangabo', lat: 0.4403, lng: 32.5837 }, // node/9636713962
  { district: 'Wakiso', name: 'Nkoowe', lat: 0.4156, lng: 32.4423 }, // node/9651772017
  { district: 'Wakiso', name: 'Nkumba', lat: 0.0948, lng: 32.507 }, // way/798396777 Nkumba University; OSM files this under Entebbe City, 10 Nov 2026
  { district: 'Wakiso', name: 'Nyanama', lat: 0.2709, lng: 32.5537 }, // node/2321506573
  { district: 'Wakiso', name: 'Sentema', lat: 0.3683, lng: 32.4056 }, // node/2229127520
].map((item) => Object.freeze(item)));

module.exports = { UGANDA_AREA_CENTROIDS };
