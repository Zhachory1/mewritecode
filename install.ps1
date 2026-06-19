#Requires -Version 5.1
<#
.SYNOPSIS
    Me Write Code installer for Windows.
.DESCRIPTION
    Downloads mewrite-windows-x64.zip, extracts to %LOCALAPPDATA%\mewrite\<version>\,
    writes mewrite.cmd, mewrite-code.cmd, and mewritecode.cmd shims into
    %LOCALAPPDATA%\mewrite\bin\, and prepends that to user PATH.

    Env knobs:
      MEWRITE_VERSION    Tag to install (default: latest)
      MEWRITE_PREFIX     Install root (default: %LOCALAPPDATA%\mewrite)
      MEWRITE_BASE_URL   Override the download base (used by smoke tests)
#>

$ErrorActionPreference = 'Stop'

$Repo = 'Zhachory1/mewritecode'
$KeepVersions = 2

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne 'AMD64') {
    throw "Unsupported architecture: $arch (only AMD64 builds are published)"
}
$Triple = 'windows-x64'

$Version = $env:MEWRITE_VERSION
if (-not $Version) {
    $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest"
    $Version = $release.tag_name
    if (-not $Version) { throw 'Could not resolve latest version from GitHub' }
}

$Prefix = $env:MEWRITE_PREFIX
if (-not $Prefix) { $Prefix = Join-Path $env:LOCALAPPDATA 'mewrite' }

$BaseUrl = $env:MEWRITE_BASE_URL
if (-not $BaseUrl) { $BaseUrl = "https://github.com/$Repo/releases/download/$Version" }

$Zip = "mewrite-$Triple.zip"
$Url = "$BaseUrl/$Zip"

$LibDir = Join-Path $Prefix 'lib'
$BinDir = Join-Path $Prefix 'bin'
$VerDir = Join-Path $LibDir $Version

Write-Host "Installing mewrite $Version ($Triple) into $Prefix"

New-Item -ItemType Directory -Force -Path $LibDir, $BinDir | Out-Null

$tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP "mewrite-install-$([guid]::NewGuid())")
try {
    $tmpZip = Join-Path $tmp.FullName $Zip
    Write-Host "  downloading $Url"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $tmpZip

    if (Test-Path $VerDir) { Remove-Item -Recurse -Force $VerDir }
    New-Item -ItemType Directory -Force -Path $VerDir | Out-Null

    Write-Host '  extracting'
    Expand-Archive -Path $tmpZip -DestinationPath $VerDir -Force
} finally {
    Remove-Item -Recurse -Force $tmp.FullName -ErrorAction SilentlyContinue
}

# Invokes mewrite.exe directly so process.execPath resolves inside $VerDir.
$exePath = Join-Path $VerDir 'mewrite.exe'
if (-not (Test-Path $exePath)) { throw "Extracted archive is missing mewrite.exe at $exePath" }

$shim = @"
@echo off
"%~dp0..\lib\$Version\mewrite.exe" %*
"@
Set-Content -Path (Join-Path $BinDir 'mewrite.cmd') -Value $shim -Encoding ASCII
Set-Content -Path (Join-Path $BinDir 'mewrite-code.cmd') -Value $shim -Encoding ASCII
Set-Content -Path (Join-Path $BinDir 'mewritecode.cmd') -Value $shim -Encoding ASCII

# Prune older versions
Get-ChildItem -Path $LibDir -Directory |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $KeepVersions |
    ForEach-Object {
        Write-Host "  pruning old version: $($_.Name)"
        Remove-Item -Recurse -Force $_.FullName
    }

# User PATH update
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = if ($userPath) { $userPath -split ';' } else { @() }
if (-not ($parts -contains $BinDir)) {
    $newPath = if ($userPath) { "$BinDir;$userPath" } else { $BinDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host ''
    Write-Host "Added $BinDir to user PATH. Open a new shell for it to take effect."
}

Write-Host ''
Write-Host "Installed: $VerDir"
& (Join-Path $BinDir 'mewrite.cmd') --version
