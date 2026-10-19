# Harry AI FILM STUDIO — Windows launcher (used by the desktop / Start-menu shortcut).
# Starts the studio in the background if it is not already running, then opens it in its own
# app window (Microsoft Edge app mode: no address bar or tabs, own taskbar entry). The studio
# shuts itself down about a minute after the last window closes (unless a generation is running).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:4517'
$logDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Studio { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$url/api/health").StatusCode -eq 200 } catch { $false } }

if (-not (Test-Studio)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Node.js was not found. Install Node.js 24+ and try again.', 'Harry AI FILM STUDIO') | Out-Null; exit 1 }
  $env:STUDIO_APP_MODE = '1'
  Start-Process -FilePath $node -ArgumentList 'server\index.js' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'studio.log') -RedirectStandardError (Join-Path $logDir 'studio-error.log')
  for ($i = 0; $i -lt 60 -and -not (Test-Studio); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Studio)) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("The studio did not start. See $logDir\studio-error.log", 'Harry AI FILM STUDIO') | Out-Null; exit 1 }
}

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) {
  # Own profile folder = a separate window/taskbar entry that never mixes with your normal browsing.
  $profileDir = Join-Path $env:LOCALAPPDATA 'HarryAIFilmStudio\window'
  Start-Process -FilePath $edge -ArgumentList "--app=$url", "--user-data-dir=`"$profileDir`"", '--window-size=1600,1000', '--no-first-run', '--no-default-browser-check'
} else {
  Start-Process $url  # fallback: default browser
}
