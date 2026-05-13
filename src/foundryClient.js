const { DefaultAzureCredential } = require('@azure/identity');
const { buildAllowedMetadata } = require('./metadata');

class FoundryClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FoundryClientError';
    this.status = details.status;
    this.code = details.code;
    this.responseId = details.responseId;
    this.responseBody = details.responseBody;
  }
}

function collectOutputText(value, results = []) {
  if (!value) {
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectOutputText(item, results);
    }
    return results;
  }

  if (typeof value !== 'object') {
    return results;
  }

  if (value.type === 'output_text' && typeof value.text === 'string') {
    results.push(value.text);
    return results;
  }

  if (value.type === 'message' && Array.isArray(value.content)) {
    collectOutputText(value.content, results);
    return results;
  }

  for (const nested of Object.values(value)) {
    collectOutputText(nested, results);
  }

  return results;
}

function extractOutputText(responseJson) {
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim() !== '') {
    return responseJson.output_text.trim();
  }

  const texts = collectOutputText(responseJson.output);
  if (texts.length > 0) {
    return texts.join('\n').trim();
  }

  return '';
}

class FoundryClient {
  constructor(options) {
    this.responsesEndpoint = options.responsesEndpoint;
    this.tokenScope = options.tokenScope || 'https://ai.azure.com/.default';
    this.credential = options.credential || new DefaultAzureCredential();
    this.fetchImpl = options.fetchImpl || fetch;
    this.metadataAllowlist = options.metadataAllowlist || [];
    this.maxMetadataKeys = options.maxMetadataKeys ?? 7;
  }

  async createResponse({ input, activity }) {
    if (!input || input.trim() === '') {
      throw new FoundryClientError('Cannot send an empty message to Foundry.');
    }

    const token = await this.credential.getToken(this.tokenScope);
    if (!token || !token.token) {
      throw new FoundryClientError('DefaultAzureCredential did not return an Azure AI token.');
    }

    const metadata = buildAllowedMetadata(activity, this.metadataAllowlist, this.maxMetadataKeys);
    const body = {
      input: input.trim()
    };

    if (Object.keys(metadata).length > 0) {
      body.metadata = metadata;
    }

    const response = await this.fetchImpl(this.responsesEndpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json',
        'user-agent': 'foundry-bot-adapter/0.1.0'
      },
      body: JSON.stringify(body)
    });

    const responseBody = await response.text();
    let responseJson;
    try {
      responseJson = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      responseJson = { raw: responseBody };
    }

    if (!response.ok) {
      const error = responseJson.error || {};
      throw new FoundryClientError(error.message || `Foundry request failed with HTTP ${response.status}.`, {
        status: response.status,
        code: error.code,
        responseId: responseJson.id,
        responseBody: responseJson
      });
    }

    return {
      id: responseJson.id,
      text: extractOutputText(responseJson),
      raw: responseJson,
      metadataKeyCount: Object.keys(metadata).length
    };
  }
}

module.exports = {
  FoundryClient,
  FoundryClientError,
  collectOutputText,
  extractOutputText
};
