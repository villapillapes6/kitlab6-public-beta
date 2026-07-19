$ErrorActionPreference = "Stop"

function Decode-HashU([string]$s) {
  return [regex]::Replace($s, '#U([0-9a-fA-F]{4})', {
    param($m)
    return [string][char]([Convert]::ToInt32($m.Groups[1].Value, 16))
  })
}

function Add-Dir($dirs, [string]$key) {
  if (!$key) { return }
  if (!$dirs.ContainsKey($key)) {
    $dirs[$key] = @{
      folders = New-Object System.Collections.Generic.HashSet[string]
      files = New-Object System.Collections.Generic.HashSet[string]
    }
  }
}

function Transform-Rel([string]$rel) {
  $r = $rel.Replace('\','/').Trim('/')
  if ($r.StartsWith('assets/templates/')) {
    $tail = $r.Substring('assets/templates/'.Length)
    $tail = (Decode-HashU $tail).ToLowerInvariant()
    if ($tail.Length -gt 0) { return 'assets/templates/' + $tail }
    return 'assets/templates'
  }
  return $r
}

function Is-IgnoredAssetName([string]$name) {
  if (!$name) { return $true }
  return $name -in @('.DS_Store', 'Thumbs.db', 'desktop.ini') -or $name.StartsWith('._')
}

$Root = Split-Path -Parent $PSScriptRoot
$Assets = Join-Path $Root 'assets'
if (!(Test-Path -LiteralPath $Assets)) { throw "No encuentro assets en $Root" }

$Data = Join-Path $Root 'kitlab-data'
New-Item -ItemType Directory -Force -Path $Data | Out-Null

$dirs = @{}
$allFiles = New-Object System.Collections.Generic.HashSet[string]
$textFiles = New-Object System.Collections.Generic.HashSet[string]
Add-Dir $dirs 'assets'

$items = Get-ChildItem -LiteralPath $Assets -Recurse -Force
foreach ($item in $items) {
  if (Is-IgnoredAssetName $item.Name) { continue }

  $relRaw = 'assets/' + $item.FullName.Substring($Assets.Length).TrimStart('\','/').Replace('\','/')
  $rel = Transform-Rel $relRaw
  $parts = $rel.Split('/') | Where-Object { $_ -ne '' }
  if ($parts.Count -eq 0) { continue }

  if ($item.PSIsContainer) {
    $dirKey = ($parts -join '/')
    Add-Dir $dirs $dirKey
    if ($parts.Count -gt 1) {
      $parent = ($parts[0..($parts.Count-2)] -join '/')
      Add-Dir $dirs $parent
      [void]$dirs[$parent].folders.Add($parts[-1])
    }
    continue
  }

  [void]$allFiles.Add($rel)
  if ([System.IO.Path]::GetExtension($item.Name).ToLowerInvariant() -eq '.txt') {
    [void]$textFiles.Add($rel)
  }

  if ($parts.Count -gt 1) {
    $parent = ($parts[0..($parts.Count-2)] -join '/')
    Add-Dir $dirs $parent
    [void]$dirs[$parent].files.Add($parts[-1])
    for ($i=1; $i -lt ($parts.Count-1); $i++) {
      $p = ($parts[0..($i-1)] -join '/')
      $child = $parts[$i]
      Add-Dir $dirs $p
      [void]$dirs[$p].folders.Add($child)
    }
  }
}

$outDirs = [ordered]@{}
foreach ($key in ($dirs.Keys | Sort-Object)) {
  $outDirs[$key] = [ordered]@{
    folders = @($dirs[$key].folders | Sort-Object)
    files = @($dirs[$key].files | Sort-Object)
  }
}

$imageExtensions = @('.png', '.webp', '.jpg', '.jpeg', '.svg')
$dynamicRootPaths = @('assets/pattern', 'assets/team', 'assets/brand', 'assets/sponsor')
$dynamicRoots = [ordered]@{}
foreach ($rootPath in $dynamicRootPaths) {
  $rootEntry = $outDirs[$rootPath]
  $imageCount = @($allFiles | Where-Object {
    $_.StartsWith($rootPath + '/') -and ($imageExtensions -contains [System.IO.Path]::GetExtension($_).ToLowerInvariant())
  }).Count
  $directFolders = @()
  $directFiles = @()
  if ($null -ne $rootEntry) {
    $directFolders = @($rootEntry.folders)
    $directFiles = @($rootEntry.files | Where-Object { $imageExtensions -contains [System.IO.Path]::GetExtension($_).ToLowerInvariant() })
  }
  $dynamicRoots[$rootPath] = [ordered]@{
    mode = 'manifest-authoritative'
    imageFiles = $imageCount
    directFolders = $directFolders
    directFiles = $directFiles
  }
}

$out = [ordered]@{
  version = '1.3.262-web-dynamic-daily-assets'
  generated = (Get-Date).ToUniversalTime().ToString('o')
  purpose = 'KitLab6 static catalog: dynamic Pattern, Team, Brand, Sponsor and TXT; templates remain controlled in app.js'
  dynamicRoots = $dynamicRoots
  textFiles = @($textFiles | Sort-Object)
  files = @($allFiles | Sort-Object)
  dirs = $outDirs
}

$outPath = Join-Path $Data 'asset_manifest.json'
$out | ConvertTo-Json -Depth 10 | Out-File -LiteralPath $outPath -Encoding UTF8

Write-Host ""
Write-Host "Manifest generado correctamente:" -ForegroundColor Green
Write-Host $outPath
Write-Host ""
foreach ($rootPath in $dynamicRootPaths) {
  Write-Host ("- " + $rootPath + ": " + $dynamicRoots[$rootPath].imageFiles + " imagenes")
}
Write-Host ("- TXT registrados: " + $textFiles.Count)
Write-Host ""
Write-Host "Los templates y collars siguen siendo inserciones controladas en app.js." -ForegroundColor Yellow
