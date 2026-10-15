# Installer status is scoped to the main-process-generated session. Fixed HKCU
# key only: the renderer cannot choose paths, commands or registry locations.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Var SyterSession
    Var SyterExtracted
    Var SyterCopied
    Var SyterTotal
    Var SyterNextReport
    Var SyterCallback
    Var SyterTemp
    Function SyterExtractProgress
      Pop $SyterExtracted
      Pop $SyterTotal
      ${if} $SyterExtracted >= $SyterNextReport
      ${orIf} $SyterExtracted == $SyterTotal
        WriteRegStr HKCU "Software\SYTER\Installer" "Total" "$SyterTotal"
        WriteRegStr HKCU "Software\SYTER\Installer" "Extracted" "$SyterExtracted"
        IntOp $SyterNextReport $SyterExtracted + 1048576
      ${endif}
    FunctionEnd
    Function SyterCopyTree
      Exch $R1
      Exch
      Exch $R0
      Push $R2
      Push $R3
      Push $R4
      Push $R5
      CreateDirectory "$R1"
      FindFirst $R3 $R2 "$R0\*"
      syter_copy_next:
        StrCmp $R2 "" syter_copy_end
        StrCmp $R2 "." syter_copy_skip
        StrCmp $R2 ".." syter_copy_skip
        IfFileExists "$R0\$R2\*.*" syter_copy_dir syter_copy_file
        syter_copy_dir:
          Push "$R0\$R2"
          Push "$R1\$R2"
          Call SyterCopyTree
          Goto syter_copy_skip
        syter_copy_file:
          ClearErrors
          FileOpen $SyterTemp "$R0\$R2" r
          IfErrors syter_copy_failed
          FileSeek $SyterTemp 0 END $R4
          FileClose $SyterTemp
          StrCpy $R5 0
          syter_copy_retry:
            ClearErrors
            CopyFiles /SILENT "$R0\$R2" "$R1"
            IfErrors 0 syter_copy_done
            IntOp $R5 $R5 + 1
            ${if} $R5 < 5
              Sleep 200
              Goto syter_copy_retry
            ${endif}
            Goto syter_copy_failed
          syter_copy_done:
            IntOp $SyterCopied $SyterCopied + $R4
            WriteRegStr HKCU "Software\SYTER\Installer" "Copied" "$SyterCopied"
        syter_copy_skip:
          FindNext $R3 $R2
          Goto syter_copy_next
      syter_copy_failed:
        WriteRegStr HKCU "Software\SYTER\Installer" "Stage" "error"
        SetErrorLevel 2
        Quit
      syter_copy_end:
        FindClose $R3
        Pop $R5
        Pop $R4
        Pop $R3
        Pop $R2
        Pop $R0
        Pop $R1
    FunctionEnd
  !endif
!macroend
!macro customInit
  ${StdUtils.GetParameter} $SyterSession "syter-session" ""
  StrCpy $SyterExtracted 0
  StrCpy $SyterCopied 0
  StrCpy $SyterTotal 0
  StrCpy $SyterNextReport 0
  ${if} $SyterSession != ""
    WriteRegStr HKCU "Software\SYTER\Installer" "Stage" "preparing"
    WriteRegStr HKCU "Software\SYTER\Installer" "Total" "0"
    WriteRegStr HKCU "Software\SYTER\Installer" "Extracted" "0"
    WriteRegStr HKCU "Software\SYTER\Installer" "Copied" "0"
    WriteRegStr HKCU "Software\SYTER\Installer" "Location" "$INSTDIR"
    WriteRegStr HKCU "Software\SYTER\Installer" "Session" "$SyterSession"
  ${endif}
!macroend
!macro customInstall
  WriteRegStr HKCU "Software\SYTER\Desktop" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\SYTER\Desktop" "Version" "${VERSION}"
  ${if} $SyterSession != ""
    WriteRegStr HKCU "Software\SYTER\Installer" "Stage" "installed"
  ${endif}
!macroend
