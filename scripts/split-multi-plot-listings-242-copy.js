'use strict';

// Copy and guards for data fix 242. Kept free of database requires so
// tests can load the expected titles, prices and descriptions.

const MARKER = 'split_listings_242';

const COPY = Object.freeze({
  p5t3f: Object.freeze({
    ref: 'MK-20261120-P5T3F',
    guard: `status = 'pending' AND area = 'Kawuku' AND title = '20 acres for sale in Kawuku, Entebbe' AND description ILIKE '%Bussi Island%'`,
    sourceTitle: '20 acres for sale in Kawuku, Entebbe',
    sourceDescription: '20 titled acres for sale in Kawuku, Entebbe, at UGX 260 million per acre. The land is squatter-free, sits directly on the lake, and can be viewed from Entebbe. It is suitable for real estate or recreation.',
    sourceNote: 'Split per Arthur 20 Nov 2026: this row is the Kawuku 20-acre listing only. The Bussi Island 9-acre offer is a new pending listing. Data fix 242.',
    child: Object.freeze({
      key: 'bussi',
      title: '9 acres for sale on Bussi Island',
      description: '9 titled acres for sale on Bussi Island at UGX 160 million per acre. The land is squatter-free, sits directly on the lake, and can be viewed from Entebbe. It is suitable for real estate or recreation.',
      area: 'Bussi',
      district: 'Wakiso',
      address: 'Bussi Island, Wakiso',
      listingType: 'land',
      propertyType: 'Residential Plot',
      titleType: 'Mailo',
      landSizeValue: 9,
      landSizeUnit: 'acres',
      price: 160000000,
      pricePeriod: 'acre',
      latitude: 0.04917,
      longitude: 32.32667,
      copyPhotos: true,
      locationExtra: {
        city: 'Bussi',
        neighborhood: 'Bussi',
        region: 'Central',
        canonical_location_id: 'wakiso:bussi',
        canonical_location_level: 'subcounty',
        canonical_location_match: 'staff_correction',
        canonical_location_confidence: 1,
        location_resolution_status: 'canonical_staff_edit',
        resolved_location_label: 'Bussi Island, Wakiso, Central',
        staff_location_confirmed: false
      },
      note: 'Created per Arthur 20 Nov 2026 by splitting MK-20261120-P5T3F. Photos were copied from the original combined advert; confirm they belong to this Bussi Island land before approval. Data fix 242.'
    })
  }),
  sta5: Object.freeze({
    ref: 'MK-20261120-8STA5',
    guard: `status = 'approved' AND area = 'Bwaise' AND title = 'Commercial plots for sale in Bwaise and Kawempe' AND price = 250000000`,
    sourceTitle: 'Commercial plot for sale in Bwaise',
    sourceDescription: 'A 50-by-100-foot Kabaka’s land plot for sale in Bwaise town, one plot off the tarmac, at UGX 300 million. It is suitable for an apartment or garage.',
    sourcePrice: 300000000,
    sourcePricePeriod: 'once',
    clearLandSize: true,
    sourceNote: 'Split per Arthur 20 Nov 2026: this live row is the Bwaise plot only, at the advert price of UGX 300 million (was UGX 250 million, which did not match the advert). The stored land size of 50 with no unit was cleared; the advert says 50 by 100 feet. Three Kawempe plots from the same advert are new pending listings. Photos stayed on this row because they show one roadside plot and could not be assigned to the other locations. Data fix 242.',
    children: Object.freeze([
      Object.freeze({
        key: 'kawempe_8_decimals',
        title: '8-decimal commercial plot for sale in Kawempe',
        description: 'An 8-decimal titled commercial plot for sale in Kawempe at UGX 300 million.',
        area: 'Kawempe',
        district: 'Kampala',
        address: 'Kawempe, Kampala',
        listingType: 'land',
        propertyType: 'Commercial Plot',
        titleType: null,
        landSizeValue: 8,
        landSizeUnit: 'decimals',
        price: 300000000,
        pricePeriod: 'once',
        copyPhotos: false,
        locationExtra: {
          city: 'Kawempe',
          neighborhood: 'Kawempe',
          region: 'Central',
          canonical_location_id: 'kampala:kawempe',
          canonical_location_level: 'city',
          canonical_location_match: 'staff_correction',
          canonical_location_confidence: 1,
          location_resolution_status: 'canonical_staff_edit',
          resolved_location_label: 'Kawempe, Kampala, Central',
          staff_location_confirmed: false,
          land_title_available: 'yes'
        },
        note: 'Created per Arthur 20 Nov 2026 by splitting MK-20261120-8STA5. This is the 8-decimal titled Kawempe plot at UGX 300 million. Photos from the combined advert were left on the Bwaise listing; attach the right photos before approval. Data fix 242.'
      }),
      Object.freeze({
        key: 'kawempe_town_12',
        title: '12-decimal commercial plot for sale in Kawempe town',
        description: 'A 12-decimal commercial plot for sale in Kawempe town, one plot off Ttula Road, at UGX 350 million. It is suitable for an apartment or garage.',
        area: 'Kawempe',
        district: 'Kampala',
        address: 'Ttula Road, Kawempe town, Kampala',
        listingType: 'land',
        propertyType: 'Commercial Plot',
        titleType: null,
        landSizeValue: 12,
        landSizeUnit: 'decimals',
        price: 350000000,
        pricePeriod: 'once',
        copyPhotos: false,
        locationExtra: {
          city: 'Kawempe',
          neighborhood: 'Kawempe',
          region: 'Central',
          canonical_location_id: 'kampala:kawempe',
          canonical_location_level: 'city',
          canonical_location_match: 'staff_correction',
          canonical_location_confidence: 1,
          location_resolution_status: 'canonical_staff_edit',
          resolved_location_label: 'Kawempe, Kampala, Central',
          street_name: 'Ttula Road',
          staff_location_confirmed: false
        },
        note: 'Created per Arthur 20 Nov 2026 by splitting MK-20261120-8STA5. This is the 12-decimal Kawempe town plot, one plot off Ttula Road, at UGX 350 million. Photos from the combined advert were left on the Bwaise listing; attach the right photos before approval. Data fix 242.'
      }),
      Object.freeze({
        key: 'kawempe_hospital_12',
        title: '12-decimal commercial plot for sale near Kawempe Hospital',
        description: 'A 12-decimal commercial plot for sale near Kawempe Hospital, two plots off Bombo Road, at UGX 360 million. It is suitable for an apartment or garage.',
        area: 'Kawempe',
        district: 'Kampala',
        address: 'Bombo Road, near Kawempe Hospital, Kawempe, Kampala',
        listingType: 'land',
        propertyType: 'Commercial Plot',
        titleType: null,
        landSizeValue: 12,
        landSizeUnit: 'decimals',
        price: 360000000,
        pricePeriod: 'once',
        copyPhotos: false,
        locationExtra: {
          city: 'Kawempe',
          neighborhood: 'Kawempe',
          region: 'Central',
          canonical_location_id: 'kampala:kawempe',
          canonical_location_level: 'city',
          canonical_location_match: 'staff_correction',
          canonical_location_confidence: 1,
          location_resolution_status: 'canonical_staff_edit',
          resolved_location_label: 'Kawempe, Kampala, Central',
          street_name: 'Bombo Road',
          staff_location_confirmed: false
        },
        note: 'Created per Arthur 20 Nov 2026 by splitting MK-20261120-8STA5. This is the 12-decimal plot near Kawempe Hospital, two plots off Bombo Road, at UGX 360 million. Photos from the combined advert were left on the Bwaise listing; attach the right photos before approval. Data fix 242.'
      })
    ])
  }),
  y2urd: Object.freeze({
    ref: 'MK-20261120-Y2URD',
    guard: `status = 'pending' AND area = 'Namanve' AND title = '3 warehouses for sale in Namanve' AND price IS NULL`,
    title: '3 warehouses for sale in Namanve',
    description: 'Three detached warehouse units plus office space for sale in Namanve, on a 4-acre plot, at USD 1,950,000.',
    usd: 1950000,
    note: 'Price set per Arthur 20 Nov 2026 to USD 1,950,000, converted to UGX at the site rate. Land size 4 acres and type Warehouse were already on the row. Left pending. Data fix 242.'
  })
});

module.exports = { COPY, MARKER };
