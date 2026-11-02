[CmdletBinding()]
param(
    [string]$AppHome = $(if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config/herdr-app' })
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This installer supports Windows only.' }

$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../mods/discord-rpc'))
$AppHome = [IO.Path]::GetFullPath($AppHome)
$directory = Join-Path $AppHome 'mods/discord-rpc'
$runtime = Join-Path $AppHome 'data/discord-rpc'
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$version = & $node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 20) {
    throw 'Windows Node.js 20 or newer is required.'
}
foreach ($file in @('main.js', 'bridge.mjs', 'config.example.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) {
        throw "Missing source file: $file. Run the installer from a complete checkout."
    }
}

New-Item -ItemType Directory -Path $directory, $runtime -Force | Out-Null
foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
    if ($file.Name -eq 'config.json' -or $file.Name.StartsWith('.')) { continue }
    $relative = $file.FullName.Substring($source.Length).TrimStart([char[]]'\/')
    $destination = Join-Path $directory $relative
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    if ($file.FullName -ne $destination) { Copy-Item -LiteralPath $file.FullName -Destination $destination -Force }
}
$config = Join-Path $directory 'config.json'
if (-not (Test-Path -LiteralPath $config)) {
    Copy-Item -LiteralPath (Join-Path $directory 'config.example.json') -Destination $config
}

Write-Output "Installed Discord RPC files at $directory. Existing configuration was preserved."
Write-Output 'To start presence, add one host pane to an existing tab:'
Write-Output 'herdr-app do pane.split ''{"direction":"right","mod":"discord-rpc","props":{"presenceHost":true}}'''
Write-Output 'Show that pane once after Herdr starts. It stays alive across tab and layout switches; closing it stops presence.'
Write-Output 'No login task, startup launcher, or pane was created. Existing external startup mechanisms are not changed.'
Write-Output "Runtime status: $(Join-Path $runtime '.status.json')"
