import { MOCK_AGENTS } from '../../data/mockAgents';
import type { AgentDataAdapter, AgentSearchInput } from '../interfaces';
import type { BrokerResult } from '../../types/domain';

function includes(haystack: string, needle?: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export class MockAgentAdapter implements AgentDataAdapter {
  async search(input: AgentSearchInput): Promise<BrokerResult[]> {
    return MOCK_AGENTS.filter((agent) => {
      const areaMatch = includes(`${agent.areaCovered ?? ''} ${agent.name} ${agent.company ?? ''}`, input.area || input.district);
      const purposeMatch = includes((agent.specialties ?? []).join(' '), input.category || input.purpose);
      const registrationMatch = input.registeredOnly ? agent.registrationStatus === 'registered' : true;
      return areaMatch && purposeMatch && registrationMatch;
    }).slice(0, 5);
  }
}
