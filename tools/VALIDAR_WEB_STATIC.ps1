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

function Decode-HashU([string]$s) {
  return [regex]::Replace($s, '#U([0-9a-fA-F]{4})', {
    param($m)
    return [string][char]([Convert]::ToInt32($m.Groups[1].Value, 16))
  })
}

function Normalize-RelPath([string]$path) {
  $r = $path.Replace('\','/').TrimStart('/')
  if ($r.StartsWith('assets/templates/')) {
    $tail = $r.Substring('assets/templates/'.Length)
    $tail = (Decode-HashU $tail).ToLowerInvariant()
    if ($tail.Length -gt 0) { return 'assets/templates/' + $tail }
    return 'assets/templates'
  }
  return $r
}

function Get-DiskDirectListing([string]$relativeRoot) {
  $full = Join-Path $Root ($relativeRoot.Replace('/','\'))
  if (!(Test-Path -LiteralPath $full)) {
    return @{ folders = @(); files = @() }
  }
  $folders = @(Get-ChildItem -LiteralPath $full -Directory -Force | Where-Object { !$_.Name.StartsWith('.') } | ForEach-Object { $_.Name } | Sort-Object)
  $files = @(Get-ChildItem -LiteralPath $full -File -Force | Where-Object {
    !$_.Name.StartsWith('.') -and $_.Name -notin @('Thumbs.db','desktop.ini','.DS_Store')
  } | ForEach-Object { $_.Name } | Sort-Object)
  return @{ folders = $folders; files = $files }
}

function Compare-StringArrays([string]$label, $expected, $actual) {
  $left = @($expected | Sort-Object)
  $right = @($actual | Sort-Object)
  if (($left -join "`n") -ne ($right -join "`n")) {
    Add-Error ($label + " no coincide con el disco. Ejecuta GENERAR_ASSET_MANIFEST.bat otra vez.")
  }
}

if (!(Test-Path -LiteralPath $AppPath)) { Add-Error "Falta app.js" }
if (!(Test-Path -LiteralPath $AssetsPath)) { Add-Error "Falta assets/" }
if (!(Test-Path -LiteralPath $ManifestPath)) { Add-Error "Falta kitlab-data/asset_manifest.json" }

$manifest = $null
if (Test-Path -LiteralPath $ManifestPath) {
  try {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Add-Error "asset_manifest.json no es JSON valido"
  }
}

$dynamicRoots = @('assets/pattern', 'assets/team', 'assets/brand', 'assets/sponsor')

if ($null -ne $manifest) {
  if (!(Has-Property $manifest "dirs")) { Add-Error "Manifest incompleto: falta dirs" }
  if (!(Has-Property $manifest "dynamicRoots")) { Add-Error "Manifest incompleto: falta dynamicRoots" }
  if (!(Has-Property $manifest "textFiles")) { Add-Error "Manifest incompleto: falta textFiles" }

  if (Has-Property $manifest "dirs") {
    $requiredDirs = @(
      'assets/pattern',
      'assets/flags',
      'assets/team',
      'assets/armband',
      'assets/brand',
      'assets/sponsor'
    )
    foreach ($key in $requiredDirs) {
      if (!(Has-Property $manifest.dirs $key)) { Add-Error ("Manifest incompleto: falta " + $key) }
    }

    foreach ($rootPath in $dynamicRoots) {
      if (!(Has-Property $manifest.dirs $rootPath)) { continue }
      $disk = Get-DiskDirectListing $rootPath
      $manifestEntry = $manifest.dirs.PSObject.Properties[$rootPath].Value
      Compare-StringArrays ($rootPath + " / carpetas") $disk.folders @($manifestEntry.folders)
      Compare-StringArrays ($rootPath + " / archivos") $disk.files @($manifestEntry.files)
    }
  }

  if (Has-Property $manifest "dynamicRoots") {
    foreach ($rootPath in $dynamicRoots) {
      if (!(Has-Property $manifest.dynamicRoots $rootPath)) {
        Add-Error ("dynamicRoots incompleto: falta " + $rootPath)
      }
    }
  }

  if (Has-Property $manifest "textFiles") {
    $diskTxt = @(Get-ChildItem -LiteralPath $AssetsPath -Recurse -File -Filter '*.txt' | ForEach-Object {
      Normalize-RelPath ('assets/' + $_.FullName.Substring($AssetsPath.Length).TrimStart('\','/'))
    } | Sort-Object)
    $manifestTxt = @($manifest.textFiles | ForEach-Object { Normalize-RelPath ([string]$_) } | Sort-Object)
    Compare-StringArrays 'TXT registrados' $diskTxt $manifestTxt
  }
}

if (Test-Path -LiteralPath $AppPath) {
  $app = Get-Content -LiteralPath $AppPath -Raw -Encoding UTF8
  $needles = @(
    'v1.3.262_dynamic_daily_assets_web',
    'kitlab-data/asset_manifest.json',
    'refreshKitlabStaticAssetManifest',
    'refreshTeamRootFoldersFromManifest',
    'kitlabDynamicAssetUrl',
    'kitlabStaticManifestHasTextFile',
    'refreshInternalBrandsFromFolder',
    'refreshInternalSponsorsFromFolder',
    'refreshPatternGalleryFolder'
  )
  foreach ($needle in $needles) {
    if ($app.IndexOf($needle) -lt 0) { Add-Error ("app.js no contiene: " + $needle) }
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $node) {
    & $node.Source --check $AppPath 2>$null
    if ($LASTEXITCODE -ne 0) { Add-Error 'app.js tiene un error de sintaxis JavaScript' }
  }
}

if ($errors.Count -eq 0) {
  Write-Host ""
  Write-Host "VALIDACION OK: web estatica dinamica lista para Cloudflare." -ForegroundColor Green
  Write-Host "Pattern, Team, Brand, Sponsor y TXT coinciden con el manifest." -ForegroundColor Green
  Write-Host "Templates y collars permanecen controlados manualmente." -ForegroundColor Yellow
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "VALIDACION FALLIDA:" -ForegroundColor Red
foreach ($err in $errors) { Write-Host ("- " + $err) -ForegroundColor Red }
Write-Host ""
exit 1
