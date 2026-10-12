$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ReleaseHash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^[0-9A-Za-z.-]+$') { throw 'Invalid package version.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$archivePath = Join-Path $releaseRoot "webrtc-video-chat-$version-$stamp.zip"

# Explicit allowlist; never traverse the workspace root for packaging.
$files = @()
$sourceRoot = Join-Path $projectRoot 'src'
$sourceItem = Get-Item -LiteralPath $sourceRoot
if ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'src must not be a link.' }
$sourceEntries = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -Force)
foreach ($entry in $sourceEntries) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Links are not allowed: $($entry.FullName)" }
    if ($entry.Name -match '^(\.env($|\.)|node_modules$|\.git$|cert$|logs$|data$)' -or $entry.Extension -in @('.key', '.pem', '.zip')) {
        throw "Unexpected sensitive/runtime entry in src: $($entry.FullName)"
    }
    if (-not $entry.PSIsContainer) { $files += $entry }
}
foreach ($relative in @('package.json', 'package-lock.json', '.env.example', 'LICENSE', 'docs/RELEASE.md')) {
    $entry = Get-Item -LiteralPath (Join-Path $projectRoot $relative)
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Links are not allowed: $relative" }
    $files += $entry
}
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$expected = @{}
$archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $name = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
        $expected[$name] = Get-ReleaseHash $file.FullName
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }

# Reopen and independently verify every entry, not just ZIP creation success.
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    if ($archive.Entries.Count -ne $expected.Count) { throw 'Archive entry count mismatch.' }
    foreach ($entry in $archive.Entries) {
        if (-not $expected.ContainsKey($entry.FullName)) { throw "Unexpected ZIP entry: $($entry.FullName)" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($hash -ne $expected[$entry.FullName]) { throw "Hash mismatch: $($entry.FullName)" }
    }
} finally { $archive.Dispose() }
Write-Host "Verified archive: $archivePath"
Write-Host "Files: $($expected.Count)"
Write-Host "SHA256: $(Get-ReleaseHash $archivePath)"
Write-Host 'Packaging only. Tests and deployment acceptance are separate; no deployment performed.'
