# 데스크톱 채팅 앱(Claude 앱 · ChatGPT 앱) 응답 감지 — 펫(main.js)이 띄우는 감시 프로세스
#
# 두 앱에는 외부 연결(hooks) 기능이 없어서 Windows 접근성(UI Automation)으로 앱 창의 버튼을 읽는다.
#   - 응답 중에만 보이는 "중지" 버튼   → busy
#   - 권한을 묻는 "허용"·"승인" 버튼     → approve (펫이 '확인 대기'로 표시)
# 1초마다 앱별 결과를 JSON 한 줄로 stdout에 쓴다. 입력: 환경 변수 PET_APPS (앱 목록 JSON)
#
# 부담 줄이기: 화면 전체 확인(FindAll)은 앱이 움직일 때(CPU 사용, 1.5초에 한 번까지), 쉬는 중엔 10초마다, 응답 중엔 3초마다만 한다.
# 그 사이에는 찾아 둔 중지 버튼이 아직 있는지만 본다.
# PowerShell 변수 이름은 대소문자를 구분하지 않는다 ($A 와 $a 는 같은 변수). 이름이 겹치지 않게 주의.

$ErrorActionPreference = 'SilentlyContinue'
# 한글 버튼 이름이 깨지지 않도록 출력은 UTF-8로 (기본은 콘솔 코드페이지 CP949)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
# C# 안에는 한글을 쓰지 않는다 (컴파일러가 읽는 인코딩이 다를 수 있음). HashSet 대신 Dictionary: HashSet은 System.Core라 5.1 기본 참조에 없을 수 있다.
try {
Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class PetWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);

  public static uint ForegroundPid() {
    uint processId;
    GetWindowThreadProcessId(GetForegroundWindow(), out processId);
    return processId;
  }

  public static bool Visible(IntPtr hWnd) { return IsWindowVisible(hWnd); }

  // Titled top-level window of the app: visible Electron window > other visible window > hidden (closed to tray) Electron window.
  public static IntPtr FindAppWindow(int[] processIds) {
    var ids = new Dictionary<uint, bool>();
    foreach (var id in processIds) ids[(uint)id] = true;
    IntPtr visibleChrome = IntPtr.Zero, visibleOther = IntPtr.Zero, hiddenChrome = IntPtr.Zero;
    var className = new StringBuilder(256);
    EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (!ids.ContainsKey(processId) || GetWindowTextLength(hWnd) == 0) return true;
      className.Length = 0;
      GetClassName(hWnd, className, 256);
      bool chrome = className.ToString() == "Chrome_WidgetWin_1";
      if (IsWindowVisible(hWnd)) {
        if (chrome && visibleChrome == IntPtr.Zero) visibleChrome = hWnd;
        else if (!chrome && visibleOther == IntPtr.Zero) visibleOther = hWnd;
      } else if (chrome && hiddenChrome == IntPtr.Zero) {
        hiddenChrome = hWnd;
      }
      return true;
    }, IntPtr.Zero);
    if (visibleChrome != IntPtr.Zero) return visibleChrome;
    if (visibleOther != IntPtr.Zero) return visibleOther;
    return hiddenChrome;
  }
}
'@
} catch { [Console]::Error.WriteLine("PetWin 컴파일 실패, 기본 방식으로 감지: $($_.Exception.Message)") }
# 컴파일에 실패하면 숨긴 창·앞에 있는 창 확인 없이 메인 창만으로 감지한다.
$native = [bool]('PetWin' -as [type])

$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$btnCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
# 버튼 이름을 FindAll 한 번에 함께 받아 온다. 버튼마다 앱에 따로 물어보는 것보다 훨씬 빠르다.
$nameCache = New-Object System.Windows.Automation.CacheRequest
$nameCache.Add($AE::NameProperty)
$apps = $env:PET_APPS | ConvertFrom-Json
# 진단: 이런 이름의 버튼을 처음 보면 한 번씩 알려준다 (감지할 버튼 이름을 맞추는 데 쓴다).
$diagRe = 'stop|중지|정지|멈추|중단|cancel|취소|interrupt|streaming|스트리밍|허용|승인|거부|allow|approve|deny|복사|copy|좋은|나쁜|좋아요|싫어요|good|bad|다시|재시도|재생성|retry|regenerate|읽기|read aloud'
$st = @{}
foreach ($app in $apps) {
  $st[$app.key] = @{ cached = $null; prevCpu = 0; prevT = [DateTime]::UtcNow; lastFull = [DateTime]::MinValue; seen = @{}; exe = ''; approve = ''; doneCount = -1 }
}
function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

while ($true) {
  $fgPid = -1; if ($native) { $fgPid = [int][PetWin]::ForegroundPid() }
  foreach ($app in $apps) {
    $s = $st[$app.key]
    $procs = @(Get-Process -Name $app.procs | Where-Object { -not $app.exclude -or $_.Path -notmatch $app.exclude })
    $ids = @($procs | ForEach-Object { $_.Id })
    $cpu = 0; foreach ($p in $procs) { $cpu += $p.TotalProcessorTime.TotalMilliseconds }
    $now = [DateTime]::UtcNow
    $pct = 0; if ($s.prevCpu -gt 0) { $pct = ($cpu - $s.prevCpu) / [Math]::Max(1, ($now - $s.prevT).TotalMilliseconds) * 100 }
    $s.prevCpu = $cpu; $s.prevT = $now

    # 실행 파일 경로는 바뀔 때만 알려준다 (펫이 앱 아이콘을 가져오고 창을 여는 데 쓴다).
    $exe = ''; if ($procs.Count -gt 0) { $exePath = $procs[0].Path; if ($exePath -and $exePath -ne $s.exe) { $s.exe = $exePath; $exe = $exePath } }

    $hwnd = [IntPtr]::Zero
    if ($ids.Count -gt 0) {
      if ($native) { $hwnd = [PetWin]::FindAppWindow([int[]]$ids) }
      else { $main = $procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($main) { $hwnd = $main.MainWindowHandle } }
    }
    $hasWindow = $hwnd -ne [IntPtr]::Zero
    $hidden = $native -and $hasWindow -and -not [PetWin]::Visible($hwnd)
    $foreground = $ids -contains $fgPid

    $busy = $false; $label = ''; $scanMs = -1; $cands = @()
    if ($s.cached) {
      try { $n = $s.cached.Current.Name; if ($n -match $app.re) { $busy = $true; $label = $n } else { $s.cached = $null } } catch { $s.cached = $null }
    }
    $sinceFull = ($now - $s.lastFull).TotalSeconds
    $needFull = $hasWindow -and ((-not $busy -and (($pct -gt 1.5 -and $sinceFull -ge 1.5) -or $sinceFull -ge 10)) -or ($busy -and $sinceFull -ge 3))
    if ($needFull) {
      $s.lastFull = $now
      $sw = [Diagnostics.Stopwatch]::StartNew()
      try {
        $root = $AE::FromHandle($hwnd)
        $nameCache.Push()
        try { $all = $root.FindAll($Scope::Descendants, $btnCond) } finally { $nameCache.Pop() }
        $busy = $false; $label = ''; $s.cached = $null; $approveName = ''; $doneN = 0
        foreach ($e in $all) {
          try { $n = $e.Cached.Name } catch { try { $n = $e.Current.Name } catch { continue } }
          if (-not $n) { continue }
          if (-not $busy -and $n -match $app.re) { $busy = $true; $label = $n; $s.cached = $e }
          if (-not $approveName -and $app.approve -and $n -match $app.approve) { $approveName = $n }
          # 답이 끝나면 그 답 아래에 생기는 버튼(복사·좋은 응답 등) 수. 늘어나면 '진짜 끝'이라는 뜻이다.
          if ($app.done -and $n -match $app.done) { $doneN++ }
          if ($n.Length -le 40 -and $n -match $diagRe -and -not $s.seen.ContainsKey($n) -and $s.seen.Count -lt 100) { $s.seen[$n] = 1; $cands += $n }
        }
        $s.approve = $approveName
        if ($app.done) { $s.doneCount = $doneN }
      } catch { [Console]::Error.WriteLine("scan $($app.key): $($_.Exception.Message)") }
      $scanMs = $sw.ElapsedMilliseconds
    }
    if (-not $hasWindow) { $s.approve = '' }

    Emit @{ key = $app.key; app = ($procs.Count -gt 0); window = $hasWindow; hidden = $hidden; fg = $foreground; busy = $busy; approve = $s.approve; cpu = [Math]::Round($pct, 1); label = $label; scanMs = $scanMs; cands = $cands; exe = $exe; doneCount = $s.doneCount }
  }
  Start-Sleep -Milliseconds 1000
}
