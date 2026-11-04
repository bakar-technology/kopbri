'use strict';
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

const watch = String.raw`
$ErrorActionPreference = 'Stop'
$assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
  [Reflection.AssemblyName]::new('KopbriNative'),[Reflection.Emit.AssemblyBuilderAccess]::Run)
$module = $assembly.DefineDynamicModule('Keys')
$type = $module.DefineType('KopbriKeys',[Reflection.TypeAttributes]'Public,Abstract,Sealed')
$method = $type.DefinePInvokeMethod('GetAsyncKeyState','user32.dll',
  [Reflection.MethodAttributes]'Public,Static,PinvokeImpl',[Reflection.CallingConventions]::Standard,
  [int16],[type[]]@([int]),[Runtime.InteropServices.CallingConvention]::Winapi,
  [Runtime.InteropServices.CharSet]::Auto)
$method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
$keys = $type.CreateType()
[Console]::WriteLine('ready')
$parent = [Diagnostics.Process]::GetProcessById([int]$env:KOPBRI_KEY_PARENT)
$wasDown = $false
while (!$parent.HasExited) {
  $down = ($keys::GetAsyncKeyState(32) -band 32768) -ne 0
  if ($down -ne $wasDown) {
    if ($down) { [Console]::WriteLine('down') } else { [Console]::WriteLine('up') }
    $wasDown = $down
  }
  Start-Sleep -Milliseconds 15
}
`;

function registerPushToTalk(globalShortcut,send) {
  if (process.platform!=='win32') {
    globalShortcut.register('Control+Shift+Space',()=>send('voice'));
    return ()=>globalShortcut.unregister('Control+Shift+Space');
  }
  let active = false, down = false, observed = false, stderr = '';
  const key = 'Control+Shift+Space';
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const watcher = spawn(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(watch,'utf16le').toString('base64')],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,KOPBRI_KEY_PARENT:String(process.pid)}
  });
  function release() {
    if (!active) return;
    active = false;
    observed = false;
    send('voice-release');
  }
  const lines = readline.createInterface({input:watcher.stdout});
  lines.on('line',line => {
    if (line==='down') { down = true; if (active) observed = true; }
    if (line==='up') { down = false; if (active && observed) release(); }
  });
  watcher.stderr.on('data',chunk => { if (stderr.length<500) stderr += chunk; });
  watcher.on('error',error => console.warn('kopbri key watcher:',error.message));
  watcher.on('exit',code => { if (code) console.warn('kopbri key watcher:',code,stderr.slice(0,500)); });
  const registered = globalShortcut.register(key,() => {
    if (active) return;
    active = true;
    observed = down;
    send('voice-hold');
  });
  if (!registered) { watcher.kill(); console.warn('kopbri kısayolu kaydedilemedi: '+key); }
  const stop = () => { lines.close(); watcher.kill(); };
  stop.release = release;
  return stop;
}
module.exports = registerPushToTalk;
