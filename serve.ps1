<#
    serve.ps1 - startet RadNavi am PC.

    Aufruf:   powershell -ExecutionPolicy Bypass -File serve.ps1
    Dann im Browser:  http://localhost:8099

    Warum ueberhaupt ein Server? Browser verweigern bei Dateien, die
    direkt per Doppelklick geoeffnet werden (file://), sowohl die
    JavaScript-Module als auch den Standortzugriff. Ueber localhost
    gilt die Seite als sicher und alles funktioniert - auch die
    Offline-Faehigkeit.
#>

[CmdletBinding()]
param(
    [int]$Port = 8099,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.ico'  = 'image/x-icon'
    '.gpx'  = 'application/gpx+xml; charset=utf-8'
    '.brf'  = 'text/plain; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "Port $Port liess sich nicht oeffnen." -ForegroundColor Red
    Write-Host "Entweder laeuft dort schon etwas, dann einfach einen anderen Port nehmen:"
    Write-Host "    powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8100"
    Write-Host ""
    Write-Host ("Meldung: " + $_.Exception.Message)
    exit 1
}

Write-Host ""
Write-Host "  RadNavi laeuft." -ForegroundColor Green
Write-Host "  Im Browser oeffnen:  http://localhost:$Port"
Write-Host "  Ordner:              $root"
Write-Host ""
Write-Host "  Beenden mit Strg+C" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
    try { Start-Process "http://localhost:$Port" } catch { }
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        try {
            $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
            $rel = $rel -replace '/', '\'

            $path = Join-Path $root $rel
            $full = [System.IO.Path]::GetFullPath($path)

            # Nicht aus dem Ordner herausreichen lassen.
            $rootFull = [System.IO.Path]::GetFullPath($root)
            if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                $res.StatusCode = 403
                $res.Close()
                continue
            }

            if ((Test-Path -LiteralPath $full -PathType Container)) {
                $full = Join-Path $full 'index.html'
            }

            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                $res.StatusCode = 404
                $body = [System.Text.Encoding]::UTF8.GetBytes("404 - $rel nicht gefunden")
                $res.ContentType = 'text/plain; charset=utf-8'
                $res.ContentLength64 = $body.Length
                $res.OutputStream.Write($body, 0, $body.Length)
                $res.Close()
                Write-Host ("  404  " + $rel) -ForegroundColor DarkYellow
                continue
            }

            $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
            $type = $mime[$ext]
            if (-not $type) { $type = 'application/octet-stream' }

            $bytes = [System.IO.File]::ReadAllBytes($full)
            $res.ContentType = $type
            $res.ContentLength64 = $bytes.Length
            # Beim Entwickeln nicht zwischenspeichern, sonst sieht man
            # Aenderungen nicht. Der Service Worker haelt die App ohnehin.
            $res.Headers.Add('Cache-Control', 'no-cache, must-revalidate')
            $res.Headers.Add('Service-Worker-Allowed', '/')
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            $res.Close()
        } catch {
            try {
                $res.StatusCode = 500
                $res.Close()
            } catch { }
        }
    }
} finally {
    try { $listener.Stop(); $listener.Close() } catch { }
    Write-Host "RadNavi beendet." -ForegroundColor DarkGray
}
