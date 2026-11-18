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
$tempRoot = (Get-Item -LiteralPath ([IO.Path]::GetTempPath())).FullName
$stage = Join-Path $tempRoot ("voice-release-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    # Build the exact snapshot being packaged. Generated assets in the working
    # tree may be missing or stale and are never used as the release output.
    $builtRoomAssets = @('src/views/js/room/startup-assets.json', 'src/views/js/room/startup.runtime.min.js', 'src/views/js/room/startup.mainScript.min.js', 'src/views/styles/startup.min.css')
    $entries = @{}
    foreach ($file in $files) {
        $name = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
        if ($name -in $builtRoomAssets) { continue }
        $target = Join-Path $stage $name
        [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
        [IO.File]::Copy($file.FullName, $target)
        $entries[$name] = $target
    }
    & node (Join-Path $PSScriptRoot 'build-room-assets.mjs') (Join-Path $stage 'src/views')
    if ($LASTEXITCODE -ne 0) { throw "Room asset build failed (exit $LASTEXITCODE)." }
    foreach ($name in $builtRoomAssets) {
        $target = Join-Path $stage $name
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Missing built room asset: $name" }
        $entries[$name] = $target
    }

    $expected = @{}
    $candidate = Join-Path $stage 'candidate.zip'
    $archive = [IO.Compression.ZipFile]::Open($candidate, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in ($entries.Keys | Sort-Object)) {
            $target = $entries[$name]
            $expected[$name] = Get-ReleaseHash $target
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $target, $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }

    # Reopen and independently verify every entry before publishing the ZIP.
    $archive = [IO.Compression.ZipFile]::OpenRead($candidate)
    try {
        if ($archive.Entries.Count -ne $expected.Count) { throw 'Archive entry count mismatch.' }
        foreach ($entry in $archive.Entries) {
            if (-not $expected.ContainsKey($entry.FullName)) { throw "Unexpected or duplicate ZIP entry: $($entry.FullName)" }
            $stream = $entry.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
            finally { $stream.Dispose(); $sha.Dispose() }
            if ($hash -ne $expected[$entry.FullName]) { throw "Hash mismatch: $($entry.FullName)" }
            $expected.Remove($entry.FullName)
        }
    } finally { $archive.Dispose() }
    $releaseHash = Get-ReleaseHash $candidate
    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    [IO.File]::Move($candidate, $archivePath)
    Write-Host "Verified archive: $archivePath"
    Write-Host "Files: $($entries.Count)"
    Write-Host "SHA256: $releaseHash"
} finally {
    $resolvedStage = Get-Item -LiteralPath $stage
    if ($resolvedStage.FullName -eq $stage -and $resolvedStage.Parent.FullName -eq $tempRoot -and -not ($resolvedStage.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $resolvedStage.FullName -Recurse -Force
    }
}
Write-Host 'Packaging only. Tests and deployment acceptance are separate; no deployment performed.'
