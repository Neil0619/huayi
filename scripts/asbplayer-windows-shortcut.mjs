import { spawn } from "node:child_process";

// WScript.Shell.Save uses the system ANSI code page for the destination filename.
// Use Windows Shell's Unicode interface for both ownership checks and persistence.
const command = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISeenSaidShellLinkW {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int length, IntPtr data, uint flags);
  void GetIDList(out IntPtr value);
  void SetIDList(IntPtr value);
  void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int length);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int length);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int length);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
  void GetHotkey(out short value);
  void SetHotkey(short value);
  void GetShowCmd(out int value);
  void SetShowCmd(int value);
  void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int length, out int index);
  void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string value, int index);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string value, uint reserved);
  void Resolve(IntPtr window, uint flags);
  void SetPath([MarshalAs(UnmanagedType.LPWStr)] string value);
}

public static class SeenSaidShortcut {
  public static void Save(string path, string target, string arguments, string previousArguments, string root) {
    object instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
    try {
      var link = (ISeenSaidShellLinkW)instance;
      var file = (IPersistFile)instance;
      if (File.Exists(path)) {
        file.Load(path, 0);
        var oldTarget = new StringBuilder(32768);
        var oldArguments = new StringBuilder(32768);
        link.GetPath(oldTarget, oldTarget.Capacity, IntPtr.Zero, 0);
        link.GetArguments(oldArguments, oldArguments.Capacity);
        if (!String.Equals(oldTarget.ToString(), target, StringComparison.OrdinalIgnoreCase) ||
            (!String.Equals(oldArguments.ToString(), arguments, StringComparison.Ordinal) &&
             !String.Equals(oldArguments.ToString(), previousArguments, StringComparison.Ordinal))) {
          throw new InvalidOperationException("Existing shortcut belongs to another installation");
        }
      }
      link.SetPath(target);
      link.SetArguments(arguments);
      link.SetWorkingDirectory(root);
      link.SetDescription("语见：打开原视频并自动准备音轨和字幕");
      file.Save(path, true);
    } finally {
      Marshal.FinalReleaseComObject(instance);
    }
  }
}
'@
$root = $env:SEEN_SAID_INSTALL_ROOT
$target = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Get-LauncherArguments([string]$directory) {
  return '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $directory '打开语见本机视频.ps1') + '"'
}
$arguments = Get-LauncherArguments $root
$previousArguments = Get-LauncherArguments $env:SEEN_SAID_PREVIOUS_ROOT
$desktop = if ($env:SEEN_SAID_DESKTOP) { $env:SEEN_SAID_DESKTOP } else { [Environment]::GetFolderPath('Desktop') }
$path = Join-Path $desktop '语见本机视频.lnk'
[SeenSaidShortcut]::Save($path, $target, $arguments, $previousArguments, $root)`;

export async function createMediaOpenerShortcut({
  destination,
  previousDestination,
  desktopDirectory,
  launch = spawn,
}) {
  await new Promise((resolvePromise, reject) => {
    const child = launch(
      "powershell.exe",
      ["-NoProfile", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          SEEN_SAID_INSTALL_ROOT: destination,
          SEEN_SAID_PREVIOUS_ROOT: previousDestination ?? destination,
          SEEN_SAID_DESKTOP: desktopDirectory ?? "",
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error("快捷方式创建失败，未替换其他安装入口。")),
    );
  });
}
