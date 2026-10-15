# Fixed current-user receipt; no renderer-supplied paths or executable names.
!macro customInstall
  WriteRegStr HKCU "Software\SYTER\Desktop" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\SYTER\Desktop" "Version" "${VERSION}"
!macroend
