# Publishes this repository to the share as the template that setup.ps1 copies for each location.
# Run it on your own computer, from a copy of the repository, after changing the program:
#     .\deploy\publish-template.ps1
# It needs write access to the share, nothing else. Only the program's own files are published (a
# few dozen); setup.ps1 installs the modules on each computer with npm.
#
# Locations keep the program they have until setup.ps1 is run for them again (choosing "reuse").
# Works with Windows PowerShell 5.1 and PowerShell 7. Keep this file plain ASCII.

param(
    [string]$ShareRoot = '\\jus00adc1140\library\Scripts\equipment_checkout_v2'
)

$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$Template = Join-Path $ShareRoot 'template'
$Code = Join-Path $Template 'code'
# Only what a location needs to run the program: no tests, records or settings.
# package-lock.json is how setup.ps1 installs exactly the tested module versions.
$ProgramFiles = @('server.js', 'package.json', 'package-lock.json', 'start.cmd', 'README.md', 'config.example.json')
$ProgramFolders = @('lib', 'public', 'scripts')

function Copy-Folder($from, $to) {
    # /E: subfolders too. /R:2 /W:2: don't retry a locked file for ages.
    & robocopy $from $to /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Host
    # robocopy exit codes 0 to 7 mean success; 8 or more mean some files couldn't be copied.
    if ($LASTEXITCODE -ge 8) { throw "Copying $from to $to failed (robocopy exit code $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

function Remove-Folder($path) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

function Main {
    # The share must be reachable; equipment_checkout_v2 itself is made if it isn't there yet.
    $shareParent = Split-Path -Parent $ShareRoot
    if (-not (Test-Path -LiteralPath $shareParent)) {
        throw "Can't reach $shareParent. Check the network connection."
    }
    New-Item -ItemType Directory -Path $ShareRoot -Force | Out-Null

    # Which version this is, so you can tell what a location is running (code\VERSION.txt).
    $version = 'unknown (git not found)'
    $described = $null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        try { $described = & git -C $Repo describe --always --dirty } catch { }
    }
    if ($described) {
        $version = "$described".Trim()
        if ($version.EndsWith('-dirty')) {
            Write-Host 'This copy of the repository has changes that are not committed.' -ForegroundColor Yellow
            if ((Read-Host 'Publish it anyway? (y/n)').Trim().ToLower() -ne 'y') {
                Write-Host 'Stopped. Nothing was changed.'
                return
            }
        }
    }

    # ----- Build a clean copy on this computer -----
    $stage = Join-Path ([System.IO.Path]::GetTempPath()) "equipment-checkout-publish-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        foreach ($file in $ProgramFiles) { Copy-Item -LiteralPath (Join-Path $Repo $file) -Destination $stage }
        foreach ($folder in $ProgramFolders) { Copy-Item -LiteralPath (Join-Path $Repo $folder) -Destination $stage -Recurse }
        $published = "Version: $version`r`nPublished: $(Get-Date -Format 'yyyy-MM-dd HH:mm') by $env:USERNAME on $env:COMPUTERNAME`r`n"
        [System.IO.File]::WriteAllText((Join-Path $stage 'VERSION.txt'), $published)

        # ----- Swap it into the template -----
        # Copied next to the old one first and then renamed into place, so a failure partway
        # (network drop) never leaves the template half-written.
        Write-Host "Copying to $Template ..."
        New-Item -ItemType Directory -Path $Template -Force | Out-Null
        Remove-Folder "$Code.new"
        Remove-Folder "$Code.old"
        Copy-Folder $stage "$Code.new"
        if (Test-Path -LiteralPath $Code) { Rename-Item -LiteralPath $Code -NewName 'code.old' }
        Rename-Item -LiteralPath "$Code.new" -NewName 'code'
        Remove-Folder "$Code.old"
    } finally {
        Remove-Folder $stage
    }

    # The ticket script keeps its placeholder; setup.ps1 fills it in for each location.
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'createTickets.ps1') -Destination $Template -Force
    $ticketList = Join-Path $Template 'ticketList.json'
    if (-not (Test-Path -LiteralPath $ticketList)) { [System.IO.File]::WriteAllText($ticketList, "[]`r`n") }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup.ps1') -Destination $ShareRoot -Force

    Write-Host ''
    Write-Host "Published version $version to $Template" -ForegroundColor Green
    Write-Host "Set up or update a location by running $ShareRoot\setup.ps1 on its computer."
}

try {
    Main
} catch {
    Write-Host ''
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
