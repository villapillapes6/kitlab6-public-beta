$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$AssetsRoot = Join-Path $Root "assets"
$OutputDirectory = Join-Path $Root "kitlab-data"
$OutputFile = Join-Path $OutputDirectory "asset_manifest.json"

if (-not (Test-Path -LiteralPath $AssetsRoot -PathType Container)) {
    throw "No se encontro la carpeta assets en la raiz de KitLab6."
}

$rootPrefix = (Resolve-Path -LiteralPath $Root).Path.TrimEnd("\") + "\"
$directories = @((Get-Item -LiteralPath $AssetsRoot)) + @(Get-ChildItem -LiteralPath $AssetsRoot -Directory -Recurse)
$directories = $directories | Sort-Object FullName
$manifestDirectories = [ordered]@{}

foreach ($directory in $directories) {
    $relative = $directory.FullName.Substring($rootPrefix.Length).Replace("\", "/")
    $folders = @(
        Get-ChildItem -LiteralPath $directory.FullName -Directory |
        Sort-Object Name |
        ForEach-Object { $_.Name }
    )
    $files = @(
        Get-ChildItem -LiteralPath $directory.FullName -File |
        Where-Object { $_.Extension -match '^\.(png|webp|jpg|jpeg|svg)$' } |
        Sort-Object Name |
        ForEach-Object { $_.Name }
    )
    $manifestDirectories[$relative] = [ordered]@{
        folders = $folders
        files = $files
    }
}

$textFiles = @(
    Get-ChildItem -LiteralPath $AssetsRoot -File -Recurse -Filter "*.txt" |
    Sort-Object FullName |
    ForEach-Object { $_.FullName.Substring($rootPrefix.Length).Replace("\", "/") }
)

$generated = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$payload = [ordered]@{
    version = 1
    generated = $generated
    dirs = $manifestDirectories
    textFiles = $textFiles
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$json = $payload | ConvertTo-Json -Depth 8
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputFile, $json, $utf8NoBom)

Write-Host "Asset manifest generado correctamente." -ForegroundColor Green
Write-Host "Directorios: $($manifestDirectories.Count)"
Write-Host "TXT registrados: $($textFiles.Count)"
Write-Host "Archivo: $OutputFile"
