#!/usr/bin/env bash
# Closes a coordinator's tab. "stop" ends its workers first (their tabs close
# with them); "keep" leaves them running in their own tabs.
# Usage: close.sh <tab id> <coordinator address> stop|keep
set -u
tab=$1 coord=$2 mode=$3
if [ "$mode" = stop ]; then
  for w in $( { hc ls --json | jq -r --arg c "$coord" '.terminals[] | select(.parent == $c) | .address'
      hc ls --json --label "herdr.coordinator=$tab" | jq -r --arg c "$coord" '.terminals[] | select(.address != $c) | .address'; } | sort -u); do
    hc kill "$w" >/dev/null 2>&1
  done
fi
herdr-app do tab.close --id "$tab" --confirmed true >/dev/null
