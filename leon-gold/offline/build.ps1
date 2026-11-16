# Builds offline\leon-gold-offline.html from index.html: one self-contained file that runs without
# internet or the artifact. Libraries and fonts come from offline\vendor; data stays in the browser.
# Run:  powershell -ExecutionPolicy Bypass -File offline\build.ps1
# With -Site <folder>, also writes the installable phone copy (index.html, sw.js, manifest, icons) there.
# With -SyncUrl <https address>, the sync panel starts with that server address filled in.
param([string]$Site, [string]$SyncUrl = "")
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Text($p) { [System.IO.File]::ReadAllText($p, $utf8) }

$html = Read-Text (Join-Path $root 'index.html')

function Swap([string]$find, [string]$with) {
  if (-not $script:html.Contains($find)) { throw "build.ps1: not found in index.html: $find" }
  $script:html = $script:html.Replace($find, $with)
}

# fonts: inline every woff2 as a data URL
$css = Read-Text (Join-Path $here 'vendor\fonts\fonts.css')
Get-ChildItem (Join-Path $here 'vendor\fonts') -Filter *.woff2 | ForEach-Object {
  $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($_.FullName))
  $css = $css.Replace("url($($_.Name))", "url(data:font/woff2;base64,$b64)")
}
Swap '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700;800&family=Cinzel:wght@500;700&display=swap">' "<style>`n$css</style>"

# the display face (Amiri Bold, Arabic letters only) is declared in index.html itself
$amiri = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $here 'vendor\fonts\amiri-700-arabic.woff2')))
Swap 'url(https://fonts.gstatic.com/s/amiri/v30/J7acnpd8CGxBHp2VkaY6zp5yGw.woff2)' "url(data:font/woff2;base64,$amiri)"

# libraries (PDF and Excel): the offline file inlines them up front, so loadLib() finds them loaded; the phone site
# fetches them from lib/ only when a PDF or Excel is made (sw.js caches them), so its first paint stays quick
$LIBS = [ordered]@{
  'html2canvas.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
  'jspdf.umd.min.js'   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  'xlsx.full.min.js'   = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
}
$lib = { param($f) "<script>`n" + (Read-Text (Join-Path $here "vendor\$f")) + "`n</script>" }
# home-screen tags must sit inside <head>: Safari ignores icon links in <body>, and index.html's first line already closes <head>
$head = '<link rel="manifest" href="manifest.webmanifest?v=2"><link rel="apple-touch-icon" sizes="180x180" href="icon-180.png?v=2">' +
  '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">' +
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="theme-color" content="#06140e"><link rel="icon" href="icon-180.png?v=2"></head>'
$i = $html.IndexOf('</head>'); if ($i -lt 0) { throw 'build.ps1: no </head> in index.html' }
$html = $html.Substring(0, $i) + $head + $html.Substring($i + 7)
$build = Get-Date -Format 'yyyy-MM-dd HH:mm'
$run = "<script>`n" + (Read-Text (Join-Path $here 'runtime.js')).Replace('__BUILD__', $build).Replace('__SYNC_URL__', $SyncUrl) + "`n</script>"
Swap '<meta name="claude:viewport-fit-sides" content="cover">' '<!--RUNTIME-->'

# product photos: served from IndexedDB instead of the artifact's /_blob/ path
Swap "function photoURL(id){return id?'/_blob/'+id:''}" "function photoURL(id){return id?(window.__leonBlobURL?window.__leonBlobURL(id):'/_blob/'+id):''}"

$siteHtml = $html.Replace('<!--RUNTIME-->', $run)
foreach ($k in $LIBS.Keys) {
  if (-not $siteHtml.Contains($LIBS[$k])) { throw "build.ps1: no loadLib for $k in index.html" }
  $siteHtml = $siteHtml.Replace($LIBS[$k], 'lib/' + $k)
}
$html = $html.Replace('<!--RUNTIME-->', (($LIBS.Keys | ForEach-Object { & $lib $_ }) -join '') + $run)

if ($html -match '<(link|script)[^>]+(href|src)="https?://') { Write-Warning 'an external <link> or <script src> is still in the offline file' }
$out = Join-Path $here 'leon-gold-offline.html'
[System.IO.File]::WriteAllText($out, $html, $utf8)
'{0}  ({1:N0} KB)' -f $out, ((Get-Item $out).Length / 1KB)

if ($Site) {
  if (-not (Test-Path $Site)) { New-Item -ItemType Directory $Site | Out-Null }
  $pwa = Join-Path $here 'pwa'
  [System.IO.File]::WriteAllText((Join-Path $Site 'index.html'), $siteHtml, $utf8)
  Copy-Item (Join-Path $pwa 'manifest.webmanifest'), (Join-Path $pwa 'icon-180.png'), (Join-Path $pwa 'icon-512.png') $Site -Force
  Copy-Item (Join-Path $pwa 'price-list.pdf') $Site -Force   # «لیست قیمت» in the menu
  $libDir = Join-Path $Site 'lib'; if (-not (Test-Path $libDir)) { New-Item -ItemType Directory $libDir | Out-Null }
  foreach ($k in $LIBS.Keys) { Copy-Item (Join-Path $here "vendor\$k") $libDir -Force }
  $ver = (Get-FileHash (Join-Path $Site 'index.html') -Algorithm SHA256).Hash.Substring(0, 12)
  [System.IO.File]::WriteAllText((Join-Path $Site 'sw.js'), (Read-Text (Join-Path $pwa 'sw.js')).Replace('__VERSION__', $ver), $utf8)
  "site: $Site  (version $ver, build $build)"
}
