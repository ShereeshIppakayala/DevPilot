$ErrorActionPreference = 'Stop'

function ConvertTo-Base64Url([byte[]]$Bytes) {
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-Base64UrlSecret([int]$Length) {
  $bytes = New-Object byte[] $Length
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return ConvertTo-Base64Url $bytes
  }
  finally {
    $generator.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

function Set-EnvValue([System.Collections.Generic.List[string]]$Lines, [string]$Name, [string]$Value) {
  $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
  $replacement = "$Name=`"$escaped`""
  $found = $false

  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index] -match "^\s*$([regex]::Escape($Name))=") {
      $Lines[$index] = $replacement
      $found = $true
    }
  }

  if (-not $found) {
    $Lines.Add($replacement)
  }
}

$envPath = Join-Path $PSScriptRoot '..\.env'
$examplePath = Join-Path $PSScriptRoot '..\.env.example'

if (Test-Path $envPath) {
  $confirmation = Read-Host 'Update GitHub App settings in the existing backend/.env? (y/N)'
  if ($confirmation -notmatch '^(y|yes)$') {
    Write-Output 'No changes made.'
    exit 0
  }
  $lines = [System.Collections.Generic.List[string]]::new([string[]](Get-Content -LiteralPath $envPath))
}
else {
  $lines = [System.Collections.Generic.List[string]]::new([string[]](Get-Content -LiteralPath $examplePath))
}

$clientId = (Read-Host 'GitHub App Client ID').Trim()
$appSlug = (Read-Host 'GitHub App URL slug').Trim()
if ([string]::IsNullOrWhiteSpace($clientId)) {
  throw 'GitHub App Client ID cannot be empty.'
}
if ($appSlug -notmatch '^[A-Za-z0-9-]+$') {
  throw 'GitHub App slug must contain only letters, numbers, and hyphens.'
}

$secureSecret = Read-Host 'GitHub App Client Secret (input is hidden)' -AsSecureString
$secretPointer = [IntPtr]::Zero
$clientSecret = $null
try {
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
}
finally {
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  $secureSecret.Dispose()
}

if ([string]::IsNullOrWhiteSpace($clientSecret)) {
  throw 'GitHub App Client Secret cannot be empty.'
}

Set-EnvValue $lines 'GITHUB_APP_CLIENT_ID' $clientId
Set-EnvValue $lines 'GITHUB_APP_CLIENT_SECRET' $clientSecret
Set-EnvValue $lines 'GITHUB_APP_SLUG' $appSlug
Set-EnvValue $lines 'GITHUB_APP_CALLBACK_URL' 'http://127.0.0.1:4000/api/v1/integrations/github/callback'
Set-EnvValue $lines 'FRONTEND_URL' 'http://localhost:5173'

$existingJwt = $lines | Where-Object { $_ -match '^\s*JWT_SECRET=(.*)$' } | Select-Object -Last 1
if (-not $existingJwt -or $existingJwt -match '^\s*JWT_SECRET=\s*["'']?\s*["'']?\s*$') {
  Set-EnvValue $lines 'JWT_SECRET' (New-Base64UrlSecret 48)
}

$existingEncryptionKey = $lines | Where-Object { $_ -match '^\s*GITHUB_TOKEN_ENCRYPTION_KEY=(.*)$' } | Select-Object -Last 1
if (-not $existingEncryptionKey -or $existingEncryptionKey -match '^\s*GITHUB_TOKEN_ENCRYPTION_KEY=\s*["'']?\s*["'']?\s*$') {
  Set-EnvValue $lines 'GITHUB_TOKEN_ENCRYPTION_KEY' (New-Base64UrlSecret 32)
}

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllLines((Resolve-Path (Split-Path $envPath -Parent)).Path + '\.env', $lines, $utf8WithoutBom)
$clientSecret = $null

Write-Output 'GitHub App settings saved to backend/.env. Secret values were not displayed.'
Write-Output 'Confirm that the GitHub App callback URL is http://127.0.0.1:4000/api/v1/integrations/github/callback.'
Write-Output 'Restart the backend before testing the connection.'