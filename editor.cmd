@echo off
REM Lanza el editor HoneyComb desde cualquier lado.
REM
REM Es un .cmd y no un .ps1 a proposito: PowerShell bloquea los .ps1 cuando la
REM ExecutionPolicy esta en Restricted (que es el default de Windows), y por eso
REM "npm run dev" falla ahi. Los .cmd no pasan por esa politica, asi que esto
REM funciona igual en PowerShell, en cmd y haciendo doble clic.
REM
REM Uso:  .\editor.cmd          -> dev server + editor, con recarga en vivo
REM       .\editor.cmd build    -> compila y abre sin dev server

setlocal

REM %~dp0 es la carpeta de este archivo, con barra final: el editor arranca
REM siempre desde el lugar correcto sin importar donde estes parado.
cd /d "%~dp0editor"

REM VS Code exporta esto en su terminal integrada y hace que Electron arranque
REM como Node puro ("Cannot read properties of undefined (reading 'whenReady')").
set "ELECTRON_RUN_AS_NODE="

if /i "%~1"=="build" (
  echo [honeycomb] compilando el editor...
  call npm.cmd run build || goto :error
  call npm.cmd run electron || goto :error
) else (
  call npm.cmd run dev || goto :error
)

endlocal
exit /b 0

:error
echo.
echo [honeycomb] Fallo el arranque. Si es la primera vez, corre: npm.cmd install
endlocal
exit /b 1
