#!/bin/bash

rootDir=$(pwd)

cd $rootDir/appium-script-schema
rm -rf ../src/appium-script-schema &>/dev/null || true; mkdir -p ../src/appium-script-schema; cp -rv src/*.proto ../src/appium-script-schema
