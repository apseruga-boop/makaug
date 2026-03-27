import dotenv from 'dotenv';

dotenv.config();

function read(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

function readOptional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function toBool(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toNumber(process.env.PORT, 8080),
  databaseUrl: read('DATABASE_URL', 'postgres://localhost:5432/makaug'),
  dbSsl: toBool(process.env.DB_SSL, false),
  openAiApiKey: readOptional('OPENAI_API_KEY'),
  openAiModel: process.env.OPENAI_INTENT_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openAiTranscriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL ?? process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe',
  waToken: readOptional('WHATSAPP_ACCESS_TOKEN'),
  waPhoneNumberId: readOptional('WHATSAPP_PHONE_NUMBER_ID'),
  waVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? 'makaug-verify-token',
  waAppSecret: readOptional('WHATSAPP_APP_SECRET'),
  waApiVersion: process.env.WHATSAPP_API_VERSION ?? 'v20.0',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'https://makaug.com',
  otpBypassCode: process.env.NODE_ENV === 'production' ? undefined : readOptional('OTP_BYPASS_CODE'),
  otpEnabled: toBool(process.env.OTP_ENABLED, true),
  smsSenderId: readOptional('SMS_SENDER_ID'),
  twilioSid: readOptional('TWILIO_ACCOUNT_SID'),
  twilioToken: readOptional('TWILIO_AUTH_TOKEN'),
  twilioFrom: readOptional('TWILIO_FROM'),
  reverseGeocodeBaseUrl: process.env.REVERSE_GEOCODE_BASE_URL ?? 'https://nominatim.openstreetmap.org/reverse',
  useMockRepos: toBool(process.env.USE_MOCK_REPOSITORIES, false),
  rateLimitPerMinute: toNumber(process.env.RATE_LIMIT_PER_MINUTE, 120),
  maxUploadBytes: toNumber(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
  queuePollSeconds: toNumber(process.env.QUEUE_POLL_SECONDS, 20),
  mediaStorageProvider: (process.env.MEDIA_STORAGE_PROVIDER ?? 'local') as 'local' | 'supabase' | 's3_presigned',
  supabaseUrl: readOptional('SUPABASE_URL'),
  supabaseServiceRoleKey: readOptional('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'makaug-media',
  s3PresignEndpoint: readOptional('S3_PRESIGN_ENDPOINT'),
  s3PresignToken: readOptional('S3_PRESIGN_TOKEN')
};

export type Env = typeof env;
