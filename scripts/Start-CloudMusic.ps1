# User-invoked launcher; never called automatically by the MCP server.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CloudMusicPath,
    [ValidateRange(1024, 65535)][int]$Port = 9229,
    [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$resolvedMusicPath = (Resolve-Path -LiteralPath $CloudMusicPath).ProviderPath
if ([IO.Path]::GetFileName($resolvedMusicPath) -ine 'cloudmusic.exe') { throw 'Expected the cloudmusic.exe executable.' }
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    & "$PSScriptRoot\Inspect-CloudMusic.ps1" -CloudMusicPath $resolvedMusicPath -Port $Port
    if (-not $?) { throw 'Port ownership or loopback verification failed.' }
    Write-Output 'An eligible CloudMusic listener is already running. No restart performed.'
    return
}
$runningMusic = @(Get-Process cloudmusic -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $resolvedMusicPath })
if ($runningMusic.Count -gt 0 -and -not $Restart) {
    throw 'CloudMusic is running without the debug port. Exit it yourself, or explicitly use -Restart to interrupt playback.'
}
if ($runningMusic.Count -gt 0) {
    Write-Warning 'Restarting the specified CloudMusic client; current playback will be interrupted.'
    foreach ($musicProcess in $runningMusic) {
        if ($musicProcess.MainWindowHandle -ne 0) { $musicProcess.CloseMainWindow() | Out-Null }
    }
    Start-Sleep -Seconds 2
    # Re-enumerate and re-validate the full executable path before stopping any process.
    Get-Process cloudmusic -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -ieq $resolvedMusicPath } |
        Stop-Process -ErrorAction Stop
}
Start-Process -FilePath $resolvedMusicPath -ArgumentList "--remote-debugging-port=$Port",'--remote-debugging-address=127.0.0.1' -WindowStyle Hidden
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { $ready = $true; break }
}
if (-not $ready) { throw 'No debug listener appeared. This client may not accept the flags; no MCP connection was established.' }
& "$PSScriptRoot\Inspect-CloudMusic.ps1" -CloudMusicPath $resolvedMusicPath -Port $Port
if (-not $?) { throw 'Listener validation failed; do not connect the MCP.' }
Write-Output 'Loopback listener ownership verified. UI compatibility still needs testing.'
