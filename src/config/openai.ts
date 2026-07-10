import { env } from './env';

export interface OpenAiClient {
  responses: {
    create(input: {
      model: string;
      input: Array<{ role: string; content: string }>;
    }): Promise<{ output_text?: string }>;
  };
  audio: {
    transcriptions: {
      create(input: {
        file: unknown;
        model: string;
        response_format: 'verbose_json';
      }): Promise<{ text?: string; language?: string }>;
    };
  };
}

type OpenAiFactory = new (options: { apiKey: string }) => OpenAiClient;

let OpenAI: OpenAiFactory | null = null;
let openAiClient: OpenAiClient | null = null;

export function getOpenAiClient(): OpenAiClient | null {
  if (!env.openAiApiKey) return null;
  if (openAiClient) return openAiClient;
  if (!OpenAI) {
    // Lazy-load the SDK so normal checks do not parse its full declaration graph.
    const mod = require('openai') as { default?: OpenAiFactory } & OpenAiFactory;
    OpenAI = mod.default || mod;
  }
  openAiClient = new OpenAI({ apiKey: env.openAiApiKey });
  return openAiClient;
}
