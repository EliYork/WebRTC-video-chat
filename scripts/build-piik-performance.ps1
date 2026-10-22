param([string]$AdaptiveSource, [switch]$CaptureCadence)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $root 'integrations/piik/.deps/upstream'
$out = Join-Path $root 'integrations/piik/.build/performance/native'
New-Item -ItemType Directory -Force $out | Out-Null
$native = Join-Path $source 'native/capture/windows'
$sdk = Join-Path $source 'build/encoder-pool/webrtc'
$vs = & "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Visual Studio C++ tools unavailable' }
$dev = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
$flags = '/nologo /c /std:c++20 /EHsc /GR /O2 /MT /DNDEBUG /DNOMINMAX /DWEBRTC_WIN /DRTC_ENABLE_H265 /D_ITERATOR_DEBUG_LEVEL=0 /DUNICODE /D_UNICODE /DWIN32_LEAN_AND_MEAN /D_WIN32_WINNT=0x0A00 /DNTDDI_VERSION=0x0A00000A /external:W0'
foreach ($inc in @($native,"$sdk/include","$sdk/include/third_party/abseil-cpp","$sdk/include/third_party/boringssl/src/include","$sdk/include/third_party/libyuv/include")) { $flags += ' /I "' + $inc + '"' }
function Run([string]$cmd) {
  & cmd.exe /d /s /c ('call "{0}" -arch=x64 -host_arch=x64 >nul && {1}' -f $dev,$cmd)
  if ($LASTEXITCODE -ne 0) { throw 'Performance fixture compilation failed' }
}
if ($CaptureCadence) {
  Run ('cl.exe {0} "{1}" /Fo:"{2}/cadence.obj"' -f $flags,(Join-Path $PSScriptRoot 'fixtures/piik-capture-cadence.cpp'),$out)
  Run ('link.exe /nologo /out:"{0}/cadence.exe" "{0}/cadence.obj" "{1}/lib/webrtc.lib" winmm.lib ws2_32.lib secur32.lib dmoguids.lib msdmo.lib wmcodecdspuuid.lib' -f $out,$sdk)
  & (Join-Path $out 'cadence.exe') (Join-Path $PSScriptRoot 'fixtures/piik-wgc-timestamps.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Capture cadence regression failed' }
  Run ('cl.exe /nologo /std:c++20 /EHsc /O2 /MT /DUNICODE /D_UNICODE "{0}" /Fo:"{1}/motion.obj" /Fe:"{1}/motion-window.exe" /link d3d11.lib dxgi.lib d3dcompiler.lib user32.lib' -f (Join-Path $PSScriptRoot 'fixtures/piik-motion-window.cpp'),$out)
  exit
}
Run ('cl.exe {0} "{1}" /Fo:"{2}/probe.obj"' -f $flags,(Join-Path $PSScriptRoot 'fixtures/piik-encoder-performance.cpp'),$out)
$adapter = Join-Path $source 'build/platform-native/adaptive_encoder.obj'
$name = 'baseline'
if ($AdaptiveSource) {
  Run ('cl.exe {0} "{1}" /Fo:"{2}/candidate.obj"' -f $flags,$AdaptiveSource,$out)
  $adapter = Join-Path $out 'candidate.obj'
  $name = 'candidate'
}
Run ('link.exe /nologo /out:"{0}/{1}.exe" "{0}/probe.obj" "{2}" "{3}/build/platform-native/h264_encoder.obj" "{4}/lib/webrtc.lib" ole32.lib evr.lib mfplat.lib mf.lib mfuuid.lib d3d11.lib dxgi.lib dxguid.lib oleaut32.lib windowsapp.lib winmm.lib ws2_32.lib strmiids.lib crypt32.lib dmoguids.lib iphlpapi.lib msdmo.lib secur32.lib wmcodecdspuuid.lib user32.lib gdi32.lib' -f $out,$name,$adapter,$source,$sdk)

