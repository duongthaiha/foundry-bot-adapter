const assert = require('node:assert/strict');
const test = require('node:test');
const { FoundryClient, extractOutputText } = require('../src/foundryClient');

test('extracts output_text shortcut', () => {
  assert.equal(extractOutputText({ output_text: 'hello' }), 'hello');
});

test('extracts text from responses output message content', () => {
  const text = extractOutputText({
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'hello from nested content'
          }
        ]
      }
    ]
  });

  assert.equal(text, 'hello from nested content');
});

test('does not send metadata by default', async () => {
  let requestBody;
  const client = new FoundryClient({
    responsesEndpoint: 'https://example.invalid/responses',
    credential: {
      getToken: async () => ({ token: 'test-token' })
    },
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: 'resp_1', output_text: 'ok' }), { status: 200 });
    }
  });

  const response = await client.createResponse({
    input: 'hello',
    activity: { id: 'activity-1', channelId: 'msteams' }
  });

  assert.equal(response.text, 'ok');
  assert.equal(response.metadataKeyCount, 0);
  assert.deepEqual(requestBody, { input: 'hello' });
});
