# Draws every slide in web/plan.js to web/out/<day>-<n>.jpg with headless Chrome (the site's shot.ps1, sized for Instagram).
# render.ps1 [-Only d01]   Only ever stops the Chrome it started, by its own profile.
param([string]$Only = '')
$ErrorActionPreference = 'Stop'
$web = (Resolve-Path (Join-Path $PSScriptRoot '..\web')).Path
$out = Join-Path $web 'out'; New-Item -ItemType Directory -Force $out | Out-Null
# the slide list comes from plan.js itself, so the two never disagree
$list = node -e "global.window={};require(process.argv[1]);for(const d of window.PLAN)d.slides.forEach((s,i)=>console.log(d.id+' '+i+' '+(s.size?1920:1350)))" (Join-Path $web 'plan.js')
$prof = Join-Path ([IO.Path]::GetTempPath()) 'lgsocial'
if (Test-Path $prof) { Remove-Item -Recurse -Force $prof }
$chrome = if ($env:CHROME) { $env:CHROME } elseif ($IsMacOS) { '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } else { 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
$p = Start-Process $chrome -ArgumentList @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', "--user-data-dir=$prof", '--remote-debugging-port=9335', '--window-size=1080,1920', 'about:blank') -PassThru
try {
  $tgt = $null; for ($i = 0; $i -lt 50 -and -not $tgt; $i++) { Start-Sleep -Milliseconds 200; try { $tgt = (Invoke-RestMethod http://127.0.0.1:9335/json) | Where-Object { $_.type -eq 'page' } | Select-Object -First 1 } catch {} }
  $ws = New-Object System.Net.WebSockets.ClientWebSocket; $ws.Options.KeepAliveInterval = [TimeSpan]::Zero
  $ws.ConnectAsync([Uri]$tgt.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $script:id = 0
  function Send($method, $params) { $script:id++; $msg = @{id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress
    $b = [Text.Encoding]::UTF8.GetBytes($msg); $ws.SendAsync([ArraySegment[byte]]$b, 'Text', $true, [Threading.CancellationToken]::None).Wait()
    $want = $script:id; while ($true) { $ms = New-Object IO.MemoryStream; do { $buf = New-Object byte[] 1048576; $r = $ws.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result; $ms.Write($buf, 0, $r.Count) } while (-not $r.EndOfMessage)
      $o = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json; if ($o.id -eq $want) { return $o } } }
  $base = 'file:///' + (($web -replace '\\', '/').TrimStart('/')) + '/slide.html'
  foreach ($line in $list) { $d, $n, $h = $line.Split(' ')
    if ($Only -and $d -ne $Only) { continue }
    Send 'Emulation.setDeviceMetricsOverride' @{width = 1080; height = [int]$h; deviceScaleFactor = 1; mobile = $false } | Out-Null
    Send 'Page.navigate' @{url = "$base`?d=$d&s=$n" } | Out-Null
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 150; $t = Send 'Runtime.evaluate' @{expression = 'document.title' }; if ($t.result.result.value -eq 'ready') { break } }
    $s = Send 'Page.captureScreenshot' @{format = 'jpeg'; quality = 92 }
    $f = Join-Path $out ("$d-" + ([int]$n + 1) + '.jpg')
    [IO.File]::WriteAllBytes($f, [Convert]::FromBase64String($s.result.data)); "saved $f" }
} finally { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue }
# shrink for the phone and the push (mozjpeg, no visible change on Instagram)
node -e "const sharp=require(process.argv[1]);sharp.cache(false);const fs=require('fs'),p=require('path');(async()=>{for(const f of fs.readdirSync(process.argv[2]).filter(f=>f.endsWith('.jpg')&&f.startsWith(process.argv[3]||''))){const q=p.join(process.argv[2],f);fs.writeFileSync(q,await sharp(fs.readFileSync(q)).jpeg({quality:84,mozjpeg:true}).toBuffer())}})()" ([IO.Path]::Combine($PSScriptRoot, '..', '..', 'leon-gold-site', 'node_modules', 'sharp')) $out $Only
