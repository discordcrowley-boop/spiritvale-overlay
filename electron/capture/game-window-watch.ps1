if (-not ([System.Management.Automation.PSTypeName]'SvoGameWin').Type) {
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class SvoGameWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);

  static bool LooksLikeGame(string processName, string title, string className) {
    if (string.IsNullOrEmpty(processName)) return false;
    if (processName.IndexOf("Overlay", StringComparison.OrdinalIgnoreCase) >= 0) return false;
    if (processName.IndexOf("Companion", StringComparison.OrdinalIgnoreCase) >= 0) return false;
    if (processName.IndexOf("electron", StringComparison.OrdinalIgnoreCase) >= 0) return false;
    if (processName.IndexOf("SpiritVale", StringComparison.OrdinalIgnoreCase) >= 0) return true;
    if (!string.IsNullOrEmpty(title) && title.IndexOf("SpiritVale", StringComparison.OrdinalIgnoreCase) >= 0 &&
        title.IndexOf("Overlay", StringComparison.OrdinalIgnoreCase) < 0 &&
        title.IndexOf("Companion", StringComparison.OrdinalIgnoreCase) < 0) return true;
    return className == "UnityWndClass" && !string.IsNullOrEmpty(title) &&
           title.IndexOf("Spirit", StringComparison.OrdinalIgnoreCase) >= 0;
  }

  public static IntPtr FindHwnd() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hwnd, lParam) => {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid == 0) return true;
      string processName = "";
      try { processName = Process.GetProcessById((int)pid).ProcessName; } catch { return true; }
      var title = new StringBuilder(512);
      GetWindowText(hwnd, title, title.Capacity);
      var cls = new StringBuilder(256);
      GetClassName(hwnd, cls, cls.Capacity);
      if (!LooksLikeGame(processName, title.ToString(), cls.ToString())) return true;
      found = hwnd;
      return false;
    }, IntPtr.Zero);
    return found;
  }

  public static bool ProcessRunning() {
    foreach (var p in Process.GetProcesses()) {
      try {
        if (p.ProcessName.IndexOf("SpiritVale", StringComparison.OrdinalIgnoreCase) >= 0 &&
            p.ProcessName.IndexOf("Overlay", StringComparison.OrdinalIgnoreCase) < 0 &&
            p.ProcessName.IndexOf("Companion", StringComparison.OrdinalIgnoreCase) < 0) return true;
      } catch { }
    }
    return false;
  }

  public static string BoundsJson(IntPtr hwnd) {
    bool running = ProcessRunning();
    if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd) || IsIconic(hwnd)) {
      return running ? "{\"found\":false,\"process\":true}" : "{\"found\":false,\"process\":false}";
    }
    RECT r;
    int ok = DwmGetWindowAttribute(hwnd, 9, out r, Marshal.SizeOf(typeof(RECT)));
    if (ok != 0 && !GetWindowRect(hwnd, out r)) {
      return running ? "{\"found\":false,\"process\":true}" : "{\"found\":false,\"process\":false}";
    }
    int w = r.Right - r.Left;
    int h = r.Bottom - r.Top;
    if (w < 80 || h < 80) {
      return running ? "{\"found\":false,\"process\":true}" : "{\"found\":false,\"process\":false}";
    }
    return "{\"found\":true,\"process\":true,\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + w + ",\"height\":" + h + "}";
  }
}
"@
}

$last = ""
$ticks = 0
while ($true) {
  $hwnd = [SvoGameWin]::FindHwnd()
  $json = [SvoGameWin]::BoundsJson($hwnd)
  $ticks++
  if ($json -ne $last -or ($ticks % 10) -eq 0) {
    Write-Output $json
    $last = $json
  }
  Start-Sleep -Milliseconds 200
}
