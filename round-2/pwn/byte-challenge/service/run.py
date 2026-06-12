#!/usr/bin/env python3
"""byte-challenge — wrapper.

Interactive (default):
    asks whether you wish to flip a byte. If so, prints the per-session
    salt, then prompts for the offset (anywhere in the file) and the
    single byte that shall be written there (xor'd against that salt).

Non-interactive flags (used by the solver, also handy for testing):
    --no-patch                  leave the binary untouched
    --patch <offset> <hex2>     flip the byte without prompting
    --salt  <hex2>              override the random salt (testing only)

The XOR is wrapper-side only: the binary itself takes no argv and is
otherwise unmodified C. The salt prevents share-the-answer pwn — every
session, the encoded byte the player must submit changes.
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
BIN = os.path.join(HERE, "byte")


def parse_offset(raw, file_size):
    raw = raw.strip()
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", raw):
        n = int(raw, 16)
    elif re.fullmatch(r"[0-9]+", raw):
        n = int(raw, 10)
    else:
        raise ValueError(f"that is not a number i can read: {raw!r}")
    if n < 0 or n >= file_size:
        raise ValueError(
            f"the byte would fall outside the file "
            f"(offset {n}, file size {file_size})"
        )
    return n


def parse_byte(raw):
    s = raw.strip().replace(" ", "").replace(":", "").replace("0x", "").replace("0X", "")
    if not re.fullmatch(r"[0-9a-fA-F]{2}", s):
        raise ValueError(
            f"the offering must be exactly two hex symbols (got {raw!r})"
        )
    return int(s, 16)


def parse_salt(raw):
    s = raw.strip().lower().replace("0x", "")
    if not re.fullmatch(r"[0-9a-f]{2}", s):
        raise ValueError(f"--salt must be exactly 2 hex chars (got {raw!r})")
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


def prompt_patch(file_size):
    while True:
        try:
            off_raw = input("  where shall the byte fall? (dec or 0xHEX) ")
            hex_raw = input("  what byte shall replace it? (2 hex)       ")
        except EOFError:
            sys.exit("\n  the choice is unmade.")
        try:
            return parse_offset(off_raw, file_size), parse_byte(hex_raw)
        except ValueError as e:
            print(f"  -> {e}", file=sys.stderr)


def apply_patch(path, offset, byte_val):
    """Write a single byte at `offset` in the file at `path`."""
    assert 0 <= byte_val <= 0xff
    with open(path, "r+b") as f:
        f.seek(offset)
        f.write(bytes([byte_val]))


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
    g.add_argument("--patch", nargs=2, metavar=("OFFSET", "HEX2"),
                   help="flip one byte non-interactively, then run")
    ap.add_argument("--salt", metavar="HEX2",
                    help="override the random per-session salt (2 hex chars)")
    args = ap.parse_args()

    if not os.path.isfile(BIN):
        sys.exit(f"the binary is missing from {BIN}.")
    file_size = os.path.getsize(BIN)

    fd, patched = tempfile.mkstemp(prefix="byte.")
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
            will_patch = prompt_yes_no("shall you flip a byte?",
                                       default=False)

        if will_patch:
            if args.salt is not None:
                salt = parse_salt(args.salt)
            else:
                salt = int.from_bytes(os.urandom(1), "big")
            print(f"  the byte's salt for this rite: {salt:02x}")
        else:
            salt = 0
            print("  the binary is left untouched.")

        if args.patch:
            offset = parse_offset(args.patch[0], file_size)
            submitted = parse_byte(args.patch[1])
            applied = submitted ^ salt
            apply_patch(patched, offset, applied)
        elif will_patch:
            offset, submitted = prompt_patch(file_size)
            applied = submitted ^ salt
            apply_patch(patched, offset, applied)
            print(f"  byte 0x{applied:02x} placed at offset "
                  f"{offset} (0x{offset:x}).")

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
