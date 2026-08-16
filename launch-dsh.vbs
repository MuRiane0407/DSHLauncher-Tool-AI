' DSH Launcher - silent launcher (no console window)
' Runs the bundled Electron binary directly (a GUI app, so no cmd popup).
' Requires: run `npm install` first (needs node_modules\electron\dist\electron.exe).

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = scriptDir

electronPath = scriptDir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electronPath) Then
    MsgBox "Electron not found:" & vbCrLf & electronPath & vbCrLf & vbCrLf & "Please run 'npm install' first.", vbExclamation, "DSH Launcher"
    WScript.Quit 1
End If

sh.Run """" & electronPath & """ .", 0, False
