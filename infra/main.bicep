targetScope = 'resourceGroup'

@description('Environment name supplied by azd.')
param environmentName string

@description('Azure region for the adapter resources.')
param location string = resourceGroup().location

@description('Existing Foundry AI Services account name.')
param foundryAccountName string

@description('Existing Foundry project name.')
param foundryProjectName string

@description('Existing Foundry agent name.')
param foundryAgentName string

@description('Existing Log Analytics workspace for Container Apps and Application Insights.')
param logAnalyticsWorkspaceName string

@allowed([
  'UserAssignedMSI'
  'SingleTenant'
])
@description('Bot Framework auth mode for the adapter. UserAssignedMSI uses this deployment user-assigned managed identity as the bot app ID. SingleTenant requires microsoftAppId and botAppPassword.')
param botAuthType string = 'UserAssignedMSI'

@description('Existing Bot Framework app/client ID from Azure Bot Service. Required only when botAuthType is SingleTenant.')
param microsoftAppId string = ''

@description('Existing Bot Framework app tenant ID.')
param microsoftAppTenantId string

@secure()
@description('Bot Framework app secret. Required only when botAuthType is SingleTenant. Set with: azd env set-secret BOT_APP_PASSWORD <secret>')
param botAppPassword string = ''

@description('Enable the protected /api/test/foundry endpoint for deployment smoke validation.')
param enableLocalTestEndpoints bool = false

@secure()
@description('Temporary API key for the protected /api/test/foundry endpoint.')
param localTestApiKey string = ''

var serviceName = 'bot-adapter'
var uniqueSuffix = take(uniqueString(resourceGroup().id, environmentName, serviceName), 6)
var tags = {
  'azd-env-name': environmentName
  workload: 'foundry-bot-adapter'
}
var containerRegistryName = 'crbotadapter${uniqueSuffix}'
var containerAppsEnvironmentName = 'cae-bot-adapter-${uniqueSuffix}'
var containerAppName = 'ca-bot-adapter-${uniqueSuffix}'
var identityName = 'id-bot-adapter-${uniqueSuffix}'
var appInsightsName = 'appi-bot-adapter-${uniqueSuffix}'
var foundryProjectEndpoint = 'https://${foundryAccountName}.services.ai.azure.com/api/projects/${foundryProjectName}'
var foundryResponsesEndpoint = '${foundryProjectEndpoint}/agents/${foundryAgentName}/endpoint/protocols/openai/responses?api-version=2025-11-15-preview'
var azureAiUserRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')
var acrPullRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var useUserAssignedMsiBotAuth = toLower(botAuthType) == 'userassignedmsi'
var effectiveMicrosoftAppId = useUserAssignedMsiBotAuth ? adapterIdentity.properties.clientId : microsoftAppId
var containerAppSecrets = useUserAssignedMsiBotAuth ? [
  {
    name: 'local-test-api-key'
    value: localTestApiKey
  }
] : [
  {
    name: 'bot-app-password'
    value: botAppPassword
  }
  {
    name: 'local-test-api-key'
    value: localTestApiKey
  }
]
var baseContainerEnv = [
  {
    name: 'PORT'
    value: '8080'
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsights.properties.ConnectionString
  }
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'FOUNDRY_PROJECT_ENDPOINT'
    value: foundryProjectEndpoint
  }
  {
    name: 'FOUNDRY_AGENT_NAME'
    value: foundryAgentName
  }
  {
    name: 'FOUNDRY_API_VERSION'
    value: '2025-11-15-preview'
  }
  {
    name: 'FOUNDRY_MAX_METADATA_KEYS'
    value: '7'
  }
  {
    name: 'FOUNDRY_METADATA_ALLOWLIST'
    value: ''
  }
  {
    name: 'AZURE_AI_TOKEN_SCOPE'
    value: 'https://ai.azure.com/.default'
  }
  {
    name: 'AZURE_CLIENT_ID'
    value: adapterIdentity.properties.clientId
  }
]
var botFrameworkEnv = useUserAssignedMsiBotAuth ? [
  {
    name: 'MicrosoftAppType'
    value: 'UserAssignedMSI'
  }
  {
    name: 'MicrosoftAppId'
    value: effectiveMicrosoftAppId
  }
  {
    name: 'MicrosoftAppTenantId'
    value: microsoftAppTenantId
  }
] : [
  {
    name: 'MicrosoftAppType'
    value: 'SingleTenant'
  }
  {
    name: 'MicrosoftAppId'
    value: effectiveMicrosoftAppId
  }
  {
    name: 'MicrosoftAppTenantId'
    value: microsoftAppTenantId
  }
  {
    name: 'MicrosoftAppPassword'
    secretRef: 'bot-app-password'
  }
]
var localTestEnv = [
  {
    name: 'ENABLE_LOCAL_TEST_ENDPOINTS'
    value: toLower(string(enableLocalTestEndpoints))
  }
  {
    name: 'LOCAL_TEST_API_KEY'
    secretRef: 'local-test-api-key'
  }
]

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: containerRegistryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource adapterIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: containerAppsEnvironmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' existing = {
  name: '${foundryAccountName}/${foundryProjectName}'
}

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, adapterIdentity.id, acrPullRoleDefinitionId)
  scope: containerRegistry
  properties: {
    roleDefinitionId: acrPullRoleDefinitionId
    principalId: adapterIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryProject.id, adapterIdentity.id, azureAiUserRoleDefinitionId)
  scope: foundryProject
  properties: {
    roleDefinitionId: azureAiUserRoleDefinitionId
    principalId: adapterIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  tags: union(tags, {
    'azd-service-name': serviceName
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${adapterIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: adapterIdentity.id
        }
      ]
      secrets: containerAppSecrets
    }
    template: {
      containers: [
        {
          name: serviceName
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          env: concat(baseContainerEnv, botFrameworkEnv, localTestEnv)
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    acrPullRoleAssignment
    foundryRoleAssignment
  ]
}

output AZURE_RESOURCE_GROUP string = resourceGroup().name
output AZURE_CONTAINER_REGISTRY_NAME string = containerRegistry.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.properties.loginServer
output AZURE_CONTAINER_REGISTRY_MANAGED_IDENTITY_ID string = adapterIdentity.id
output MANAGED_IDENTITY_CLIENT_ID string = adapterIdentity.properties.clientId
output AZURE_CONTAINER_APPS_ENVIRONMENT_NAME string = containerAppsEnvironment.name
output BOT_ADAPTER_BASE_URL string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output BOT_MESSAGES_ENDPOINT string = 'https://${containerApp.properties.configuration.ingress.fqdn}/api/messages'
output FOUNDRY_PROJECT_ENDPOINT string = foundryProjectEndpoint
output FOUNDRY_RESPONSES_ENDPOINT string = foundryResponsesEndpoint
