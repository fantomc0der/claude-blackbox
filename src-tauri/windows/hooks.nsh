; NSIS hooks for the Tauri installer and uninstaller.
;
; The stock installer only stops the main binary, and it does so with a forced
; kill that never runs the wrapper's exit hooks. Stop the Bun sidecar here too so
; a lingering server process cannot hold claude-blackbox-server.exe open while
; the installer overwrites it or the uninstaller deletes it.

!define SIDECARBINARYNAME "claude-blackbox-server.exe"

!macro StopSidecar
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "${SIDECARBINARYNAME}"
  !else
    nsis_tauri_utils::KillProcess "${SIDECARBINARYNAME}"
  !endif
  Pop $R0
  ${If} $R0 = 0
    ; Give the terminated process a moment to release its file handles.
    Sleep 500
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro StopSidecar
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro StopSidecar
!macroend
