'use strict';

module.exports = Object.freeze({
  countryCode: 'ZA',
  countryName: 'South Africa',
  brand: 'seshaikhaya',
  domain: 'https://seshaikhaya.com',
  currency: Object.freeze({ primary: 'ZAR', supported: ['ZAR', 'USD', 'EUR', 'GBP'] }),
  phoneCountryCode: '+27',
  timezone: 'Africa/Johannesburg',
  locationHierarchy: Object.freeze(['province', 'city', 'suburb']),
  lookbackDays: 183,
  autoPublishFoundOnline: false,
  sourceChannels: Object.freeze(['facebook', 'tiktok', 'youtube', 'x', 'instagram']),
  sourceQueries: Object.freeze([
    '#propertysouthafrica',
    '#housesforsaleSA',
    '#capetownproperty',
    '#joburgproperty',
    '#durbanproperty',
    '#sandton property',
    '#propertyforsale South Africa',
    'huis te koop',
    'eiendom te koop',
    'house to rent South Africa',
    'student accommodation South Africa',
    'commercial property South Africa',
    'land for sale South Africa'
  ]),
  cityQueries: Object.freeze([
    'Johannesburg property', 'Cape Town property', 'Durban property', 'Pretoria property',
    'Tshwane property', 'Ekurhuleni property', 'Gqeberha property', 'Bloemfontein property',
    'East London property', 'Polokwane property', 'Mbombela property', 'Kimberley property',
    'Pietermaritzburg property', 'Stellenbosch property', 'George property', 'Rustenburg property'
  ]),
  lenders: Object.freeze([
    'Standard Bank', 'ABSA', 'FNB', 'Nedbank', 'Investec', 'SA Home Loans', 'ooba'
  ]),
  pricePeriods: Object.freeze({
    sale: ['once', 'poa'],
    land: ['once', 'per_m2', 'poa'],
    rent: ['month', 'week', 'poa'],
    student: ['month', 'term', 'semester', 'year'],
    commercialSale: ['once', 'per_m2', 'poa'],
    commercialRent: ['month', 'per_m2_month', 'poa']
  })
});
