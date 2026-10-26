#!/bin/sh
# Shows which model the user picked. Reads only (the 2>/dev/null redirect is not a write to it).
cat ~/.claude/settings.json 2>/dev/null | jq -r '.model // "default"'
