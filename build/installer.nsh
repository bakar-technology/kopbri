!macro customInstall
  ${If} $LANGUAGE == 1055
    DetailPrint "kopbri: Ajan araçları kontrol ediliyor..."
  ${Else}
    DetailPrint "kopbri: Checking agent tools..."
  ${EndIf}
  ${If} ${Silent}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --setup-providers --silent-setup' $0
  ${Else}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --setup-providers --setup-language=$LANGUAGE' $0
  ${EndIf}
!macroend
