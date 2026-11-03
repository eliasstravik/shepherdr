#!/usr/bin/env bash
# Restarts a task's agent through herdr-task (same folder, with a handoff; no
# tab, as every task agent now), optionally as another agent. A worker keeps its
# coordinator as parent, so it stays nested under it.
# Usage: task.sh <task key> <folder> <parent address or ""> [agent key]
set -u
key=$1 folder=$2 parent=${3:-} agent=${4:-}
herdr-task switch "$key" --folder "$folder" ${parent:+--parent "$parent"} ${agent:+--agent "$agent"} --json >/dev/null
