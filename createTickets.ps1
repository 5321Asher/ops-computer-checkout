# Turns the ticket list (ticketList.json) into tickets.txt, ready to file, then empties the list.
# The checkout program keeps a copy in the location's server folder, next to the list: RSOs
# right-click that copy, Run with PowerShell. Change this one, in the repository: the program
# replaces the server's copy with it when it starts.
#
# The checkout program adds tickets to ticketList.json while this runs, so both take turns using
# ticketList.json.lock: whoever creates the lock file may change the list, then deletes it.
# Works with Windows PowerShell 5.1 and PowerShell 7. Keep this file plain ASCII.

$ErrorActionPreference = 'Stop'

# The location's server folder: the one this script is in.
$TicketList = Join-Path $PSScriptRoot 'ticketList.json'
$TicketsTxt = Join-Path $PSScriptRoot 'tickets.txt'
$LockFile = "$TicketList.lock"
$StaleLockMinutes = 2
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Takes the lock, waiting up to 15 seconds for the checkout program to finish with the list.
function Lock-TicketList {
    $deadline = (Get-Date).AddSeconds(15)
    while ($true) {
        try {
            $stream = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            try {
                $info = [System.Text.Encoding]::ASCII.GetBytes("createTickets.ps1 on $env:COMPUTERNAME, $(Get-Date -Format o)`r`n")
                $stream.Write($info, 0, $info.Length)
            } finally {
                $stream.Dispose()
            }
            return
        } catch {
            # Failed for a reason other than someone else holding the lock: report it.
            if (-not (Test-Path -LiteralPath $LockFile)) { throw }
            # A lock this old was left behind by a program that stopped halfway.
            $lock = Get-Item -LiteralPath $LockFile -ErrorAction SilentlyContinue
            if ($lock -and ((Get-Date) - $lock.LastWriteTime).TotalMinutes -gt $StaleLockMinutes) {
                Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
                continue
            }
            if ((Get-Date) -gt $deadline) {
                throw "The ticket list is busy (the checkout program is using it, or $LockFile was left behind). Try again in a couple of minutes."
            }
            Start-Sleep -Milliseconds 200
        }
    }
}

# The tickets in ticketList.json, one per line of output.
function Read-TicketList {
    if (-not (Test-Path -LiteralPath $TicketList)) { return }
    $raw = [System.IO.File]::ReadAllText($TicketList)
    if (-not $raw.Trim()) { return }
    try {
        $parsed = ConvertFrom-Json -InputObject $raw
    } catch {
        throw "ticketList.json is not valid JSON, so nothing was changed. Fix it, or ask IT. ($($_.Exception.Message))"
    }
    # PowerShell 7 turns an empty list into $null.
    $parsed | Where-Object { $null -ne $_ }
}

# A stored time (UTC, like 2026-11-17T19:05:00.000Z) as local time, like 2026-11-17 2:05 PM.
# PowerShell 7 reads those times as dates by itself; 5.1 reads them as text.
function Format-TicketTime($value) {
    if ($null -eq $value -or "$value" -eq '') { return '' }
    if ($value -is [datetime]) {
        $time = $value
    } else {
        $time = [datetime]::MinValue
        $styles = [System.Globalization.DateTimeStyles]::RoundtripKind
        if (-not [datetime]::TryParse([string]$value, [System.Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$time)) {
            return [string]$value
        }
    }
    if ($time.Kind -eq [System.DateTimeKind]::Unspecified) {
        $time = [datetime]::SpecifyKind($time, [System.DateTimeKind]::Utc)
    }
    return $time.ToLocalTime().ToString('yyyy-MM-dd h:mm tt', [System.Globalization.CultureInfo]::InvariantCulture)
}

function Format-Ticket($ticket, $rsoName) {
    return @(
        "Please assign ticket to JC -> MAG DISTRIBUTED SUPPORT -> JUS MAG CS RSO TORONTO -> $rsoName."
        "Machine Name: $($ticket.asset)"
        "Courtroom: $($ticket.location)"
        "DESCRIPTION: Client $($ticket.user) requested equipment at $(Format-TicketTime $ticket.checkout)"
        "Resolution: Equipment returned at $(Format-TicketTime $ticket.return)"
    ) -join "`r`n"
}

function Main {
    $answer = Read-Host 'This will overwrite the current tickets.txt. Continue? (y/n)'
    if ($answer.Trim().ToLower() -ne 'y') {
        Write-Host 'Stopped. Nothing was changed.'
        return
    }
    $rsoName = (Read-Host 'What is your name?').Trim()
    if (-not $rsoName) {
        Write-Host 'No name entered. Stopped. Nothing was changed.'
        return
    }

    # Only hold the lock for the moment it takes to read and empty the list.
    Lock-TicketList
    try {
        $tickets = @(Read-TicketList)
        if ($tickets.Count -eq 0) {
            Write-Host 'No tickets found in ticketList.json.'
            return
        }
        $text = ($tickets | ForEach-Object { Format-Ticket $_ $rsoName }) -join "`r`n`r`n"
        [System.IO.File]::WriteAllText($TicketsTxt, "$text`r`n", $Utf8NoBom)
        # Only once tickets.txt is saved: empty the list.
        [System.IO.File]::WriteAllText($TicketList, "[]`r`n", $Utf8NoBom)
    } finally {
        Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    }

    Write-Host ''
    Write-Host "Done! $($tickets.Count) ticket(s) written to $TicketsTxt using RSO name: `"$rsoName`"" -ForegroundColor Green
    Write-Host 'ticketList.json has been cleared.'
}

try {
    Main
} catch {
    Write-Host ''
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host 'Press Enter to close' | Out-Null
