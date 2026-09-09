@echo off
setlocal

set "CARPETA=%USERPROFILE%\Buscador de transferencias"
set "REPOSITORIO=https://github.com/devteban/buscador-transferencias-santander.git"

where git >nul 2>nul
if errorlevel 1 goto falta_git

if exist "%CARPETA%\.git\" goto actualizar
if exist "%CARPETA%" goto carpeta_ocupada

echo Preparando el buscador por primera vez...
git clone --branch main --single-branch "%REPOSITORIO%" "%CARPETA%"
if errorlevel 1 goto error_actualizar
goto abrir

:actualizar
echo Buscando la ultima version...
git -C "%CARPETA%" pull --ff-only origin main
if errorlevel 1 goto error_actualizar

:abrir
if not exist "%CARPETA%\buscador.html" goto falta_archivo
start "" "%CARPETA%\buscador.html"
exit /b 0

:falta_git
echo No se encontro Git en este ordenador.
echo Instala Git y vuelve a hacer doble clic en este archivo.
pause
exit /b 1

:carpeta_ocupada
echo La carpeta "%CARPETA%" ya existe, pero no contiene el buscador.
echo Cambiale el nombre o muevela y vuelve a intentarlo.
pause
exit /b 1

:error_actualizar
echo No se pudo descargar la ultima version.
echo Comprueba la conexion a Internet y vuelve a intentarlo.
pause
exit /b 1

:falta_archivo
echo Falta buscador.html en la carpeta descargada.
pause
exit /b 1
