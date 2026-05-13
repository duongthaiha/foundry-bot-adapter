const SUPPORTED_BOT_APP_TYPES = ['UserAssignedMSI', 'SingleTenant'];

function readInteger(name, defaultValue, env = process.env) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}

function readRequired(name, env = process.env) {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function readList(name, env = process.env) {
  const value = env[name];
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTrimmedEnv(env, name) {
  const value = env[name];
  return value && value.trim ? value.trim() : '';
}

function requireBotFrameworkValue(env, name, appType) {
  const value = readTrimmedEnv(env, name);
  if (!value) {
    throw new Error(`${name} is required when MicrosoftAppType=${appType}.`);
  }

  return value;
}

function validateBotFrameworkConfig(env = process.env) {
  const appType = readTrimmedEnv(env, 'MicrosoftAppType');
  if (!appType) {
    throw new Error('MicrosoftAppType is required. Use UserAssignedMSI or SingleTenant.');
  }

  if (!SUPPORTED_BOT_APP_TYPES.includes(appType)) {
    throw new Error(`MicrosoftAppType must be one of: ${SUPPORTED_BOT_APP_TYPES.join(', ')}.`);
  }

  const appId = requireBotFrameworkValue(env, 'MicrosoftAppId', appType);
  const tenantId = requireBotFrameworkValue(env, 'MicrosoftAppTenantId', appType);

  if (appType === 'SingleTenant') {
    requireBotFrameworkValue(env, 'MicrosoftAppPassword', appType);
  }

  return {
    appType,
    appId,
    tenantId
  };
}

function loadConfig(env = process.env) {
  const projectEndpoint = readRequired('FOUNDRY_PROJECT_ENDPOINT', env).replace(/\/+$/, '');
  const agentName = readRequired('FOUNDRY_AGENT_NAME', env);
  const apiVersion = env.FOUNDRY_API_VERSION || '2025-11-15-preview';

  const config = {
    port: Number.parseInt(env.PORT || env.WEBSITES_PORT || '8080', 10),
    projectEndpoint,
    agentName,
    apiVersion,
    responsesEndpoint:
      `${projectEndpoint}/agents/${encodeURIComponent(agentName)}` +
      `/endpoint/protocols/openai/responses?api-version=${encodeURIComponent(apiVersion)}`,
    tokenScope: env.AZURE_AI_TOKEN_SCOPE || 'https://ai.azure.com/.default',
    metadataAllowlist: readList('FOUNDRY_METADATA_ALLOWLIST', env),
    maxMetadataKeys: readInteger('FOUNDRY_MAX_METADATA_KEYS', 7, env),
    nodeEnv: env.NODE_ENV || 'development',
    enableLocalTestEndpoints: env.ENABLE_LOCAL_TEST_ENDPOINTS === 'true',
    localTestApiKey: env.LOCAL_TEST_API_KEY || '',
    botFrameworkAuth: validateBotFrameworkConfig(env)
  };

  if (config.enableLocalTestEndpoints && config.nodeEnv === 'production' && !config.localTestApiKey) {
    throw new Error('LOCAL_TEST_API_KEY is required when ENABLE_LOCAL_TEST_ENDPOINTS=true in production.');
  }

  return config;
}

module.exports = {
  loadConfig,
  readInteger,
  readList,
  validateBotFrameworkConfig
};
