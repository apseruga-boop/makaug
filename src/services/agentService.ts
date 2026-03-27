import { repositories } from '../repositories';

export class AgentService {
  async search(input: {
    area?: string;
    district?: string;
    category?: string;
    purpose?: string;
    registeredOnly?: boolean;
  }) {
    return repositories.agentAdapter.search(input);
  }

  formatAgents(
    agents: Array<{
      name: string;
      company?: string;
      phone?: string;
      whatsapp?: string;
      areaCovered?: string;
      specialties?: string[];
      languages?: string[];
      registrationStatus: 'registered' | 'not_registered';
      profileUrl?: string;
    }>
  ): string {
    return agents
      .map((agent, idx) => {
        return `${idx + 1}) *${agent.name}*${agent.company ? ` (${agent.company})` : ''}\n` +
          `Areas: ${agent.areaCovered || 'Uganda'}\n` +
          `Specialties: ${(agent.specialties || []).join(', ') || 'General'}\n` +
          `Languages: ${(agent.languages || []).join(', ') || 'English'}\n` +
          `Status: ${agent.registrationStatus === 'registered' ? 'Registered' : 'Not Registered'}\n` +
          `${agent.phone ? `Call: ${agent.phone}\n` : ''}` +
          `${agent.whatsapp ? `WhatsApp: https://wa.me/${agent.whatsapp.replace(/\D/g, '')}\n` : ''}` +
          `${agent.profileUrl ? `Profile: ${agent.profileUrl}` : ''}`;
      })
      .join('\n\n');
  }

  async registerApplication(payload: Record<string, unknown>): Promise<string> {
    return repositories.agentApplications.create(payload);
  }
}
