function readInteger(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}

function readRequired(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function readList(name) {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadConfig() {
  const projectEndpoint = readRequired('FOUNDRY_PROJECT_ENDPOINT').replace(/\/+$/, '');
  const agentName = readRequired('FOUNDRY_AGENT_NAME');
  const apiVersion = process.env.FOUNDRY_API_VERSION || '2025-11-15-preview';

  const config = {
    port: Number.parseInt(process.env.PORT || process.env.WEBSITES_PORT || '8080', 10),
    projectEndpoint,
    agentName,
    apiVersion,
    responsesEndpoint:
      `${projectEndpoint}/agents/${encodeURIComponent(agentName)}` +
      `/endpoint/protocols/openai/responses?api-version=${encodeURIComponent(apiVersion)}`,
    tokenScope: process.env.AZURE_AI_TOKEN_SCOPE || 'https://ai.azure.com/.default',
    metadataAllowlist: readList('FOUNDRY_METADATA_ALLOWLIST'),
    maxMetadataKeys: readInteger('FOUNDRY_MAX_METADATA_KEYS', 7),
    nodeEnv: process.env.NODE_ENV || 'development',
    enableLocalTestEndpoints: process.env.ENABLE_LOCAL_TEST_ENDPOINTS === 'true',
    localTestApiKey: process.env.LOCAL_TEST_API_KEY || ''
  };

  if (config.enableLocalTestEndpoints && config.nodeEnv === 'production' && !config.localTestApiKey) {
    throw new Error('LOCAL_TEST_API_KEY is required when ENABLE_LOCAL_TEST_ENDPOINTS=true in production.');
  }

  return config;
}

module.exports = {
  loadConfig,
  readInteger,
  readList
};
