# Sets up Equipment Checkout in this copy of the repository:
#   1. Asks for the location's name (e.g. 46 Water Street), shown at the top of the pages.
#   2. Asks for the location's folder on the server, where the program keeps the three files RSOs
#      need: the Excel copy, the ticket list and createTickets.ps1. Everything else stays here.
#   3. Saves both in config.json, and installs the program's modules with npm.
#
# Right-click setup.ps1, Run with PowerShell. Connect to Global Connect first: npm needs it to
# download the modules. Run it again to change the answers, or after a git pull to update the
# modules. It never touches the records (checkouts.db).
# Works with Windows PowerShell 5.1 and PowerShell 7. Keep this file plain ASCII.

$ErrorActionPreference = 'Stop'

$MinNodeVersion = [version]'22.13.0'
$ConfigFile = Join-Path $PSScriptRoot 'config.json'
$ExampleFolder = '\\jus00adc1140\library\Scripts\equipment_checkout_v2\46-water-street'

function Ask($question, $default) {
    if ($default) { $question = "$question`n(press Enter to keep $default)" }
    $answer = (Read-Host $question).Trim()
    if (-not $answer) { return $default }
    return $answer
}

function Main {
    Write-Host 'Equipment Checkout setup' -ForegroundColor Cyan
    Write-Host ''

    $nodeVersion = $null
    try { $nodeVersion = [version]((& node --version) -replace '^v', '') } catch { }
    if (-not $nodeVersion -or $nodeVersion -lt $MinNodeVersion) {
        throw "Equipment Checkout needs Node.js $MinNodeVersion or newer. Install the LTS version from https://nodejs.org, then run setup again."
    }

    # Running setup again: the answers from last time are the defaults.
    $current = $null
    if (Test-Path -LiteralPath $ConfigFile) {
        $current = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
    }

    $location = Ask 'Location name, shown at the top of the pages (for example 46 Water Street)' $current.location
    $serverFolder = Ask "Location's folder on the server (for example $ExampleFolder)" $current.serverFolder
    # The full \\server\share path works even where the share isn't mapped to a drive letter.
    if ($serverFolder -notmatch '^(\\\\[^\\]+\\[^\\]+|[A-Za-z]:\\)') {
        throw "Type the folder's full path, for example $ExampleFolder"
    }
    $serverFolder = $serverFolder.TrimEnd('\')
    if (-not (Test-Path -LiteralPath $serverFolder -PathType Container)) {
        $answer = Read-Host "$serverFolder doesn't exist, or the server can't be reached. Create it? (y/n)"
        if ($answer.Trim().ToLower() -ne 'y') { throw 'Stopped. Nothing was changed.' }
        [System.IO.Directory]::CreateDirectory($serverFolder) | Out-Null
    }

    $json = [ordered]@{ location = "$location"; serverFolder = $serverFolder } | ConvertTo-Json
    [System.IO.File]::WriteAllText($ConfigFile, "$json`r`n", (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Saved $ConfigFile"
    Write-Host ''

    Write-Host 'Installing the program''s modules with npm...'
    Push-Location $PSScriptRoot
    try {
        # npm ci: exactly the versions in package-lock.json, so every location runs the same modules.
        # npm.cmd rather than npm, so PowerShell's execution policy can't block it.
        & npm.cmd ci --omit=dev --no-audit --no-fund | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "npm couldn't install the program's modules. Check the Global Connect connection, then run setup again."
        }
    } finally {
        Pop-Location
    }

    Write-Host ''
    Write-Host 'Done!' -ForegroundColor Green
    Write-Host "To start it, double-click start.cmd (or run npm start in $PSScriptRoot)."
    Write-Host "When it starts, it puts createTickets.ps1 in $serverFolder for the RSOs."
}

try {
    Main
} catch {
    Write-Host ''
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host 'Press Enter to close' | Out-Null
