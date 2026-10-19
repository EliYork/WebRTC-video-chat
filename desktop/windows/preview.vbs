' Local source preview only. Starts hidden helper processes and a new client
' window when the user double-clicks. Closing that window stops its services.
Option Explicit
Dim shell, fs, scriptPath
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
scriptPath = fs.GetAbsolutePathName(fs.BuildPath(fs.GetParentFolderName(WScript.ScriptFullName), "..\..\scripts\preview-desktop.mjs"))
shell.Run "node.exe """ & scriptPath & """", 0, False
