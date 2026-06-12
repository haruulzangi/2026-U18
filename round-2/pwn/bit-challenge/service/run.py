#!/usr/bin/env python3
"""bit-challenge — wrapper.

Interactive (default):
    asks whether you wish to flip a bit. If so, prints the per-session
    salt, then prompts for a single absolute bit offset (0 .. file_bits-1).
    The submitted offset is xor'd against that salt before being applied,
    so the literal number a player types changes every session.

Non-interactive flags (used by the solver, also handy for testing):
    --no-patch                  leave the binary untouched
    --patch <bit_offset>        flip the bit without prompting
    --salt  <8hex>              override the random salt (testing only)

The XOR is wrapper-side only: the binary itself takes no argv and is
otherwise unmodified C. The salt prevents share-the-answer pwn — every
session, the encoded offset the player must submit changes.
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
BIN = os.path.join(HERE, "bit")

# 32-bit submission domain. Any unsigned 32-bit integer is a legal
# submission; the salted result must land inside the file.
SUBMIT_MAX = 1 << 32


def parse_offset(raw, hi):
    """Parse a non-negative integer in [0, hi). Accept dec or 0xHEX."""
    raw = raw.strip()
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", raw):
        n = int(raw, 16)
    elif re.fullmatch(r"[0-9]+", raw):
        n = int(raw, 10)
    else:
        raise ValueError(f"that is not a number i can read: {raw!r}")
    if n < 0 or n >= hi:
        raise ValueError(
            f"the bit would fall outside the submission domain "
            f"(offset {n}, max {hi})"
        )
    return n


def parse_salt(raw):
    s = raw.strip().lower().replace("0x", "")
    if not re.fullmatch(r"[0-9a-f]{8}", s):
        raise ValueError(f"--salt must be exactly 8 hex chars (got {raw!r})")
    return int(s, 16)


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


def prompt_patch():
    while True:
        try:
            raw = input("  where shall the bit fall? (dec or 0xHEX) ")
        except EOFError:
            sys.exit("\n  the cut is unmade.")
        try:
            return parse_offset(raw, SUBMIT_MAX)
        except ValueError as e:
            print(f"  -> {e}", file=sys.stderr)


def apply_patch(path, bit_offset):
    """Toggle a single bit at the absolute bit offset."""
    byte_off, bit_in_byte = divmod(bit_offset, 8)
    with open(path, "r+b") as f:
        f.seek(byte_off)
        b = f.read(1)
        if not b:
            raise ValueError(f"unexpected EOF at byte {byte_off}")
        new = bytes([b[0] ^ (1 << bit_in_byte)])
        f.seek(byte_off)
        f.write(new)


def run(path):
    # Inherit stdio so an exec'd /bin/sh talks straight to the socat pipe.
    return subprocess.run([path]).returncode


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--no-patch", action="store_true",
                   help="skip the prompt, run the binary unaltered")
    g.add_argument("--patch", metavar="BIT_OFFSET",
                   help="flip one bit non-interactively, then run")
    ap.add_argument("--salt", metavar="HEX8",
                    help="override the random per-session salt (8 hex chars)")
    args = ap.parse_args()

    if not os.path.isfile(BIN):
        sys.exit(f"the binary is missing from {BIN}.")
    file_size = os.path.getsize(BIN)
    file_bits = file_size * 8

    fd, patched = tempfile.mkstemp(prefix="bit.")
    os.close(fd)
    try:
        shutil.copy2(BIN, patched)
        os.chmod(patched, 0o755)

        # Decide whether to patch first — the salt is only meaningful (and
        # only revealed to the player) on the patching path.
        if args.patch:
            will_patch = True
        elif args.no_patch:
            will_patch = False
        else:
            will_patch = prompt_yes_no("shall you flip a bit?",
                                       default=False)

        if will_patch:
            if args.salt is not None:
                salt = parse_salt(args.salt)
            else:
                salt = int.from_bytes(os.urandom(4), "big")
            print(f"  the bit's salt for this rite: {salt:08x}")
        else:
            salt = 0
            print("  the binary is left untouched.")

        if args.patch:
            submitted = parse_offset(args.patch, SUBMIT_MAX)
        elif will_patch:
            submitted = prompt_patch()
        else:
            submitted = None

        if submitted is not None:
            applied = submitted ^ salt
            if applied < 0 or applied >= file_bits:
                msg = (f"  the salted bit offset falls outside the file "
                       f"(applied {applied}, file size {file_bits} bits)")
                if args.patch:
                    sys.exit(msg)
                print(f"  -> {msg}", file=sys.stderr)
                sys.exit(2)
            apply_patch(patched, applied)
            print(f"  bit at offset {applied} (0x{applied:x}) toggled.")

        sys.exit(run(patched))
    except OSError:
        pass
    finally:
        try:
            os.unlink(patched)
        except OSError:
            pass


if __name__ == "__main__":
    main()
