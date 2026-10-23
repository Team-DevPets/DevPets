# Claude 데스크톱 앱 감지 가능 여부를 알아보는 측정 스크립트 (읽기만 함, 아무것도 바꾸지 않음)
$ErrorActionPreference = 'SilentlyContinue'
$out = Join-Path $PSScriptRoot 'probe-result.txt'
function W($s) { $s | Out-File $out -Append -Encoding utf8 }
"start $(Get-Date -Format o) ps=$($PSVersionTable.PSVersion) cores=$([Environment]::ProcessorCount)" | Out-File $out -Encoding utf8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$pattern = 'stop|중지|정지|멈추|cancel|취소|send|보내|전송|interrupt'
function ClaudeProcs { Get-Process | Where-Object { $_.ProcessName -match '^claude$' } }
W 'processes:'
ClaudeProcs | ForEach-Object { W "  pid=$($_.Id) hwnd=$($_.MainWindowHandle) title=[$($_.MainWindowTitle)] path=$($_.Path)" }
W 'logs:'
Get-ChildItem (Join-Path $env:APPDATA 'Claude\logs') | ForEach-Object { W "  $($_.Name) $($_.Length) $($_.LastWriteTime.ToString('HH:mm:ss'))" }
function CpuMs { $t = 0; ClaudeProcs | ForEach-Object { $t += $_.TotalProcessorTime.TotalMilliseconds }; $t }
$btn = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
function Buttons {
  $count = 0; $hits = @(); $ms = 0
  foreach ($p in ClaudeProcs) {
    if ($p.MainWindowHandle -eq 0) { continue }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btn)
    $ms += $sw.ElapsedMilliseconds
    $count += $all.Count
    foreach ($e in $all) { $n = $e.Current.Name; if ($n -match $pattern) { $hits += "$n|$($e.Current.AutomationId)|off=$($e.Current.IsOffscreen)" } }
  }
  "buttons=$count uiaMs=$ms hits=[$($hits -join '; ')]"
}
Write-Host '측정 중이에요. 약 2분 뒤 이 창이 저절로 닫혀요. 그동안 Claude 앱은 평소처럼 두세요.'
$prevCpu = CpuMs; $prevT = Get-Date
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 3
  $nowCpu = CpuMs; $nowT = Get-Date
  $pct = [math]::Round(($nowCpu - $prevCpu) / (($nowT - $prevT).TotalMilliseconds) * 100, 1)
  $prevCpu = $nowCpu; $prevT = $nowT
  W "t=$($nowT.ToString('HH:mm:ss')) cpuCore%=$pct $(Buttons)"
}
W "end $(Get-Date -Format o)"
