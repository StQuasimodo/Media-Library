!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef BUILD_UNINSTALLER
  Var CinemaDesktopChoice
  Var CinemaDesktopCheckbox
  Var CinemaOptionsDialog

  !macro customInit
    ReadRegStr $CinemaDesktopChoice SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcutPreference
    ${If} $CinemaDesktopChoice != "0"
    ${AndIf} $CinemaDesktopChoice != "1"
      StrCpy $CinemaDesktopChoice "1"
    ${EndIf}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--no-desktop-shortcut" $R1
    ${IfNot} ${Errors}
      StrCpy $CinemaDesktopChoice "0"
    ${EndIf}
    ClearErrors
    ${GetOptions} $R0 "--desktop-shortcut" $R1
    ${IfNot} ${Errors}
      StrCpy $CinemaDesktopChoice "1"
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom CinemaOptionsPage CinemaOptionsLeave
  !macroend

  Function CinemaOptionsPage
    ${If} ${Silent}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "安装选项" "选择是否创建 My Cinema 桌面快捷方式。"
    nsDialogs::Create 1018
    Pop $CinemaOptionsDialog
    ${If} $CinemaOptionsDialog == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 16u 100% 14u "创建桌面快捷方式"
    Pop $CinemaDesktopCheckbox
    ${NSD_SetState} $CinemaDesktopCheckbox $CinemaDesktopChoice
    nsDialogs::Show
  FunctionEnd

  Function CinemaOptionsLeave
    ${NSD_GetState} $CinemaDesktopCheckbox $CinemaDesktopChoice
  FunctionEnd

  !macro customInstall
    ${If} $CinemaDesktopChoice == "1"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${Else}
      ; Explicit opt-out also clears shortcuts retained by an earlier installer.
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
      ${If} $oldDesktopLink != $newDesktopLink
        WinShell::UninstShortcut "$oldDesktopLink"
        Delete "$oldDesktopLink"
      ${EndIf}
    ${EndIf}
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcutPreference $CinemaDesktopChoice
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  !macroend
!endif

!macro customUnInstall
  WinShell::UninstShortcut "$oldDesktopLink"
  Delete "$oldDesktopLink"
!macroend
