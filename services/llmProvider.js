const PROVIDERS = {
  OPENAI: 'openai',
  OPENAI_COMPAT: 'openai_compat',
  OLLAMA: 'ollama',
  NONE: 'none'
};

const cachedClients = new Map();
let cachedOpenAI = null;

function loadOpenAI() {
  if (!cachedOpenAI) {
    cachedOpenAI = require('openai');
  }
  return cachedOpenAI;
}

function normalizeProviderName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === PROVIDERS.OPENAI) return PROVIDERS.OPENAI;
  if (raw === PROVIDERS.OPENAI_COMPAT) return PROVIDERS.OPENAI_COMPAT;
  if (raw === PROVIDERS.OLLAMA || raw === 'local' || raw === 'self_hosted' || raw === 'self-hosted') return PROVIDERS.OLLAMA;
  if (raw === PROVIDERS.NONE) return PROVIDERS.NONE;
  return PROVIDERS.NONE;
}

function scopePrefix(scope = '') {
  return String(scope || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function scopedEnv(scope, key) {
  const prefix = scopePrefix(scope);
  if (!prefix) return '';
  return String(process.env[`${prefix}_${key}`] || '').trim();
}

function resolveProviderConfig(scope = '') {
  const scopedProvider = scopedEnv(scope, 'LLM_PROVIDER');
  const isolatedScope = Boolean(scopedProvider);
  const provider = normalizeProviderName(scopedProvider || process.env.LLM_PROVIDER);
  const apiKey = (
    scopedEnv(scope, 'LLM_API_KEY')
    || (!isolatedScope ? process.env.LLM_API_KEY : '')
    || (!isolatedScope ? process.env.OPENAI_API_KEY : '')
    || ''
  ).trim();
  const ollamaBase = (scopedEnv(scope, 'OLLAMA_BASE_URL') || (!isolatedScope ? process.env.OLLAMA_BASE_URL : '') || '').trim();
  const baseURL = provider === PROVIDERS.OLLAMA
    ? (ollamaBase || 'http://127.0.0.1:11434/v1')
    : (scopedEnv(scope, 'LLM_API_BASE_URL') || (!isolatedScope ? process.env.LLM_API_BASE_URL : '') || '').trim();
  const organization = (scopedEnv(scope, 'LLM_ORGANIZATION') || (!isolatedScope ? process.env.LLM_ORGANIZATION : '') || '').trim();
  const project = (scopedEnv(scope, 'LLM_PROJECT') || (!isolatedScope ? process.env.LLM_PROJECT : '') || '').trim();
  const hasKey = Boolean(apiKey);
  const forceNoAuth = (
    String(scopedEnv(scope, 'LLM_NO_AUTH') || (!isolatedScope ? process.env.LLM_NO_AUTH : '') || '').trim().toLowerCase() === 'true'
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

function getProviderName(scope = '') {
  return resolveProviderConfig(scope).provider;
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

function getProviderClient(scope = '') {
  const cfg = resolveProviderConfig(scope);
  if (cfg.provider === PROVIDERS.NONE) return null;

  const signature = buildClientSignature(cfg);
  const cacheKey = scopePrefix(scope) || 'DEFAULT';
  const cached = cachedClients.get(cacheKey);
  if (cached?.client && cached.signature === signature) {
    return cached.client;
  }

  const options = buildOpenAiClientOptions(cfg);
  if (!options) {
    cachedClients.set(cacheKey, { signature, client: null });
    return null;
  }

  const OpenAI = loadOpenAI();
  const client = new OpenAI(options);
  cachedClients.set(cacheKey, { signature, client });
  return client;
}

function getTaskModel(taskName, fallbackModel, scope = '') {
  const task = String(taskName || '').trim().toUpperCase();
  const key = `LLM_${task}_MODEL`;
  const scopedKey = scopePrefix(scope) ? `${scopePrefix(scope)}_${key}` : '';
  const isolatedScope = Boolean(scopedEnv(scope, 'LLM_PROVIDER'));
  return (
    (scopedKey ? (process.env[scopedKey] || '').trim() : '') ||
    scopedEnv(scope, 'LLM_MODEL') ||
    (!isolatedScope ? (process.env[key] || '').trim() : '') ||
    (!isolatedScope ? (process.env.LLM_MODEL || '').trim() : '') ||
    (!isolatedScope ? (process.env.OLLAMA_MODEL || '').trim() : '') ||
    fallbackModel
  );
}

function isLlmEnabled(scope = '') {
  return Boolean(getProviderClient(scope));
}

function getProviderMeta(scope = '') {
  const cfg = resolveProviderConfig(scope);
  return {
    provider: cfg.provider,
    baseURL: cfg.baseURL || null,
    hasApiKey: cfg.hasKey,
    noAuth: cfg.forceNoAuth
  };
}

async function toProviderFile(buffer, fileName, options = {}) {
  const OpenAI = loadOpenAI();
  return OpenAI.toFile(buffer, fileName, options);
}

module.exports = {
  PROVIDERS,
  getProviderName,
  getProviderClient,
  getTaskModel,
  isLlmEnabled,
  getProviderMeta,
  resolveProviderConfig,
  toProviderFile
};
