import type { BrokerResult, PropertyCategory, SearchResult, SessionState, SupportedLanguage } from '../types/domain';

export interface PropertySearchInput {
  category: PropertyCategory | 'any';
  area?: string;
  district?: string;
  budgetMin?: number;
  budgetMax?: number;
  bedsMin?: number;
  propertyType?: string;
  lat?: number;
  lng?: number;
  limit?: number;
}

export interface PropertyDataAdapter {
  search(input: PropertySearchInput): Promise<SearchResult[]>;
  getById(id: string): Promise<SearchResult | null>;
}

export interface AgentSearchInput {
  area?: string;
  district?: string;
  purpose?: string;
  category?: string;
  registeredOnly?: boolean;
}

export interface AgentDataAdapter {
  search(input: AgentSearchInput): Promise<BrokerResult[]>;
}

export interface SessionRepository {
  getOrCreate(userId: string): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
  reset(userId: string): Promise<SessionState>;
  setLanguage(userId: string, language: SupportedLanguage): Promise<void>;
}
