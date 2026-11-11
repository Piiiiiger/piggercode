#!/usr/bin/env bash
# Installs the PiggerCode APK in the running emulator, launches it, waits, then saves a screenshot and the logcat to
# ./smoke and fails if the app crashed or is not running. It never logs in.
set -u
apk=$(ls $1)
pkg=dev.piggercode.app
mkdir -p smoke
adb install -r "$apk" || { echo "install failed"; exit 1; }
adb logcat -c
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1
sleep 45
adb exec-out screencap -p > smoke/screenshot.png
adb logcat -d > smoke/logcat.txt
adb shell pidof "$pkg" > smoke/pid.txt || true
status=0
if grep -q "FATAL EXCEPTION" smoke/logcat.txt; then
  echo "crash found in logcat"; grep -A12 "FATAL EXCEPTION" smoke/logcat.txt | head -40; status=1
fi
if [ ! -s smoke/pid.txt ]; then echo "$pkg is not running"; status=1; fi
exit $status
