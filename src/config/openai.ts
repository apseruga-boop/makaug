import OpenAI from 'openai';
import { env } from './env';

export const openai = env.openAiApiKey ? new OpenAI({ apiKey: env.openAiApiKey }) : null;
