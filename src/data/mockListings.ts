import type { SearchResult } from '../types/domain';

export const MOCK_LISTINGS: SearchResult[] = [
  {
    id: 'prop-001',
    title: '3 Bedroom House in Ntinda',
    summary: 'Modern family home with parking and security',
    location: 'Ntinda',
    district: 'Kampala',
    priceLabel: 'USh 350M',
    keyFacts: ['3 beds', '2 baths', 'Parking'],
    imageUrl: 'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=900&q=80',
    listingUrl: 'https://makaug.com/property/prop-001',
    category: 'sale'
  },
  {
    id: 'prop-002',
    title: '2 Bedroom Apartment in Kisaasi',
    summary: 'To rent apartment with WiFi and security',
    location: 'Kisaasi',
    district: 'Kampala',
    priceLabel: 'USh 1.8M/mo',
    keyFacts: ['2 beds', '1 bath', 'Generator'],
    imageUrl: 'https://images.unsplash.com/photo-1493666438817-866a91353ca9?w=900&q=80',
    listingUrl: 'https://makaug.com/property/prop-002',
    category: 'rent'
  },
  {
    id: 'prop-003',
    title: 'Student Hostel Near Makerere',
    summary: 'Shared rooms with WiFi, meals and security',
    location: 'Wandegeya',
    district: 'Kampala',
    priceLabel: 'USh 650K/month',
    keyFacts: ['Hostel', 'WiFi', 'Meals'],
    imageUrl: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=900&q=80',
    listingUrl: 'https://makaug.com/property/prop-003',
    category: 'students'
  },
  {
    id: 'prop-004',
    title: 'Warehouse in Namanve',
    summary: 'Commercial warehouse with loading bay',
    location: 'Namanve',
    district: 'Mukono',
    priceLabel: 'USh 15M/mo',
    keyFacts: ['Warehouse', '1200 sqm', '3-phase power'],
    imageUrl: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=900&q=80',
    listingUrl: 'https://makaug.com/property/prop-004',
    category: 'commercial'
  },
  {
    id: 'prop-005',
    title: '50x100 Residential Plot in Wakiso',
    summary: 'Mailo land title with road access',
    location: 'Wakiso Town',
    district: 'Wakiso',
    priceLabel: 'USh 80M',
    keyFacts: ['Residential land', '50x100', 'Mailo'],
    imageUrl: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=900&q=80',
    listingUrl: 'https://makaug.com/property/prop-005',
    category: 'land'
  }
];
