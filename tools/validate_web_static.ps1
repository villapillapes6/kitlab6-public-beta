$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$errors = New-Object System.Collections.Generic.List[string]

function Add-ValidationError([string]$message) {
    $errors.Add($message)
    Write-Host "ERROR: $message" -ForegroundColor Red
}

$required = @(
    "index.html",
    "app.js",
    "style.css",
    "kitlab3d.js",
    "assets",
    "kitlab-data/asset_manifest.json"
)

foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $relative))) {
        Add-ValidationError "Falta $relative"
    }
}

$forbidden = @(
    "kitlab6_server.py",
    "SERVER_KITLAB6.bat",
    "START_KITLAB6_LOCAL_PES6.bat",
    "EJECUTAR_KITLAB6_FIX.bat",
    "__pycache__"
)

foreach ($relative in $forbidden) {
    if (Test-Path -LiteralPath (Join-Path $Root $relative)) {
        Add-ValidationError "La entrega web contiene un archivo exclusivo de Local: $relative"
    }
}

$indexPath = Join-Path $Root "index.html"
if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
    $indexText = [System.IO.File]::ReadAllText($indexPath)
    if ($indexText -notmatch '<title>KitLab6 by VillaPilla</title>') {
        Add-ValidationError "El titulo de la pestana no es KitLab6 by VillaPilla"
    }
    if ($indexText -notmatch 'src="\./app\.js\?v=') {
        Add-ValidationError "index.html no carga app.js con revision de cache"
    }
    if ($indexText -notmatch 'src="\./kitlab3d\.js\?v=') {
        Add-ValidationError "index.html no carga kitlab3d.js con revision de cache"
    }
}

$manifestPath = Join-Path $Root "kitlab-data/asset_manifest.json"
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $manifest.dirs) {
            Add-ValidationError "El manifiesto no contiene dirs"
        } else {
            foreach ($property in $manifest.dirs.PSObject.Properties) {
                $dirPath = Join-Path $Root ($property.Name.Replace("/", "\"))
                if (-not (Test-Path -LiteralPath $dirPath -PathType Container)) {
                    Add-ValidationError "Directorio inexistente en el manifiesto: $($property.Name)"
                    continue
                }
                foreach ($fileName in @($property.Value.files)) {
                    $filePath = Join-Path $dirPath $fileName
                    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
                        Add-ValidationError "Asset inexistente en el manifiesto: $($property.Name)/$fileName"
                    }
                }
            }
        }
        foreach ($relative in @($manifest.textFiles)) {
            if (-not (Test-Path -LiteralPath (Join-Path $Root ($relative.Replace("/", "\"))) -PathType Leaf)) {
                Add-ValidationError "TXT inexistente en el manifiesto: $relative"
            }
        }
    } catch {
        Add-ValidationError "No se puede leer asset_manifest.json: $($_.Exception.Message)"
    }
}

$requiredDefaults = @(
    "assets/templates/macron/macron 24-25/short/v1/template_defaults.json",
    "assets/templates/macron/macron 26-27/short/v1/template_defaults.json",
    "assets/templates/macron/macron gk 26-27 v2/template_defaults.json"
)
foreach ($relative in $requiredDefaults) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
        Add-ValidationError "Falta la configuracion web: $relative"
    }
}

$forbiddenUsedBy = @(
    "assets/templates/macron/macron 24-25/short/v1/used_by.txt",
    "assets/templates/macron/macron 26-27/short/v1/used_by.txt",
    "assets/templates/macron/macron gk 26-27 v2/used_by.txt",
    "assets/templates/macron/macron gk 26-27 v2/shirt/used_by.txt"
)
foreach ($relative in $forbiddenUsedBy) {
    if (Test-Path -LiteralPath (Join-Path $Root $relative)) {
        Add-ValidationError "Este used_by.txt no debe existir en Web Real: $relative"
    }
}

$zeroByteAssets = @(
    Get-ChildItem -LiteralPath (Join-Path $Root "assets") -File -Recurse |
        Where-Object { $_.Length -eq 0 -and $_.Name -ine "used_by.txt" }
)
foreach ($file in $zeroByteAssets) {
    Add-ValidationError "Asset vacio: $($file.FullName.Substring($Root.Length + 1))"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    & $node.Source --check (Join-Path $Root "app.js")
    if ($LASTEXITCODE -ne 0) { Add-ValidationError "app.js no supera node --check" }
    & $node.Source --check (Join-Path $Root "kitlab3d.js")
    if ($LASTEXITCODE -ne 0) { Add-ValidationError "kitlab3d.js no supera node --check" }
}

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "VALIDACION FALLIDA: $($errors.Count) error(es)." -ForegroundColor Red
    exit 1
}

$assetCount = @(Get-ChildItem -LiteralPath (Join-Path $Root "assets") -File -Recurse).Count
Write-Host ""
Write-Host "VALIDACION CORRECTA" -ForegroundColor Green
Write-Host "Assets comprobados: $assetCount"
Write-Host "Titulo: KitLab6 by VillaPilla"
Write-Host "La carpeta esta lista para subir a GitHub."
