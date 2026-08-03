#!/bin/sh
set -e
url="$1"
tries="${2:-60}"
i=0
while [ "$i" -lt "$tries" ]; do
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "ready: $url"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "timeout waiting for $url" >&2
exit 1
