#!/bin/bash
echo "$(date) run.sh started" >> /tmp/slop-browser-run.log
echo "$(date) PATH=$PATH" >> /tmp/slop-browser-run.log
echo "$(date) pwd=$(pwd)" >> /tmp/slop-browser-run.log
exec /Users/REDACTED_USER/.bun/bin/bun run /Volumes/REDACTED_VOLUME/00-09_System/01_Tools/slop-browser/daemon/index.ts 2>> /tmp/slop-browser-run.log
