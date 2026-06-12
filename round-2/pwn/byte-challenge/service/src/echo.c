/*
 * byte-challenge — echo program with a single 1-byte patch primitive.
 *
 *   read(0, buf, 64) is the intended patch target. The constant 64 is
 *   emitted as `mov edx, 0x40` (BA 40 00 00 00) inside main; flipping
 *   the 0x40 byte to anything larger turns the bounded read into a
 *   classic stack overflow on buf[64], at which point the player can
 *   ROP through static glibc to system("/bin/sh").
 *
 * Compile with:
 *   gcc -static -no-pie -fno-stack-protector -O0
 *
 * No PIE, no canary, NX on (default). Statically linked so the player
 * has the full glibc gadget surface to work with.
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
    char buf[64];
    setbuf(stdout, NULL);

    /* Force __libc_system into the static link. The branch is unreachable
       (the env var name is reserved-looking and never set), but the
       compiler-visible call keeps `system` from being garbage-collected
       by --gc-sections or simple unreachability analysis. */
    if (getenv("__byte_challenge_never__")) system("");

    write(1, "echo> ", 6);
    ssize_t n = read(0, buf, 64);
    if (n <= 0) return 0;

    write(1, buf, n);
    return 0;
}
