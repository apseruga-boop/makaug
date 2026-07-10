import { getOpenAiClient } from '../config/openai';
import { env } from '../config/env';
import { MediaUploadService } from './mediaUploadService';

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  language?: string;
  mediaUrl?: string;
}

export class VoiceTranscriptionService {
  constructor(private readonly mediaService = new MediaUploadService()) {}

  async transcribeFromMediaId(mediaId: string): Promise<TranscriptionResult | null> {
    const media = await this.mediaService.fetchMediaById(mediaId);
    const openai = getOpenAiClient();
    if (!media || !openai) return null;

    const { toFile } = require('openai/uploads') as {
      toFile(bytes: Buffer, name: string, options: { type: string }): Promise<unknown>;
    };
    const file = await toFile(media.bytes, `${media.filename || mediaId}.ogg`, {
      type: media.mimeType || 'audio/ogg'
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: env.openAiTranscriptionModel,
      response_format: 'verbose_json'
    });

    const text = transcription.text?.trim() || '';
    return {
      transcript: text,
      confidence: 0.82,
      language: (transcription as { language?: string }).language,
      mediaUrl: media.url
    };
  }
}
