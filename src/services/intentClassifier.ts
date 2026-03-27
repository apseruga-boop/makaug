import { openai } from '../config/openai';
import type { TopLevelIntent } from '../types/domain';

const keywordMap: Array<{ intent: TopLevelIntent; keywords: string[] }> = [
  { intent: 'property_search', keywords: ['find property', 'search property', 'house', 'rent', 'buy', 'plot', 'looking for'] },
  { intent: 'property_listing', keywords: ['list property', 'post property', 'advertise', 'sell my house', 'i want to list'] },
  { intent: 'agent_search', keywords: ['find agent', 'broker', 'agent near', 'who can help'] },
  { intent: 'agent_registration', keywords: ['register agent', 'become agent', 'agent application'] },
  { intent: 'mortgage_help', keywords: ['mortgage', 'loan', 'repayment', 'deposit percent'] },
  { intent: 'account_help', keywords: ['sign in', 'signup', 'account', 'password'] },
  { intent: 'saved_properties', keywords: ['saved', 'favorites', 'alerts'] },
  { intent: 'report_listing', keywords: ['report listing', 'fraud', 'scam', 'fake listing'] },
  { intent: 'looking_for_property_lead', keywords: ['no results', 'help me find', 'notify me'] },
  { intent: 'support', keywords: ['support', 'help', 'human', 'talk to person'] }
];

export class IntentClassifierService {
  async classify(input: string): Promise<TopLevelIntent> {
    const normalized = input.trim().toLowerCase();

    for (const item of keywordMap) {
      if (item.keywords.some((keyword) => normalized.includes(keyword))) {
        return item.intent;
      }
    }

    if (!openai) return 'unknown';

    try {
      const response = await openai.responses.create({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content:
              'Classify the user request into exactly one intent from: property_search, property_listing, agent_search, agent_registration, mortgage_help, account_help, saved_properties, support, report_listing, looking_for_property_lead, unknown. Return JSON {"intent":"..."}.'
          },
          { role: 'user', content: normalized }
        ]
      });

      const text = response.output_text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return 'unknown';
      const parsed = JSON.parse(jsonMatch[0]) as { intent?: TopLevelIntent };
      return parsed.intent ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
