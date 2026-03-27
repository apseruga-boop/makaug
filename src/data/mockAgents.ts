import type { BrokerResult } from '../types/domain';

export const MOCK_AGENTS: BrokerResult[] = [
  {
    id: 'agent-001',
    name: 'James Mukasa',
    company: 'Prime Properties Uganda',
    phone: '+256772100001',
    whatsapp: '+256772100001',
    areaCovered: 'Kampala, Wakiso',
    specialties: ['Residential', 'Commercial'],
    languages: ['English', 'Luganda'],
    registrationStatus: 'registered',
    profileUrl: 'https://makaug.com/agent/agent-001'
  },
  {
    id: 'agent-002',
    name: 'Sarah Namusoke',
    company: 'Namusoke Realty',
    phone: '+256772100002',
    whatsapp: '+256772100002',
    areaCovered: 'Entebbe, Wakiso',
    specialties: ['Land', 'Rentals'],
    languages: ['English', 'Luganda', 'Kiswahili'],
    registrationStatus: 'registered',
    profileUrl: 'https://makaug.com/agent/agent-002'
  },
  {
    id: 'agent-003',
    name: 'Robert Okello',
    company: 'Northern Properties Ltd',
    phone: '+256772100003',
    whatsapp: '+256772100003',
    areaCovered: 'Gulu, Arua',
    specialties: ['Land', 'Commercial'],
    languages: ['English', 'Acholi'],
    registrationStatus: 'not_registered',
    profileUrl: 'https://makaug.com/agent/agent-003'
  }
];
