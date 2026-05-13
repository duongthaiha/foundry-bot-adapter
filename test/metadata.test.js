const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAllowedMetadata } = require('../src/metadata');

test('omits metadata when allowlist is empty', () => {
  const metadata = buildAllowedMetadata(
    { id: 'activity-1', channelId: 'msteams' },
    [],
    7
  );

  assert.deepEqual(metadata, {});
});

test('copies only allowed metadata keys up to max key count', () => {
  const metadata = buildAllowedMetadata(
    {
      id: 'activity-1',
      channelId: 'msteams',
      locale: 'en-GB',
      conversation: { id: 'conversation-1' },
      from: { id: 'user-1' }
    },
    ['activityId', 'channelId', 'locale', 'conversationId', 'fromId'],
    3
  );

  assert.deepEqual(metadata, {
    activityId: 'activity-1',
    channelId: 'msteams',
    locale: 'en-GB'
  });
});

test('rejects unsupported allowlist keys instead of silently forwarding data', () => {
  assert.throws(
    () => buildAllowedMetadata({ id: 'activity-1' }, ['unknownKey'], 7),
    /Unsupported metadata allowlist key/
  );
});
