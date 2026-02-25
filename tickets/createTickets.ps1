#!/usr/bin/env pwsh

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$inputFile = Join-Path $scriptDir "ticketList.json"
$outputFile = Join-Path $scriptDir "tickets.txt"

# --- Step 1: Warn about overwrite ---
$overwrite = Read-Host "This will overwrite the current tickets.txt. Continue? (y/n)"
if ($overwrite.Trim().ToLower() -ne "y") {
    Write-Host "Aborted."
    exit
}

# --- Step 2: Ask for RSO name ---
$rsoName = Read-Host "What is your name?"
if (-not $rsoName.Trim()) {
    Write-Host "No name entered. Aborted."
    exit
}

# --- Step 3: Read ticketList.json ---
if (-not (Test-Path $inputFile)) {
    Write-Error "Error: Could not find $inputFile"
    exit
}

try {
    $raw = Get-Content $inputFile -Raw -Encoding UTF8
    $tickets = $raw | ConvertFrom-Json
} catch {
    Write-Error "Error reading or parsing ticketList.json: $_"
    exit
}

if (-not $tickets -or $tickets.Count -eq 0) {
    Write-Host "No tickets found in ticketList.json."
    exit
}

# --- Step 4: Build output ---
$lines = foreach ($ticket in $tickets) {
    @"
Please assign ticket to JC -> MAG DISTRIBUTED SUPPORT -> JUS MAG CS RSO TORONTO -> $($rsoName.Trim()).
Machine Name: $($ticket.asset)
Courtroom: $($ticket.location)
DESCRIPTION: Client $($ticket.user) requested equipment at $($ticket.checkout)
Resolution: Equipment returned at $($ticket.return)
"@
}

$output = $lines -join "`n`n"

# --- Step 5: Write to tickets.txt ---
try {
    $output | Set-Content $outputFile -Encoding UTF8
    Write-Host "`nDone! $($tickets.Count) ticket(s) written to tickets.txt using RSO name: `"$($rsoName.Trim())`""

    # --- Step 6: Clear ticketList.json after export ---
    "[]" | Set-Content $inputFile -Encoding UTF8
    Write-Host "ticketList.json has been cleared."
} catch {
    Write-Error "Error writing tickets.txt: $_"
}
