const assert = require('node:assert/strict');
const test = require('node:test');
const { validateBotFrameworkConfig } = require('../src/config');

test('validates SingleTenant Bot Framework config', () => {
  const config = validateBotFrameworkConfig({
    MicrosoftAppType: 'SingleTenant',
    MicrosoftAppId: '00000000-0000-0000-0000-000000000001',
    MicrosoftAppTenantId: '00000000-0000-0000-0000-000000000002',
    MicrosoftAppPassword: 'secret'
  });

  assert.deepEqual(config, {
    appType: 'SingleTenant',
    appId: '00000000-0000-0000-0000-000000000001',
    tenantId: '00000000-0000-0000-0000-000000000002'
  });
});

test('requires a Bot Framework password for SingleTenant config', () => {
  assert.throws(
    () => validateBotFrameworkConfig({
      MicrosoftAppType: 'SingleTenant',
      MicrosoftAppId: '00000000-0000-0000-0000-000000000001',
      MicrosoftAppTenantId: '00000000-0000-0000-0000-000000000002'
    }),
    /MicrosoftAppPassword is required when MicrosoftAppType=SingleTenant/
  );
});

test('does not require a Bot Framework password for UserAssignedMSI config', () => {
  const config = validateBotFrameworkConfig({
    MicrosoftAppType: 'UserAssignedMSI',
    MicrosoftAppId: '00000000-0000-0000-0000-000000000001',
    MicrosoftAppTenantId: '00000000-0000-0000-0000-000000000002'
  });

  assert.equal(config.appType, 'UserAssignedMSI');
});

test('rejects unsupported Bot Framework auth types', () => {
  assert.throws(
    () => validateBotFrameworkConfig({
      MicrosoftAppType: 'MultiTenant',
      MicrosoftAppId: '00000000-0000-0000-0000-000000000001',
      MicrosoftAppTenantId: '00000000-0000-0000-0000-000000000002'
    }),
    /MicrosoftAppType must be one of: UserAssignedMSI, SingleTenant/
  );
});
