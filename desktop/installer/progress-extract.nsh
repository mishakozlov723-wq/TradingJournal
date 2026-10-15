# Included after electron-builder's locked installer.nsh. Normal updater runs
# keep its exact extraction/retry macro; only our session uses byte callbacks.
!include "${PROJECT_DIR}\build\progress-original.nsh"
!macroundef extractUsing7za
!macro extractUsing7za FILE
  ${if} $SyterSession == ""
    !insertmacro syterOriginalExtract "${FILE}"
  ${else}
    Push $OUTDIR
    CreateDirectory "$PLUGINSDIR\7z-out"
    SetOutPath "$PLUGINSDIR\7z-out"
    WriteRegStr HKCU "Software\SYTER\Installer" "Stage" "extracting"
    GetFunctionAddress $SyterCallback SyterExtractProgress
    Nsis7z::ExtractWithCallback "${FILE}" $SyterCallback
    Pop $R0
    SetOutPath $R0
    ${if} $SyterTotal == 0
      WriteRegStr HKCU "Software\SYTER\Installer" "Stage" "error"
      SetErrorLevel 2
      Quit
    ${endif}
    WriteRegStr HKCU "Software\SYTER\Installer" "Stage" "copying"
    Push "$PLUGINSDIR\7z-out"
    Push "$OUTDIR"
    Call SyterCopyTree
    ${if} $SyterCopied != $SyterTotal
      WriteRegStr HKCU "Software\SYTER\Installer" "Stage" "error"
      SetErrorLevel 2
      Quit
    ${endif}
    WriteRegStr HKCU "Software\SYTER\Installer" "Stage" "finalizing"
  ${endif}
!macroend
