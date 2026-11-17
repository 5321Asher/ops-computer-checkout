# Sets up Equipment Checkout for a location, on the computer that will run it.
#   1. Asks for the location's name (e.g. 46 Water Street), which names its folder (46-water-street).
#   2. Copies template\ on the share to that folder, or reuses the folder if the location already
#      exists (keeping its Excel file, ticket list and tickets.txt), and points the copy at it:
#      code\config.json for the program, and createTickets.ps1.
#   3. Copies the location's program (its code\ folder) to this computer, C:\equipment_checkout
#      unless you choose another folder, and installs its modules with npm. Records already
#      there (checkouts.db) are kept.
#
# Run it from the share: right-click setup.ps1, Run with PowerShell.
# Connect to Global Connect first: npm needs it to download the modules.
# Works with Windows PowerShell 5.1 and PowerShell 7. Keep this file plain ASCII.

$ErrorActionPreference = 'Stop'

# The share as a full \\server\share path (not Z:), so every computer can reach it.
$ShareRoot = '\\jus00adc1140\library\Scripts\equipment_checkout_v2'
$Template = Join-Path $ShareRoot 'template'
$DefaultInstallFolder = 'C:\equipment_checkout'
$MinNodeVersion = [version]'22.13.0'
$Port = 3000
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
# The records in the program's folder on this computer. Never replaced or deleted by setup.
$RecordFiles = @('checkouts.db', 'checkouts.db-journal', 'checkouts-*.db', 'pending-tickets*.json')

function Ask($question, $default) {
    $answer = (Read-Host $question).Trim()
    if (-not $answer) { return $default }
    return $answer
}

function Read-YesNo($question) {
    return (Read-Host "$question (y/n)").Trim().ToLower() -eq 'y'
}

# "46 Water Street" -> "46-water-street". Accents are dropped ("Montreal", not "montr-al").
function ConvertTo-FolderName([string]$name) {
    $decomposed = $name.Normalize([System.Text.NormalizationForm]::FormD)
    $plain = -join ($decomposed.ToCharArray() | Where-Object {
        [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [System.Globalization.UnicodeCategory]::NonSpacingMark
    })
    return ($plain.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
}

# Copies a folder with robocopy, which is much faster than Copy-Item for thousands of small files.
function Copy-Folder($from, $to, [string[]]$options) {
    # /E: subfolders too. /R:2 /W:2: don't retry a locked file for ages. /MT:16: many files at once.
    # /NFL /NDL /NJH /NJS /NP: only print problems.
    & robocopy $from $to /E /R:2 /W:2 /MT:16 /NFL /NDL /NJH /NJS /NP @options | Out-Host
    # robocopy exit codes 0 to 7 mean success; 8 or more mean some files couldn't be copied.
    if ($LASTEXITCODE -ge 8) { throw "Copying $from to $to failed (robocopy exit code $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

# Whether npm can reach the npm registry (it needs Global Connect). npm.cmd rather than npm, so
# PowerShell's script execution policy can't block npm's own .ps1 launcher.
function Test-NpmRegistry {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue' # npm prints notices on stderr; they aren't failures
    try {
        & npm.cmd ping 2>&1 | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
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

# Whether a folder is empty, or holds Equipment Checkout (this version or the first one), so
# replacing its program files can't delete anything else.
function Test-SafeInstallFolder($folder) {
    if (-not (Test-Path -LiteralPath $folder)) { return $true }
    if (-not (Get-ChildItem -LiteralPath $folder -Force | Select-Object -First 1)) { return $true }
    foreach ($marker in @('server.js', 'index.js', 'checkouts.db')) {
        if (Test-Path -LiteralPath (Join-Path $folder $marker)) { return $true }
    }
    return $false
}

function Main {
    Write-Host 'Equipment Checkout setup' -ForegroundColor Cyan
    Write-Host ''

    # ----- Node.js -----
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
    if (-not (Test-NpmRegistry)) {
        throw "npm can't reach the npm registry to download the program's modules. Connect to Global Connect, then run setup again. Nothing was changed."
    }
    Write-Host 'npm can reach the npm registry.'

    if (Test-ProgramRunning) {
        throw 'Equipment Checkout is running on this computer. Close its window, then run setup again.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Template 'code\server.js'))) {
        throw "Can't find the program in $Template\code. Check the network connection. If it has never been published, publish it with deploy\publish-template.ps1 from the repository."
    }

    # ----- The location's folder on the share -----
    $name = Ask 'Location name (for example 46 Water Street)' ''
    $folderName = ConvertTo-FolderName $name
    if (-not $folderName) { throw 'The location name needs at least one letter or number.' }
    $LocationFolder = Join-Path $ShareRoot $folderName
    $LocationCode = Join-Path $LocationFolder 'code'
    Write-Host ''

    $reuse = Test-Path -LiteralPath $LocationFolder
    if ($reuse) {
        Write-Host "$LocationFolder already exists."
        Write-Host 'Reusing it updates its program and createTickets.ps1 from the template.'
        Write-Host 'Its Excel file, ticket list and tickets.txt are not touched.'
        $go = Read-YesNo 'Reuse it?'
    } else {
        Write-Host "A new folder will be made for this location: $LocationFolder"
        $go = Read-YesNo 'Is that right?'
    }
    if (-not $go) {
        Write-Host 'Stopped. Nothing was changed.'
        return
    }

    # All questions are asked before anything is changed.
    $install = Ask "Folder for the program on this computer (press Enter for $DefaultInstallFolder)" $DefaultInstallFolder
    if (-not ($install -match '^[A-Za-z]:\\')) { throw "Type the folder's full path, for example $DefaultInstallFolder" }
    $install = [System.IO.Path]::GetFullPath($install).TrimEnd('\')
    if ($install.Length -le 2) { throw "Choose a folder, not a whole drive (for example $DefaultInstallFolder)." }
    if (-not (Test-SafeInstallFolder $install)) {
        throw "$install has other files in it. Choose an empty folder, or the folder Equipment Checkout is already in."
    }
    Write-Host ''

    if ($reuse) {
        # /MIR: code\ ends up exactly like the template's (removing the old version's files).
        Copy-Folder (Join-Path $Template 'code') $LocationCode @('/MIR')
        Copy-Item -LiteralPath (Join-Path $Template 'createTickets.ps1') -Destination $LocationFolder -Force
        $ticketList = Join-Path $LocationFolder 'ticketList.json'
        if (-not (Test-Path -LiteralPath $ticketList)) { Write-TextFile $ticketList "[]`r`n" }
    } else {
        Copy-Folder $Template $LocationFolder @()
    }

    # Point the location's copy at its own folder.
    $config = [ordered]@{ location = $name; locationFolder = $LocationFolder }
    Write-TextFile (Join-Path $LocationCode 'config.json') (($config | ConvertTo-Json) + "`r`n")
    $ticketScript = Join-Path $LocationFolder 'createTickets.ps1'
    $ticketScriptText = [System.IO.File]::ReadAllText($ticketScript)
    Write-TextFile $ticketScript $ticketScriptText.Replace('__LOCATION_FOLDER__', $LocationFolder.Replace("'", "''"))
    Write-Host "The location's folder is ready: $LocationFolder" -ForegroundColor Green
    Write-Host ''

    # ----- The program on this computer -----
    if (Get-ChildItem -LiteralPath $install -Force -ErrorAction SilentlyContinue | Select-Object -First 1) {
        Write-Host "The program files in $install will be replaced with this version."
    }

    $database = Join-Path $install 'checkouts.db'
    if (Test-Path -LiteralPath $database) {
        $backup = Join-Path $install "checkouts-before-setup-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').db"
        Copy-Item -LiteralPath $database -Destination $backup
        Write-Host "The records already in $install are kept. A copy was saved as $backup"
    }
    # /MIR replaces the program files; /XF leaves the records alone (they are neither copied nor
    # deleted). /XD node_modules: npm replaces that folder next.
    Copy-Folder $LocationCode $install (@('/MIR', '/XD', 'node_modules', '/XF') + $RecordFiles)

    # npm ci: like npm install, but installs exactly the versions in package-lock.json, so every
    # location runs the same tested modules.
    Write-Host 'Installing the program''s modules with npm...'
    Push-Location $install
    try {
        & npm.cmd ci --omit=dev --no-audit --no-fund | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw 'npm could not install the program''s modules. Check the Global Connect connection, then run setup again (choose to reuse the location).'
        }
    } finally {
        Pop-Location
    }

    Write-Host ''
    Write-Host "Done! Equipment Checkout for $name is installed in $install" -ForegroundColor Green
    Write-Host "To start it, double-click $install\start.cmd, then use http://localhost:$Port in the browser."
    Write-Host "If this location used the old version in another folder or on another computer, copy its"
    Write-Host "checkouts.db into $install before starting the program."
    Write-Host "Tickets: RSOs run $ticketScript"
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
