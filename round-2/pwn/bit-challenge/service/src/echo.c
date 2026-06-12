/*
 * bit-challenge — echo program with a single 1-bit patch primitive.
 *
 *   read(0, buf, 256) gives the player free run to overflow buf[64];
 *   on its own, that would be a textbook BOF. The wrinkle is a stack
 *   canary: any overflow that touches the canary slot is caught at
 *   function exit by __stack_chk_fail and the program aborts before
 *   it can return.
 *
 *   The 1-bit primitive is the canary check itself. The compiler emits
 *
 *     mov rdx, [rbp-0x8]            ; saved canary
 *     sub rdx, fs:0x28              ; xor against TLS canary
 *     je  canary_ok    <-- 74 XX    ; flip bit 0 to 75 (jne) and the
 *     call __stack_chk_fail          ; check inverts: corrupted canary
 *   canary_ok:                       ; now takes the jump
 *     leave; ret
 *
 *   With the canary defeated, the player has a clean overflow into
 *   saved RIP — but no shell helpers to ret into:
 *       no win()
 *       no system() (not linked)
 *       no /bin/sh string (not linked)
 *   Only "/flag" is anchored in .rodata. Exploitation requires a
 *   full open/read/write syscall ROP chain through static glibc:
 *       open ("/flag", O_RDONLY)  -> fd
 *       read (fd,    buf, N)      -> bytes
 *       write(1,     buf, N)      -> stdout
 *
 * Compile with:
 *   gcc -static -no-pie -fstack-protector-all -O0
 *
 * No PIE, NX on (default).
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <unistd.h>

/* The only data foothold the player gets: the path of the flag file,
   anchored in .rodata. The binary never references it via code;
   `__attribute__((used))` keeps it from being garbage-collected. */
__attribute__((used))
static const char flag_path[] = "/flag";

/* The only syscall foothold: three single-pop gadgets dropped into
   .text via inline assembly. Modern static glibc on Ubuntu 24.04 has
   ZERO clean rdx-control gadgets — without `pop rdx; ret` the ORW
   chain is unbuildable. Anchoring pop_rdi/rsi/rdx gives the player
   enough to construct the chain; pop_rax and syscall already exist
   in glibc. The bytes emitted are exactly:
       5f c3 5e c3 5a c3
   The player must locate them in the stripped binary (no symbols). */
__asm__(
    ".text\n"
    ".p2align 2\n"
    "    pop %rdi\n"
    "    ret\n"
    "    pop %rsi\n"
    "    ret\n"
    "    pop %rdx\n"
    "    ret\n"
);

int main(void) {
    char buf[64];
    setbuf(stdout, NULL);

    write(1, "echo> ", 6);
    ssize_t n = read(0, buf, 512);
    if (n <= 0) return 0;

    write(1, buf, n);
    return 0;
}
