param(
    [string]$BaseUrl = "http://localhost:8080",
    [string]$Message = "hello from adapter smoke test",
    [switch]$FoundryTest,
    [string]$TestApiKey
)

$ErrorActionPreference = "Stop"

$health = Invoke-RestMethod -Method Get -Uri "$($BaseUrl.TrimEnd('/'))/health"
Write-Host "Health: $($health.status)"

if (-not $FoundryTest) {
    Write-Host "Skipping Foundry test. Pass -FoundryTest only when ENABLE_LOCAL_TEST_ENDPOINTS=true."
    return
}

$body = @{
    input = $Message
} | ConvertTo-Json

$headers = @{}
if ($TestApiKey) {
    $headers["x-test-api-key"] = $TestApiKey
}

$response = Invoke-RestMethod `
    -Method Post `
    -Uri "$($BaseUrl.TrimEnd('/'))/api/test/foundry" `
    -ContentType "application/json" `
    -Headers $headers `
    -Body $body

$response | ConvertTo-Json -Depth 10
