; Remove the per-user Explorer entry and the login item when the app is uninstalled.
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\ConvertWithConvert"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Convert"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.convert.app"
!macroend
