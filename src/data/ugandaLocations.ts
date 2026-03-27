export interface UgandaDistrictCatalog {
  region: string;
  district: string;
  cities: Array<{
    name: string;
    neighborhoods: string[];
    lat: number;
    lng: number;
  }>;
}

export const UGANDA_LOCATION_CATALOG: UgandaDistrictCatalog[] = [
  {
    region: 'Central',
    district: 'Kampala',
    cities: [
      { name: 'Kampala', neighborhoods: ['Kololo', 'Ntinda', 'Bugolobi', 'Muyenga', 'Nakasero', 'Kisaasi', 'Wandegeya'], lat: 0.3476, lng: 32.5825 }
    ]
  },
  {
    region: 'Central',
    district: 'Wakiso',
    cities: [
      { name: 'Entebbe', neighborhoods: ['Kitoro', 'Abaita Ababiri', 'Kigungu'], lat: 0.0512, lng: 32.4637 },
      { name: 'Kira', neighborhoods: ['Namugongo', 'Kiwologoma', 'Bweyogerere'], lat: 0.3918, lng: 32.6477 },
      { name: 'Wakiso Town', neighborhoods: ['Nansana', 'Kakiri', 'Kasangati'], lat: 0.4044, lng: 32.4594 }
    ]
  },
  {
    region: 'Eastern',
    district: 'Jinja',
    cities: [
      { name: 'Jinja', neighborhoods: ['Nalufenya', 'Mpumudde', 'Masese'], lat: 0.4478, lng: 33.2026 }
    ]
  },
  {
    region: 'Western',
    district: 'Mbarara',
    cities: [
      { name: 'Mbarara', neighborhoods: ['Kakoba', 'Nyamitanga', 'Ruti'], lat: -0.6072, lng: 30.6545 }
    ]
  },
  {
    region: 'Northern',
    district: 'Gulu',
    cities: [
      { name: 'Gulu', neighborhoods: ['Pece', 'Laroo', 'Bardege'], lat: 2.7746, lng: 32.299 },
      { name: 'Arua', neighborhoods: ['Arua Hill', 'Onzivu', 'Ombaci'], lat: 3.0201, lng: 30.9111 }
    ]
  },
  {
    region: 'Western',
    district: 'Kabale',
    cities: [
      { name: 'Kabale', neighborhoods: ['Central', 'Kikungiri', 'Rushoroza'], lat: -1.2486, lng: 29.9899 }
    ]
  },
  {
    region: 'Eastern',
    district: 'Mbale',
    cities: [
      { name: 'Mbale', neighborhoods: ['Nkoma', 'Namakwekwe', 'Busamaga'], lat: 1.0757, lng: 34.179 },
      { name: 'Tororo', neighborhoods: ['Central', 'Malaba Road', 'Osukuru'], lat: 0.6847, lng: 34.1808 }
    ]
  }
];

export function getDistrictsByRegion(region: string): string[] {
  return UGANDA_LOCATION_CATALOG.filter((entry) => entry.region.toLowerCase() === region.toLowerCase()).map((entry) => entry.district);
}

export function getCitiesByDistrict(district: string): string[] {
  const entry = UGANDA_LOCATION_CATALOG.find((item) => item.district.toLowerCase() === district.toLowerCase());
  return entry ? entry.cities.map((city) => city.name) : [];
}

export function getNeighborhoods(district: string, city: string): string[] {
  const entry = UGANDA_LOCATION_CATALOG.find((item) => item.district.toLowerCase() === district.toLowerCase());
  const cityEntry = entry?.cities.find((c) => c.name.toLowerCase() === city.toLowerCase());
  return cityEntry?.neighborhoods ?? [];
}

export function findCoordinates(region?: string, district?: string, city?: string, neighborhood?: string): { lat: number; lng: number } | null {
  const entries = UGANDA_LOCATION_CATALOG.filter((entry) => (region ? entry.region.toLowerCase() === region.toLowerCase() : true));
  for (const entry of entries) {
    if (district && entry.district.toLowerCase() !== district.toLowerCase()) continue;
    for (const c of entry.cities) {
      if (city && c.name.toLowerCase() !== city.toLowerCase()) continue;
      if (neighborhood && !c.neighborhoods.some((n) => n.toLowerCase() === neighborhood.toLowerCase())) continue;
      return { lat: c.lat, lng: c.lng };
    }
  }
  return null;
}
