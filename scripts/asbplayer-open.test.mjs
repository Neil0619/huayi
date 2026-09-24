import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pickWindowsMedia } from "./asbplayer-open.mjs";

// Observe and dismiss only the real dialog created on this test process's UI thread.
// No browser, desktop settings, real media or other process's windows are touched.
const observeDialog = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class OpenerPickerTest {
  delegate bool Callback(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool EnumThreadWindows(uint thread, Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder value, int count);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  public static bool ObserveAndCancel(string path) {
    bool found = false;
    EnumThreadWindows(GetCurrentThreadId(), (window, parameter) => {
      var name = new StringBuilder(128);
      GetClassName(window, name, 128);
      if (name.ToString() != "#32770" || !IsWindowVisible(window)) return true;
      Rect rect;
      GetWindowRect(window, out rect);
      bool topmost = (GetWindowLong(window, -20) & 8) != 0;
      File.WriteAllText(path, "visible=True;topmost=" + topmost + ";sized=" + (rect.Right > rect.Left && rect.Bottom > rect.Top));
      PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
      found = true;
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$observer = New-Object System.Windows.Forms.Timer
$observer.Interval = 100
$observer.Add_Tick({ if ([OpenerPickerTest]::ObserveAndCancel($env:SEEN_SAID_PICKER_OBSERVATION)) { $observer.Stop() } })
$observer.Start()
`;

test(
  "native file picker appears above the browser and cancellation releases its temporary owner",
  {
    skip:
      process.platform !== "win32" && "Requires real Windows Forms; runs in Windows quality gate",
    timeout: 30_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "seen-said-picker-test-"));
    const observationPath = join(directory, "observation.txt");
    let child;
    try {
      const selected = await pickWindowsMedia(false, (command, args, options) => {
        const instrumented = [...args];
        instrumented[instrumented.length - 1] =
          observeDialog +
          args.at(-1) +
          `; $observer.Stop(); $observer.Dispose(); [IO.File]::AppendAllText($env:SEEN_SAID_PICKER_OBSERVATION, ';openForms=' + [System.Windows.Forms.Application]::OpenForms.Count)`;
        child = spawn(command, instrumented, {
          ...options,
          timeout: 20_000,
          env: { ...process.env, SEEN_SAID_PICKER_OBSERVATION: observationPath },
        });
        return child;
      });
      assert.equal(selected, null, "Cancelling the actual native picker returns no file");
      assert.equal(
        await readFile(observationPath, "utf8"),
        "visible=True;topmost=True;sized=True;openForms=0",
        "The dialog must surface above Chrome and dispose its owner after cancellation",
      );
    } finally {
      if (child?.exitCode === null) child.kill();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
