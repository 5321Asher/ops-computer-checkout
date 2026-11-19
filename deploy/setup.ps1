# Installs Equipment Checkout on this computer, in one folder that holds everything it needs: the
# program, its records (checkouts.db), the Excel copy (checkouts.xlsx), the ticket list
# (ticketList.json) and createTickets.ps1. Nothing outside that folder is used.
#   1. Asks for the folder (C:\equipment_checkout unless you choose another). It must be new or
#      empty: setup never changes a folder that already has files in it.
#   2. Asks for the location's name (e.g. 46 Water Street), shown at the top of the pages.
#   3. Copies the program there from this copy of the repository, and installs its modules with npm.
#
# Run it from a copy of the repository: right-click deploy\setup.ps1, Run with PowerShell.
# Connect to Global Connect first: npm needs it to download the modules.
# Works with Windows PowerShell 5.1 and PowerShell 7. Keep this file plain ASCII.

$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$DefaultInstallFolder = 'C:\equipment_checkout'
$MinNodeVersion = [version]'22.13.0'
$Port = 3000
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
# The program's own files and folders, copied from the repository.
$ProgramFiles = @('server.js', 'package.json', 'package-lock.json', 'start.cmd', 'README.md', 'deploy\createTickets.ps1')
$ProgramFolders = @('lib', 'public', 'scripts')

function Ask($question, $default) {
    $answer = (Read-Host $question).Trim()
    if (-not $answer) { return $default }
    return $answer
}

function Read-YesNo($question) {
    return (Read-Host "$question (y/n)").Trim().ToLower() -eq 'y'
}

# Copies a folder with robocopy, which is much faster than Copy-Item for many small files.
# /MIR: the copy ends up exactly like the original (old files in it are removed).
function Copy-Folder($from, $to) {
    # /R:2 /W:2: don't retry a locked file for ages. /NFL /NDL /NJH /NJS /NP: only print problems.
    & robocopy $from $to /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Host
    # robocopy exit codes 0 to 7 mean success; 8 or more mean some files couldn't be copied.
    if ($LASTEXITCODE -ge 8) { throw "Copying $from to $to failed (robocopy exit code $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

# Runs a program that prints notices on stderr (npm, git) and returns its output, or $null if it
# failed. .cmd launchers rather than .ps1 ones, so PowerShell's execution policy can't block them.
function Invoke-Quietly([string]$program, [string[]]$arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $program @arguments 2>$null
        if ($LASTEXITCODE -eq 0) { return "$output".Trim() }
        return $null
    } catch {
        return $null
    } finally {
        $ErrorActionPreference = $previous
        $global:LASTEXITCODE = 0
    }
}

function Write-TextFile($path, $text) {
    [System.IO.File]::WriteAllText($path, $text, $Utf8NoBom)
}

function Test-ProgramRunning {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        return $client.ConnectAsync('127.0.0.1', $Port).Wait(500) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-EmptyFolder($folder) {
    return -not (Test-Path -LiteralPath $folder) -or -not (Get-ChildItem -LiteralPath $folder -Force | Select-Object -First 1)
}

function Main {
    Write-Host 'Equipment Checkout setup' -ForegroundColor Cyan
    Write-Host ''

    # ----- What this computer needs -----
    $nodeVersion = $null
    try { $nodeVersion = [version]((& node --version) -replace '^v', '') } catch { }
    if (-not $nodeVersion) {
        throw 'Node.js is not installed on this computer. Install the LTS version from https://nodejs.org, then run setup again.'
    }
    if ($nodeVersion -lt $MinNodeVersion) {
        throw "This computer has Node.js $nodeVersion, but Equipment Checkout needs $MinNodeVersion or newer. Install the LTS version from https://nodejs.org, then run setup again."
    }
    Write-Host "Node.js $nodeVersion is installed."
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'npm is missing (it comes with Node.js). Reinstall the LTS version from https://nodejs.org, then run setup again.'
    }
    # Checked before anything is changed, so a missing connection can't leave a half-finished setup.
    if ($null -eq (Invoke-Quietly 'npm.cmd' @('ping'))) {
        throw "npm can't reach the npm registry to download the program's modules. Connect to Global Connect, then run setup again. Nothing was changed."
    }
    Write-Host 'npm can reach the npm registry.'

    if (Test-ProgramRunning) {
        throw 'Equipment Checkout is running on this computer. Close its window, then run setup again.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Repo 'server.js'))) {
        throw "Can't find the program next to setup.ps1 (in $Repo). Run the setup.ps1 that's in the deploy folder of a full copy of the repository."
    }
    Write-Host ''

    # ----- Questions (all asked before anything is changed) -----
    $install = Ask "Folder to install in (press Enter for $DefaultInstallFolder)" $DefaultInstallFolder
    if (-not ($install -match '^[A-Za-z]:\\')) { throw "Type the folder's full path, for example $DefaultInstallFolder" }
    $install = [System.IO.Path]::GetFullPath($install).TrimEnd('\')
    if ($install.Length -le 2) { throw "Choose a folder, not a whole drive (for example $DefaultInstallFolder)." }
    # Never install over anything: an existing Equipment Checkout (its records), or anything else.
    if (-not (Test-EmptyFolder $install)) {
        throw "$install already has files in it. Choose a new or empty folder. To update a location, see Updating a location in README.md."
    }

    $location = Ask 'Location name, shown at the top of the page (for example 46 Water Street)' ''
    Write-Host ''

    Write-Host "Equipment Checkout will be installed in $install"
    if (-not (Read-YesNo 'Go ahead?')) {
        Write-Host 'Stopped. Nothing was changed.'
        return
    }
    Write-Host ''

    # ----- Install -----
    New-Item -ItemType Directory -Path $install -Force | Out-Null
    foreach ($file in $ProgramFiles) {
        Copy-Item -LiteralPath (Join-Path $Repo $file) -Destination $install -Force
    }
    foreach ($folder in $ProgramFolders) {
        Copy-Folder (Join-Path $Repo $folder) (Join-Path $install $folder)
    }

    Write-TextFile (Join-Path $install 'config.json') ((([ordered]@{ location = $location }) | ConvertTo-Json) + "`r`n")
    Write-TextFile (Join-Path $install 'ticketList.json') "[]`r`n"

    # Which version this is, so you can always tell what a computer is running.
    $version = Invoke-Quietly 'git' @('-C', $Repo, 'describe', '--always', '--dirty')
    if (-not $version) { $version = 'unknown (not installed from a git copy of the repository)' }
    Write-TextFile (Join-Path $install 'VERSION.txt') "Version: $version`r`nInstalled: $(Get-Date -Format 'yyyy-MM-dd HH:mm') by $env:USERNAME`r`n"

    # npm ci: like npm install, but installs exactly the versions in package-lock.json, so every
    # computer runs the same tested modules.
    Write-Host 'Installing the program''s modules with npm...'
    Push-Location $install
    try {
        & npm.cmd ci --omit=dev --no-audit --no-fund | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "npm could not install the program's modules. Check the Global Connect connection, delete $install (nothing is kept in it yet), then run setup again."
        }
    } finally {
        Pop-Location
    }

    Write-Host ''
    Write-Host "Done! Equipment Checkout is installed in $install" -ForegroundColor Green
    Write-Host "To start it, double-click $install\start.cmd, then use http://localhost:$Port in the browser."
    Write-Host "Tickets: RSOs run $install\createTickets.ps1"
    Write-Host "If this location already has records in another folder or on another computer, copy them"
    Write-Host "into $install before starting the program (see Updating a location in README.md)."
    Write-Host ''
    if (Read-YesNo 'Start it now?') {
        Start-Process -FilePath (Join-Path $install 'start.cmd') -WorkingDirectory $install
    }
}

try {
    Main
} catch {
    Write-Host ''
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host 'Press Enter to close' | Out-Null
