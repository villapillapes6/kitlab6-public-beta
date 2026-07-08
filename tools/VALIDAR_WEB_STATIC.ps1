$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

$ManifestPath = Join-Path $Root "kitlab-data\asset_manifest.json"
$AppPath = Join-Path $Root "app.js"
$AssetsPath = Join-Path $Root "assets"

$errors = New-Object System.Collections.Generic.List[string]

function Add-Error([string]$msg) {
  $script:errors.Add($msg) | Out-Null
}

function Has-Property($obj, [string]$name) {
  if ($null -eq $obj) { return $false }
  return ($obj.PSObject.Properties.Name -contains $name)
}

if (!(Test-Path -LiteralPath $AppPath)) {
  Add-Error "Falta app.js"
}

if (!(Test-Path -LiteralPath $AssetsPath)) {
  Add-Error "Falta assets/"
}

if (!(Test-Path -LiteralPath $ManifestPath)) {
  Add-Error "Falta kitlab-data/asset_manifest.json"
}

$manifest = $null
if (Test-Path -LiteralPath $ManifestPath) {
  try {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Add-Error "asset_manifest.json no es JSON valido"
  }
}

if ($null -ne $manifest) {
  if (!(Has-Property $manifest "dirs")) {
    Add-Error "Manifest incompleto: falta dirs"
  } else {
    $requiredDirs = @(
      "assets/pattern",
      "assets/flags",
      "assets/team",
      "assets/armband",
      "assets/brand",
      "assets/sponsor"
    )

    foreach ($key in $requiredDirs) {
      if (!(Has-Property $manifest.dirs $key)) {
        Add-Error ("Manifest incompleto: falta " + $key)
      }
    }
  }
}

if (Test-Path -LiteralPath $AppPath) {
  $app = Get-Content -LiteralPath $AppPath -Raw -Encoding UTF8

  $needles = @(
    "kitlab-data/asset_manifest.json",
    "refreshArmbandRootFoldersFromDisk",
    'listKitlabAssetDirectory(["assets", "armband"])'
  )

  foreach ($needle in $needles) {
    if ($app.IndexOf($needle) -lt 0) {
      Add-Error ("app.js no contiene: " + $needle)
    }
  }
}

if ($errors.Count -eq 0) {
  Write-Host ""
  Write-Host "VALIDACION OK: base web estatica lista para Cloudflare." -ForegroundColor Green
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "VALIDACION FALLIDA:" -ForegroundColor Red
foreach ($err in $errors) {
  Write-Host ("- " + $err) -ForegroundColor Red
}
Write-Host ""
exit 1
