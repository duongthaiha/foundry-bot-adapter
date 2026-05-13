param(
    [Parameter(Mandatory = $true)]
    [string]$BotResourceGroup,

    [Parameter(Mandatory = $true)]
    [string]$BotName,

    [Parameter(Mandatory = $true)]
    [string]$AdapterResourceGroup,

    [Parameter(Mandatory = $true)]
    [string]$ContainerAppName,

    [Parameter(Mandatory = $true)]
    [string]$KeyVaultName,

    [Parameter(Mandatory = $true)]
    [string]$ManagedIdentityName,

    [string]$BotAppPassword,

    [switch]$PromptForBotAppPassword,

    [switch]$UpdateBotEndpoint
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $PSNativeCommandUseErrorActionPreference = $true
}

function Convert-SecureStringToPlainText {
    param(
        [Parameter(Mandatory = $true)]
        [securestring]$SecureString
    )

    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

if ([string]::IsNullOrWhiteSpace($BotAppPassword) -and $PromptForBotAppPassword) {
    $securePassword = Read-Host -Prompt "Bot app client secret" -AsSecureString
    $BotAppPassword = Convert-SecureStringToPlainText -SecureString $securePassword
}

if ([string]::IsNullOrWhiteSpace($BotAppPassword)) {
    throw "Provide -BotAppPassword or -PromptForBotAppPassword. If needed, create a secret with: az ad app credential reset --id <bot-app-id> --append --display-name foundry-bot-adapter --years 1"
}

$bot = az bot show `
    --resource-group $BotResourceGroup `
    --name $BotName `
    -o json | ConvertFrom-Json

$botAppId = $bot.properties.msaAppId
$botTenantId = $bot.properties.msaAppTenantId

if ([string]::IsNullOrWhiteSpace($botAppId)) {
    throw "Bot Service '$BotName' does not expose properties.msaAppId."
}

if ([string]::IsNullOrWhiteSpace($botTenantId)) {
    $botTenantId = az account show --query tenantId -o tsv
}

$identityId = az identity show `
    --resource-group $AdapterResourceGroup `
    --name $ManagedIdentityName `
    --query id `
    -o tsv

$fqdn = az containerapp show `
    --resource-group $AdapterResourceGroup `
    --name $ContainerAppName `
    --query properties.configuration.ingress.fqdn `
    -o tsv

$endpoint = "https://$fqdn/api/messages"

Write-Host "Configuring adapter for existing SingleTenant Bot Service app ID: $botAppId"
Write-Host "Bot tenant ID: $botTenantId"
Write-Host "Adapter endpoint: $endpoint"

$secretUri = az keyvault secret set `
    --vault-name $KeyVaultName `
    --name bot-app-password `
    --value $BotAppPassword `
    --query properties.id `
    -o tsv

az containerapp secret set `
    --resource-group $AdapterResourceGroup `
    --name $ContainerAppName `
    --secrets "bot-app-password=keyvaultref:$secretUri,identityref:$identityId" `
    --output none

az containerapp update `
    --resource-group $AdapterResourceGroup `
    --name $ContainerAppName `
    --set-env-vars `
        MicrosoftAppType=SingleTenant `
        MicrosoftAppId=$botAppId `
        MicrosoftAppTenantId=$botTenantId `
        MicrosoftAppPassword=secretref:bot-app-password `
    --output none

if ($UpdateBotEndpoint) {
    az bot update `
        --resource-group $BotResourceGroup `
        --name $BotName `
        --endpoint $endpoint `
        --output none

    Write-Host "Updated Bot Service messaging endpoint."
}
else {
    Write-Host "Container App configured. To update Bot Service messaging endpoint, run:"
    Write-Host "az bot update -g $BotResourceGroup -n $BotName --endpoint $endpoint"
}

Write-Host "Done. Verify Container App logs after sending a Bot Service test message."
