#!/bin/sh
# Drop the runtime flag into /tmp/flag, where /flag symlinks to it.
# The image's rootfs is read-only; /tmp is a tmpfs the chal user owns.

set -e

: "${FLAG:?FLAG env var must be set}"

printf '%s\n' "$FLAG" > /tmp/flag
chmod 0444 /tmp/flag

exec socat -T 120 \
    "TCP-LISTEN:1337,reuseaddr,fork,nodelay" \
    "EXEC:/usr/bin/timeout 60 /chal/run.py,stderr"
