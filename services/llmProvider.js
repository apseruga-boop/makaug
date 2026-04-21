const OpenAI = require('openai');

const PROVIDERS = {
  OPENAI: 'openai',
  OPENAI_COMPAT: 'openai_compat',
  OLLAMA: 'ollama',
  NONE: 'none'
};

let cachedSignature = '';
let cachedClient = null;

function normalizeProviderName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === PROVIDERS.OPENAI) return PROVIDERS.OPENAI;
  if (raw === PROVIDERS.OPENAI_COMPAT) return PROVIDERS.OPENAI_COMPAT;
  if (raw === PROVIDERS.OLLAMA || raw === 'local' || raw === 'self_hosted' || raw === 'self-hosted') return PROVIDERS.OLLAMA;
  if (raw === PROVIDERS.NONE) return PROVIDERS.NONE;
  return PROVIDERS.NONE;
}

function resolveProviderConfig() {
  const provider = normalizeProviderName(process.env.LLM_PROVIDER);
  const apiKey = (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const ollamaBase = (process.env.OLLAMA_BASE_URL || '').trim();
  const baseURL = provider === PROVIDERS.OLLAMA
    ? (ollamaBase || 'http://127.0.0.1:11434/v1')
    : (process.env.LLM_API_BASE_URL || '').trim();
  const organization = (process.env.LLM_ORGANIZATION || '').trim();
  const project = (process.env.LLM_PROJECT || '').trim();
  const hasKey = Boolean(apiKey);
  const forceNoAuth = (
    String(process.env.LLM_NO_AUTH || '').trim().toLowerCase() === 'true'
    || provider === PROVIDERS.OLLAMA
  );

  return {
    provider,
    apiKey,
    baseURL,
    organization,
    project,
    hasKey,
    forceNoAuth
  };
}

function getProviderName() {
  return resolveProviderConfig().provider;
}

function buildClientSignature(cfg) {
  return [
    cfg.provider,
    cfg.baseURL,
    cfg.organization,
    cfg.project,
    cfg.hasKey ? 'key:yes' : 'key:no',
    cfg.forceNoAuth ? 'noauth:yes' : 'noauth:no'
  ].join('|');
}

function buildOpenAiClientOptions(cfg) {
  const options = {};

  if ((cfg.provider === PROVIDERS.OPENAI_COMPAT || cfg.provider === PROVIDERS.OLLAMA) && cfg.baseURL) {
    options.baseURL = cfg.baseURL;
  }

  if (cfg.organization) options.organization = cfg.organization;
  if (cfg.project) options.project = cfg.project;

  // OpenAI-compatible servers may run without auth headers in private networks.
  if (cfg.hasKey && !cfg.forceNoAuth) {
    options.apiKey = cfg.apiKey;
  } else if (cfg.provider === PROVIDERS.OPENAI) {
    // Official OpenAI requires API key.
    return null;
  } else if ((cfg.provider === PROVIDERS.OPENAI_COMPAT || cfg.provider === PROVIDERS.OLLAMA) && !cfg.baseURL && !cfg.hasKey) {
    // OpenAI-compatible provider must have either a base URL (self-hosted) or an API key to default endpoint.
    return null;
  }

  return options;
}

function getProviderClient() {
  const cfg = resolveProviderConfig();
  if (cfg.provider === PROVIDERS.NONE) return null;

  const signature = buildClientSignature(cfg);
  if (cachedClient && cachedSignature === signature) {
    return cachedClient;
  }

  const options = buildOpenAiClientOptions(cfg);
  if (!options) {
    cachedClient = null;
    cachedSignature = signature;
    return null;
  }

  cachedClient = new OpenAI(options);
  cachedSignature = signature;
  return cachedClient;
}

function getTaskModel(taskName, fallbackModel) {
  const key = `LLM_${String(taskName || '').trim().toUpperCase()}_MODEL`;
  return (
    (process.env[key] || '').trim() ||
    (process.env.LLM_MODEL || '').trim() ||
    (process.env.OLLAMA_MODEL || '').trim() ||
    fallbackModel
  );
}

function isLlmEnabled() {
  return Boolean(getProviderClient());
}

function getProviderMeta() {
  const cfg = resolveProviderConfig();
  return {
    provider: cfg.provider,
    baseURL: cfg.baseURL || null,
    hasApiKey: cfg.hasKey,
    noAuth: cfg.forceNoAuth
  };
}

async function toProviderFile(buffer, fileName, options = {}) {
  return OpenAI.toFile(buffer, fileName, options);
}

module.exports = {
  PROVIDERS,
  getProviderName,
  getProviderClient,
  getTaskModel,
  isLlmEnabled,
  getProviderMeta,
  toProviderFile
};
