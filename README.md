# Foundry Bot Framework Adapter

A custom Bot Framework adapter that connects Azure Bot Service channels, such as Microsoft Teams and Web Chat, to an Azure AI Foundry agent through the Foundry Responses endpoint.

The key behavior is that the adapter calls Foundry directly and omits runtime `metadata` by default. This avoids failures where a managed bridge or channel integration sends too many metadata properties to the downstream Responses API.

## Architecture

```text
Teams or Web Chat
  -> Azure Bot Service
  -> Custom adapter POST /api/messages
  -> Azure AI Foundry Responses endpoint
  -> Custom adapter
  -> Azure Bot Service
  -> Teams or Web Chat
```

## What is included

| Path | Purpose |
| --- | --- |
| `src` | Express + Bot Framework adapter code. |
| `test` | Node test runner tests for metadata and Foundry response parsing. |
| `infra` | Bicep infrastructure for Azure Container Apps, ACR, Key Vault, App Insights, managed identity, and Foundry/RBAC assignments. |
| `scripts\smoke-foundry-adapter.ps1` | Health and optional Foundry smoke test. |
| `scripts\configure-existing-bot-singletenant.ps1` | Helper for wiring an existing SingleTenant Bot Service to the adapter. |
| `docs\setup.md` | Step-by-step setup for Foundry, Azure Bot Service, and Teams. |
| `azure.yaml` | Azure Developer CLI deployment configuration. |

## Runtime behavior

- Accepts Bot Framework activities at `POST /api/messages`.
- Authenticates Bot Framework requests with `MicrosoftAppType`, `MicrosoftAppId`, and tenant settings.
- Extracts text from message activities.
- Calls:

  ```text
  https://<foundry-account>.services.ai.azure.com/api/projects/<project>/agents/<agent>/endpoint/protocols/openai/responses?api-version=2025-11-15-preview
  ```

- Omits `metadata` by default.
- Optionally forwards an explicit allowlist of metadata keys capped by `FOUNDRY_MAX_METADATA_KEYS`.

## Recommended auth model

Use a user-assigned managed identity for both Azure Bot Service authentication and Foundry access:

```text
Azure Bot Service app type = UserAssignedMSI
Azure Bot Service app ID   = adapter managed identity client ID
Adapter MicrosoftAppType   = UserAssignedMSI
Adapter MicrosoftAppId     = adapter managed identity client ID
Adapter AZURE_CLIENT_ID    = adapter managed identity client ID
```

This avoids storing a Bot Framework app password.

If you must reuse an existing Azure Bot Service that already has a normal app registration, deploy the adapter with `BOT_AUTH_TYPE=SingleTenant`, `MICROSOFT_APP_ID=<existing-bot-app-id>`, and a `BOT_APP_PASSWORD` secret. The deployment stores that password in Key Vault and references it from Container Apps.

## Secret storage

The Bicep deployment creates an Azure Key Vault with purge protection enabled and configures Container Apps secrets as Key Vault references. The Container App uses its user-assigned managed identity to read the referenced secrets.

By default, the only secret is `local-test-api-key`, used by the optional protected smoke-test endpoint. If you switch to `SingleTenant` Bot Framework auth, `bot-app-password` is also stored in Key Vault and referenced by the Container App.

## Local validation

```powershell
Set-Location <repo-root>
npm ci
npm run check
npm test
```

Optional local Foundry smoke test:

```powershell
Copy-Item .env.example .env
# Edit .env with your Foundry endpoint, agent name, tenant, and auth values.
npm start
```

In another shell:

```powershell
.\scripts\smoke-foundry-adapter.ps1 -BaseUrl http://localhost:8080 -FoundryTest
```

## Deploy

Set the required AZD environment values:

```powershell
azd env new foundry-bot-adapter
azd env set AZURE_SUBSCRIPTION_ID <subscription-id>
azd env set AZURE_LOCATION <azure-region>
azd env set AZURE_RESOURCE_GROUP <resource-group-name>
azd env set FOUNDRY_ACCOUNT_NAME <foundry-account-name>
azd env set FOUNDRY_PROJECT_NAME <foundry-project-name>
azd env set FOUNDRY_AGENT_NAME <foundry-agent-name>
azd env set LOG_ANALYTICS_WORKSPACE_NAME <workspace-name>
azd env set BOT_AUTH_TYPE UserAssignedMSI
azd env set MICROSOFT_APP_ID ""
azd env set MICROSOFT_APP_TENANT_ID <tenant-id>
azd env set BOT_APP_PASSWORD ""
azd env set ENABLE_LOCAL_TEST_ENDPOINTS false
azd env set LOCAL_TEST_API_KEY ""
azd up
```

Then create an Azure Bot Service that uses the deployed adapter endpoint. See `docs\setup.md` for the full bot/channel setup.

For an existing SingleTenant Bot Service, set these values before `azd up`:

```powershell
azd env set BOT_AUTH_TYPE SingleTenant
azd env set MICROSOFT_APP_ID <existing-bot-app-id>
azd env set MICROSOFT_APP_TENANT_ID <tenant-id>
azd env set-secret BOT_APP_PASSWORD <client-secret>
```

After deployment, point the existing Bot Service endpoint to `https://<container-app-fqdn>/api/messages`, or use:

```powershell
.\scripts\configure-existing-bot-singletenant.ps1 `
  -BotResourceGroup <bot-resource-group> `
  -BotName <bot-name> `
  -AdapterResourceGroup <adapter-resource-group> `
  -ContainerAppName <container-app-name> `
  -KeyVaultName <key-vault-name> `
  -ManagedIdentityName <adapter-managed-identity-name> `
  -PromptForBotAppPassword `
  -UpdateBotEndpoint
```

## Smoke test deployed adapter

```powershell
.\scripts\smoke-foundry-adapter.ps1 -BaseUrl https://<container-app-fqdn>
```

If you temporarily enable `ENABLE_LOCAL_TEST_ENDPOINTS=true`, you can also run:

```powershell
.\scripts\smoke-foundry-adapter.ps1 `
  -BaseUrl https://<container-app-fqdn> `
  -FoundryTest `
  -TestApiKey <temporary-key>
```

Disable the test endpoint after validation.

## Documentation

See `docs\setup.md` for a complete setup flow:

1. Create/test a Foundry agent.
2. Deploy the adapter.
3. Create Azure Bot Service with `UserAssignedMSI` or reuse an existing `SingleTenant` Bot Service.
4. Enable Direct Line and Teams channels.
5. Validate traffic through the adapter.

