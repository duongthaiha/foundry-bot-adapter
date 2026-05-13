# Setup Guide

This guide sets up a fresh Azure AI Foundry agent with a custom Bot Framework adapter, Azure Bot Service, Direct Line validation, and Teams.

## 1. Prerequisites

- Azure CLI, Azure Developer CLI, Node.js 22, and GitHub CLI if publishing to GitHub.
- An Azure subscription where you can create Container Apps, Container Registry, Key Vault, managed identities, Bot Service, Application Insights, and role assignments.
- A Foundry project with a model deployment that can run an agent.
- A Log Analytics workspace in the target resource group.

## 2. Create and test a Foundry agent

1. Open `https://ai.azure.com`.
2. Create or select a Foundry project.
3. Create an agent under **Build** > **Agents**.
4. Configure the model, instructions, tools, and knowledge sources.
5. Save a version and test it in the Foundry playground.
6. Record:

   ```text
   Foundry account name
   Foundry project name
   Foundry agent resource name
   Tenant ID
   Subscription ID
   Resource group
   Region
   Log Analytics workspace name
   ```

Do not use the Foundry portal **Publish to Teams** path when validating this adapter. That managed bridge is intentionally bypassed by this solution.

## 3. Validate locally

```powershell
Set-Location <repo-root>
npm ci
npm run check
npm test
```

For a local Foundry smoke test:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

```text
FOUNDRY_PROJECT_ENDPOINT=https://<foundry-account-name>.services.ai.azure.com/api/projects/<project-name>
FOUNDRY_AGENT_NAME=<foundry-agent-name>
MicrosoftAppType=UserAssignedMSI
MicrosoftAppId=<managed-identity-client-id-or-placeholder-for-local-smoke>
MicrosoftAppTenantId=<tenant-id>
ENABLE_LOCAL_TEST_ENDPOINTS=true
```

Start the adapter:

```powershell
npm start
```

Smoke test from another shell:

```powershell
.\scripts\smoke-foundry-adapter.ps1 -BaseUrl http://localhost:8080 -FoundryTest
```

Expected output includes:

```json
{
  "metadataKeyCount": 0
}
```

## 4. Deploy the adapter

Set AZD environment values:

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
```

Validate and deploy:

```powershell
az bicep build --file .\infra\main.bicep
azd provision --preview --no-prompt
azd up
```

Record the deployment outputs:

```text
BOT_ADAPTER_BASE_URL
BOT_MESSAGES_ENDPOINT
MANAGED_IDENTITY_CLIENT_ID
KEY_VAULT_NAME
KEY_VAULT_URI
```

The deployment stores Container Apps secrets in Key Vault and references them from the Container App by `keyVaultUrl` using the adapter's user-assigned managed identity. The identity receives the `Key Vault Secrets User` role on the generated vault.

Key Vault purge protection is enabled by default. This is recommended for production secret protection, but it also means deleted vaults and secrets cannot be permanently purged until the retention period expires.

If needed, query the managed identity directly:

```powershell
$IdentityResourceId = az identity show `
  --resource-group <resource-group-name> `
  --name <managed-identity-name> `
  --query id -o tsv

$BotAppId = az identity show `
  --resource-group <resource-group-name> `
  --name <managed-identity-name> `
  --query clientId -o tsv
```

## 5. Smoke test the deployed adapter

```powershell
.\scripts\smoke-foundry-adapter.ps1 -BaseUrl <BOT_ADAPTER_BASE_URL>
```

Optional Foundry smoke test:

```powershell
$TestApiKey = [guid]::NewGuid().ToString()
azd env set ENABLE_LOCAL_TEST_ENDPOINTS true
azd env set LOCAL_TEST_API_KEY $TestApiKey
azd up

.\scripts\smoke-foundry-adapter.ps1 `
  -BaseUrl <BOT_ADAPTER_BASE_URL> `
  -FoundryTest `
  -TestApiKey $TestApiKey
```

Disable the smoke endpoint after validation:

```powershell
azd env set ENABLE_LOCAL_TEST_ENDPOINTS false
azd up
```

The `LOCAL_TEST_API_KEY` value is stored in Key Vault as `local-test-api-key`; the Container App receives it through a Container Apps secret reference, not as an inline secret value.

## 6. Create Azure Bot Service with UserAssignedMSI

Create a Bot Service that uses the adapter's managed identity as the Bot Framework app ID:

```powershell
az bot create `
  --subscription <subscription-id> `
  --resource-group <resource-group-name> `
  --name <bot-name> `
  --location global `
  --kind azurebot `
  --sku F0 `
  --appid <MANAGED_IDENTITY_CLIENT_ID> `
  --app-type UserAssignedMSI `
  --tenant-id <tenant-id> `
  --msi-resource-id <managed-identity-resource-id> `
  --endpoint <BOT_MESSAGES_ENDPOINT>
```

Confirm the bot:

```powershell
az bot show `
  --resource-group <resource-group-name> `
  --name <bot-name> `
  --query "{name:name, appId:properties.msaAppId, appType:properties.msaAppType, endpoint:properties.endpoint}" `
  -o table
```

The bot app ID must match the adapter managed identity client ID.

## 7. Use an existing SingleTenant Bot Service

If you already have an Azure Bot Service with a normal app registration, configure the adapter to use that bot's app ID and client secret instead of the adapter managed identity as the Bot Framework app ID.

Get the existing bot app ID and tenant:

```powershell
$BotAppId = az bot show `
  --resource-group <bot-resource-group> `
  --name <bot-name> `
  --query properties.msaAppId -o tsv

$BotTenantId = az bot show `
  --resource-group <bot-resource-group> `
  --name <bot-name> `
  --query properties.msaAppTenantId -o tsv
```

Create a client secret if you do not already have one:

```powershell
$BotAppPassword = az ad app credential reset `
  --id $BotAppId `
  --append `
  --display-name "foundry-bot-adapter" `
  --years 1 `
  --query password `
  -o tsv
```

Set AZD values before deploying:

```powershell
azd env set BOT_AUTH_TYPE SingleTenant
azd env set MICROSOFT_APP_ID $BotAppId
azd env set MICROSOFT_APP_TENANT_ID $BotTenantId
azd env set-secret BOT_APP_PASSWORD $BotAppPassword
azd up
```

The deployment stores `BOT_APP_PASSWORD` in Key Vault as `bot-app-password` and configures the Container App with a Key Vault-backed secret reference.

After deployment, update the existing Bot Service messaging endpoint:

```powershell
$Endpoint = azd env get-value BOT_MESSAGES_ENDPOINT
az bot update `
  --resource-group <bot-resource-group> `
  --name <bot-name> `
  --endpoint $Endpoint
```

You can also use the helper script after the adapter is deployed:

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

Confirm both sides match:

```powershell
az bot show `
  --resource-group <bot-resource-group> `
  --name <bot-name> `
  --query "{appId:properties.msaAppId, appType:properties.msaAppType, tenant:properties.msaAppTenantId, endpoint:properties.endpoint}" `
  -o json

az containerapp show `
  --resource-group <adapter-resource-group> `
  --name <container-app-name> `
  --query "properties.template.containers[0].env[?name=='MicrosoftAppType' || name=='MicrosoftAppId' || name=='MicrosoftAppTenantId' || name=='MicrosoftAppPassword']" `
  -o json
```

The Bot Service `msaAppId` must equal the adapter `MicrosoftAppId`.

## 8. Enable channels

Enable Direct Line for scripted validation:

```powershell
az bot directline create `
  --resource-group <resource-group-name> `
  --name <bot-name> `
  --site-name "Default Site"
```

Enable Teams:

```powershell
az bot msteams create `
  --resource-group <resource-group-name> `
  --name <bot-name>
```

## 9. Validate Bot Service traffic

Use Direct Line, Web Chat in the Azure portal, or Teams. A successful adapter request writes a log like:

```json
{"event":"foundry_response","metadataKeyCount":0}
```

Read recent Container Apps logs:

```powershell
az containerapp logs show `
  --resource-group <resource-group-name> `
  --name <container-app-name> `
  --tail 80 `
  --format text
```

## 10. Create the Teams app

Use Teams Developer Portal:

1. Create a Teams app.
2. Add a bot.
3. Use the Azure Bot Service app ID. For `UserAssignedMSI`, this is the adapter managed identity client ID. For `SingleTenant`, this is the existing bot app registration client ID.
4. Start with the `personal` scope.
5. Add the Container App host name as a valid domain.
6. Install or publish the app and send a test message.

If you use the Foundry portal Teams publishing flow instead, you are testing the managed Foundry bridge, not this adapter.

## 11. Manual SingleTenant alternative

If managed identity Bot Framework auth is not available in your environment, use a normal app registration and secret:

```text
MicrosoftAppType=SingleTenant
MicrosoftAppId=<app-registration-client-id>
MicrosoftAppTenantId=<tenant-id>
MicrosoftAppPassword=<client-secret>
```

With Bicep, set `botAuthType` to `SingleTenant`, set `microsoftAppId` to the app registration client ID, and pass `botAppPassword` as a secure deployment parameter. The template stores `botAppPassword` in Key Vault as `bot-app-password` and configures the Container App secret as a Key Vault reference.

For an already deployed Container App, you can manually store the secret in Key Vault and update the Container App secret reference:

```powershell
$SecretUri = az keyvault secret set `
  --vault-name <key-vault-name> `
  --name bot-app-password `
  --value <client-secret> `
  --query properties.id -o tsv

az containerapp secret set `
  --resource-group <resource-group-name> `
  --name <container-app-name> `
  --secrets "bot-app-password=keyvaultref:$SecretUri,identityref:<managed-identity-resource-id>"

az containerapp update `
  --resource-group <resource-group-name> `
  --name <container-app-name> `
  --set-env-vars `
    MicrosoftAppType=SingleTenant `
    MicrosoftAppId=<app-registration-client-id> `
    MicrosoftAppTenantId=<tenant-id> `
    MicrosoftAppPassword=secretref:bot-app-password
```

Create the bot with `--app-type SingleTenant` and the app registration client ID.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Bot returns 401 | Bot Service `msaAppId` must equal adapter `MicrosoftAppId`; omit `MicrosoftAppPassword` for `UserAssignedMSI`. |
| Bot times out | Check `/health`, Container Apps logs, and whether the app scaled from zero. |
| Foundry returns 401/403 | Confirm the adapter managed identity has `Azure AI User` on the Foundry project. |
| Metadata limit error still appears | Confirm the channel is using the custom Azure Bot Service, not a Foundry-published managed Teams app. |
