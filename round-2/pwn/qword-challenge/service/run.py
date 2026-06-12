#!/usr/bin/env python3
"""qword challenge — wrapper.

Interactive (default):
    asks whether you wish to reshape the qword. If so, prints the
    per-session salt, then prompts for the offset and the eight bytes
    that shall replace it (xor'd against that salt).

Non-interactive flags (used by the solver, also handy for testing):
    --no-patch                   leave the qword untouched
    --patch <offset> <16hex>     reshape it without prompting
    --salt  <16hex>              override the random salt (testing only)
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

# Stdout is a pipe under socat — make sure prompts flush at every newline.
sys.stdout.reconfigure(line_buffering=True)

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "qword")


def parse_offset(raw, file_size):
    raw = raw.strip()
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", raw):
        n = int(raw, 16)
    elif re.fullmatch(r"[0-9]+", raw):
        n = int(raw, 10)
    else:
        raise ValueError(f"that is not a number i can read: {raw!r}")
    if n < 0 or n + 8 > file_size:
        raise ValueError(
            f"the wound would fall outside the qword "
            f"(offset {n}, body length {file_size})"
        )
    return n


def parse_bytes(raw):
    s = raw.strip().replace(" ", "").replace(":", "")
    if not re.fullmatch(r"[0-9a-fA-F]{16}", s):
        raise ValueError(
            f"the offering must be exactly sixteen hex symbols (got {raw!r})"
        )
    return bytes.fromhex(s)


def parse_salt(raw):
    s = raw.strip().lower()
    if not re.fullmatch(r"[0-9a-f]{16}", s):
        raise ValueError(f"--salt must be exactly 16 hex chars (got {raw!r})")
    return s


def prompt_yes_no(question, default=False):
    suffix = " [Y/n] " if default else " [y/N] "
    while True:
        try:
            ans = input(question + suffix).strip().lower()
        except EOFError:
            print()
            return default
        if ans == "":
            return default
        if ans in ("y", "yes"):
            return True
        if ans in ("n", "no"):
            return False
        print("  ... yes, or no.")


def prompt_patch(file_size):
    while True:
        try:
            off_raw = input("  where shall the wound fall? (dec or 0xHEX) ")
            hex_raw = input("  what shall replace those bytes? (16 hex) ")
        except EOFError:
            sys.exit("\n  the ritual is broken.")
        try:
            return parse_offset(off_raw, file_size), parse_bytes(hex_raw)
        except ValueError as e:
            print(f"  -> {e}", file=sys.stderr)


def apply_patch(path, offset, data):
    assert len(data) == 8
    with open(path, "r+b") as f:
        f.seek(offset)
        f.write(data)


def run(path, salt_hex):
    # The binary reads argv[1] as the salt; with salt = 0000...0000
    # the runtime XOR is identity and the original exit syscall stays.
    return subprocess.run([path, salt_hex]).returncode


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--no-patch", action="store_true",
                   help="skip the prompt, run the qword unaltered")
    g.add_argument("--patch", nargs=2, metavar=("OFFSET", "HEX16"),
                   help="reshape it non-interactively, then run")
    ap.add_argument("--salt", metavar="HEX16",
                    help="override the random per-session salt (16 hex chars)")
    args = ap.parse_args()

    if not os.path.isfile(BIN):
        sys.exit(f"the qword is missing from {BIN}.")
    file_size = os.path.getsize(BIN)

    fd, patched = tempfile.mkstemp(prefix="qword.")
    os.close(fd)
    try:
        shutil.copy2(BIN, patched)
        os.chmod(patched, 0o755)

        # Decide whether we'll patch first — the salt is only meaningful
        # (and only revealed to the player) on the patching path.
        if args.patch:
            will_patch = True
        elif args.no_patch:
            will_patch = False
        else:
            will_patch = prompt_yes_no("shall you reshape the qword?",
                                       default=False)

        if will_patch:
            salt_hex = parse_salt(args.salt) if args.salt else os.urandom(8).hex()
            print(f"  the qword's salt for this rite: {salt_hex}")
        else:
            # No patch: feed the binary an all-zero salt so the runtime
            # XOR is a no-op and the original exit syscall is preserved.
            salt_hex = "00" * 8
            print("  the qword keeps its shape.")

        if args.patch:
            offset = parse_offset(args.patch[0], file_size)
            data = parse_bytes(args.patch[1])
            apply_patch(patched, offset, data)
        elif will_patch:
            offset, data = prompt_patch(file_size)
            apply_patch(patched, offset, data)
            print(f"  the qword has been reshaped at offset "
                  f"{offset} (0x{offset:x}).")

        sys.exit(run(patched, salt_hex))
    except OSError:
        pass
    finally:
        try:
            os.unlink(patched)
        except OSError:
            pass


if __name__ == "__main__":
    main()
