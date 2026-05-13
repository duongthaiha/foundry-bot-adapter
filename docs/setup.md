# Setup Guide

This guide sets up a fresh Azure AI Foundry agent with a custom Bot Framework adapter, Azure Bot Service, Direct Line validation, and Teams.

## 1. Prerequisites

- Azure CLI, Azure Developer CLI, Node.js 22, and GitHub CLI if publishing to GitHub.
- An Azure subscription where you can create Container Apps, Container Registry, managed identities, Bot Service, Application Insights, and role assignments.
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
azd env set AZURE_TENANT_ID <tenant-id>
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
```

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

## 6. Create Azure Bot Service

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

## 7. Enable channels

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

## 8. Validate Bot Service traffic

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

## 9. Create the Teams app

Use Teams Developer Portal:

1. Create a Teams app.
2. Add a bot.
3. Use the Azure Bot Service app ID, which should be the adapter managed identity client ID.
4. Start with the `personal` scope.
5. Add the Container App host name as a valid domain.
6. Install or publish the app and send a test message.

If you use the Foundry portal Teams publishing flow instead, you are testing the managed Foundry bridge, not this adapter.

## 10. SingleTenant alternative

If managed identity Bot Framework auth is not available in your environment, use a normal app registration and secret:

```text
MicrosoftAppType=SingleTenant
MicrosoftAppId=<app-registration-client-id>
MicrosoftAppTenantId=<tenant-id>
MicrosoftAppPassword=<client-secret>
```

Set the Container App secret:

```powershell
az containerapp secret set `
  --resource-group <resource-group-name> `
  --name <container-app-name> `
  --secrets "bot-app-password=<client-secret>"

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
