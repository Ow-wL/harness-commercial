param([string]$Pptx, [string]$OutDir)
$ErrorActionPreference = "Stop"
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Open($Pptx, $true, $false, $false)
  $n = $pres.Slides.Count
  for ($i = 1; $i -le $n; $i++) {
    $p = Join-Path $OutDir ("slide-{0:D2}.png" -f $i)
    $pres.Slides.Item($i).Export($p, "PNG", 1600, 900)
  }
  $pres.Close()
  "exported $n slides to $OutDir"
} finally {
  $app.Quit()
}
