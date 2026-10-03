# Fullscreen color-matrix dimmer. Stays alive so Magnification.dll keeps the effect.
# Used when SpiritVale is exclusive/borderless fullscreen and an overlay cannot sit above it.
param([double]$Scale = 0.55)

if (-not ([System.Management.Automation.PSTypeName]'SvoNightMag').Type) {
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class SvoNightMag {
  [StructLayout(LayoutKind.Sequential)]
  public struct MAGCOLOREFFECT {
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 25)]
    public float[] transform;
  }

  [DllImport("Magnification.dll")] public static extern bool MagInitialize();
  [DllImport("Magnification.dll")] public static extern bool MagUninitialize();
  [DllImport("Magnification.dll")] public static extern bool MagSetFullscreenColorEffect(ref MAGCOLOREFFECT effect);

  public static bool Apply(float scale) {
    if (scale < 0.15f) scale = 0.15f;
    if (scale > 1f) scale = 1f;
    var fx = new MAGCOLOREFFECT {
      transform = new float[] {
        scale, 0, 0, 0, 0,
        0, scale, 0, 0, 0,
        0, 0, scale, 0, 0,
        0, 0, 0, 1, 0,
        0, 0, 0, 0, 1
      }
    };
    return MagSetFullscreenColorEffect(ref fx);
  }

  public static bool Reset() {
    return Apply(1f);
  }
}
"@
}

$ok = $false
try { $ok = [SvoNightMag]::MagInitialize() } catch { $ok = $false }
if (-not $ok) {
  Write-Output '{"ok":false,"error":"mag-init"}'
  exit 1
}

$applied = $false
try { $applied = [SvoNightMag]::Apply([float]$Scale) } catch { $applied = $false }
Write-Output ("{0}" -f (@{ ok = [bool]$applied; scale = $Scale } | ConvertTo-Json -Compress))

try {
  while ($true) {
    Start-Sleep -Seconds 30
    try { [void][SvoNightMag]::Apply([float]$Scale) } catch {}
  }
} finally {
  try { [void][SvoNightMag]::Reset() } catch {}
  try { [void][SvoNightMag]::MagUninitialize() } catch {}
}
