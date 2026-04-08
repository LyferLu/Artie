@echo off

set PATH=C:\Windows\System32;%PATH%

@call installer\Scripts\activate.bat

@call artie start-web-config --config-file %0\..\installer_config.json

PAUSE