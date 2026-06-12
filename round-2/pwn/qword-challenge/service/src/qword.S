/*
 * qword challenge — echo program with per-session XOR obfuscation.
 *
 * Defences (and only defences):
 *
 *   1. Per-session XOR.  At runtime the binary mprotects its .text page
 *      RWX and XORs the 8 bytes at `patch_site` against an 8-byte salt
 *      passed as argv[1] (16 hex chars). The wrapper prints a fresh
 *      random salt every session, so the bytes the player actually
 *      submits are
 *           desired_shellcode XOR salt
 *      and the right answer is different every time.
 *
 *   2. linebuf-as-path.  At the patch site rdi already points at
 *      `linebuf` — the buffer the user just wrote into via the echo
 *      step. The player must therefore type "/bin/sh\0..." as their
 *      echo line so that linebuf starts with the pathname execve needs.
 *
 * Notably absent: a `/bin/sh` string anywhere in the binary, and any
 * standalone execve gadget. Earlier iterations had a "decoy" execve
 * block in .text — that turned out to be a foothold, because the
 * player could neutralise the jmp that skips it (or rewrite e_entry)
 * and fall straight into a working execve("/bin/sh",0,0). The only
 * robust fix is to not have the gadget at all.
 */

    .intel_syntax noprefix

    .section .rodata
    /* Soft bait. Visible to `strings qword`, never referenced by any
     * instruction in the binary. The player has 8 bytes; loading this
     * string's address (lea = 7 bytes) plus the rest of an execve
     * setup will not fit, and no existing code prearranges rdi here.
     * It is data, and .rodata is not executable, so a jump into it
     * faults. The only purpose is to mislead pattern-matching analysis
     * that scans for `/bin/sh` and assumes a textbook execve flow. */
    .asciz "/bin/sh"

banner:
    .ascii "  .:: q w o r d ::.\n"
    .ascii "eight bytes lie between you and the void.\n"
    .ascii "speak a word; it shall be returned to you.\n"
    .ascii "\n"
    .ascii ":: "
banner_end:

    .section .bss
    .lcomm linebuf, 256
    .lcomm salt,    8

    .section .text
    .global _start
_start:
    /* Stack at _start:  [rsp]=argc  [rsp+8]=argv[0]  [rsp+16]=argv[1] ...
     * argv[1] is the 16-hex-char salt. Parse it into the 8-byte `salt`
     * buffer in .bss. If argv[1] is missing, abort — the binary
     * refuses to run without the wrapper passing a salt. This stops
     * a standalone "./qword" invocation from running with salt=0
     * (which would let any raw shellcode in patch_site execute). */
    mov     rdi, [rsp + 16]
    test    rdi, rdi
    jnz     1f
    mov     eax, 60
    mov     edi, 99
    syscall
1:  lea     r9, [rip + salt]
    mov     ecx, 8
.Lparse_loop:
    movzx   eax, byte ptr [rdi]
    sub     al, '0'
    cmp     al, 9
    jbe     1f
    sub     al, 'a' - '0' - 10
1:  shl     al, 4
    mov     dl, al
    movzx   eax, byte ptr [rdi+1]
    sub     al, '0'
    cmp     al, 9
    jbe     2f
    sub     al, 'a' - '0' - 10
2:  or      dl, al
    mov     [r9], dl
    add     rdi, 2
    inc     r9
    dec     ecx
    jnz     .Lparse_loop

    /* write(1, banner, banner_end - banner) */
    mov     eax, 1
    mov     edi, 1
    lea     rsi, [rip + banner]
    mov     edx, banner_end - banner
    syscall

    /* Read one line into linebuf, byte-by-byte, stop at '\n' or 255. */
    xor     r12, r12
.Lread_loop:
    cmp     r12, 255
    jge     .Lread_done
    xor     eax, eax
    xor     edi, edi
    lea     rsi, [rip + linebuf]
    add     rsi, r12
    mov     edx, 1
    syscall
    test    rax, rax
    jle     .Lread_done
    inc     r12
    mov     al, byte ptr [rsi]
    cmp     al, 10
    je      .Lread_done
    jmp     .Lread_loop
.Lread_done:

    /* Echo back. */
    test    r12, r12
    jz      .Lafter_echo
    mov     eax, 1
    mov     edi, 1
    lea     rsi, [rip + linebuf]
    mov     rdx, r12
    syscall
.Lafter_echo:

    /* mprotect(page_of(patch_site), 4096, PROT_READ|WRITE|EXEC) */
    lea     rdi, [rip + patch_site]
    and     rdi, -4096
    mov     esi, 4096
    mov     edx, 7
    mov     eax, 10
    syscall

    /* XOR-decode patch_site[0..8] in place against salt[0..8]. */
    lea     rdi, [rip + patch_site]
    lea     rsi, [rip + salt]
    mov     ecx, 8
.Lxor_loop:
    mov     al, byte ptr [rsi]
    xor     byte ptr [rdi], al
    inc     rsi
    inc     rdi
    dec     ecx
    jnz     .Lxor_loop

    /* Prepare register state for the (now decoded) patch site:
     *   rdi = &linebuf     (player-controlled bytes — pathname source)
     *   rsi = garbage      (player must zero with their patch)
     *   rdx = garbage      (player must zero with their patch)
     */
    lea     rdi, [rip + linebuf]
    movabs  rsi, 0x4141414141414141
    movabs  rdx, 0x4242424242424242

    /* The 8-byte patch site. File contents at this offset are
     *   31 ff b0 3c 0f 05 90 90    (xor edi,edi ; mov al,60 ; syscall ; nop nop)
     * After XOR with salt at runtime this becomes whatever the player
     * (and the salt) caused. With salt = 0 it remains a clean exit(0);
     * with a random salt and a correctly-encoded patch it becomes the
     * 8-byte execve shellcode. */
    .balign 8
    .global patch_site
patch_site:
    .byte 0x31, 0xff, 0xb0, 0x3c, 0x0f, 0x05, 0x90, 0x90
    .global patch_site_end
patch_site_end:

    /* Safety net: if a bad patch falls through, exit(1). */
    mov     eax, 60
    mov     edi, 1
    syscall
