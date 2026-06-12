# Weird Flowchart

A visual, kid-friendly introduction to **Return-Oriented Programming (ROP)** —
a flowchart editor where the "blocks" happen to be x86-64 gadgets and the
"flow" happens to be a real ROP chain.

Drag x86-64 gadgets from the palette and **snap them together like puzzle
pieces** under the START block — each gadget's tab fits into the next one's
notch. Every block in the stack is a qword on the fake CPU's stack; every
`ret` pops the next block into `rip`. Hit Run and watch registers, stack,
memory, and stdout update live. Solve a challenge, get a flag.

---

## Contents

- [Quick start](#quick-start)
- [Two modes](#two-modes)
- [The VM](#the-vm)
- [Gadget catalog](#gadget-catalog)
- [Memory map](#memory-map)
- [Authoring challenges](#authoring-challenges)
- [Adding new gadgets](#adding-new-gadgets)
- [Development](#development)
- [Architecture](#architecture)

---

## Quick start

```bash
docker compose up -d --build
# open http://localhost:8080
```

Stop with `docker compose down`. Change the port with `HTTP_PORT=9090 docker compose up -d`.

---

## Two modes

**Playground** — sandbox. Every gadget is available. Stack blocks in any
order, type into the stdin console, Run or Step. Nothing is checked.

**Challenge** — a specific problem statement, often with a restricted gadget
set. When the chain produces the exact expected output, the backend returns
the flag. Flags live server-side and are never shipped to the browser.

### Building a chain

1. **Drag a gadget from the palette** onto any drop-zone slot between blocks.
   It snaps in and the drop zones re-render around it.
2. **After a `pop` gadget**, drop a **value block** underneath. The value
   block's hex/decimal input is the number `pop` will read. Pops without a
   value block show a warning and refuse to run.
3. **Reorder** with the ▲ ▼ arrows on each block. **Delete** with `×`.
4. **Hit Run** — registers/stack/memory update, stdout appears in the Console
   panel. **Step** to advance one gadget at a time.

---

## The VM

A small x86-64 subset. Every gadget ends in `ret`, so the chain is a sequence
of qwords on a fake stack and execution flows by `ret`-ing to the next one.

**Registers (all 64-bit):**
`rax rbx rcx rdx rsi rdi rbp rsp rip r8 r9 r10 r11 r12 r13 r14 r15`

**Execution:** `rip` holds the next gadget's address. Running one gadget
applies its effect, then pops 8 bytes from `[rsp]` into `rip`. A `ret` to
address `0x0` halts the program cleanly.

---

## Gadget catalog

| ID | Mnemonic | Effect |
|---|---|---|
| `pop_rdi` | `pop rdi; ret` | pop stack qword into `rdi` |
| `pop_rsi` | `pop rsi; ret` | pop stack qword into `rsi` |
| `pop_rdx` | `pop rdx; ret` | pop stack qword into `rdx` |
| `pop_rax` | `pop rax; ret` | pop stack qword into `rax` |
| `pop_rbx` | `pop rbx; ret` | pop stack qword into `rbx` |
| `pop_rcx` | `pop rcx; ret` | pop stack qword into `rcx` |
| `add_rax_rdi` | `add rax, rdi; ret` | `rax = rax + rdi` |
| `sub_rax_rdi` | `sub rax, rdi; ret` | `rax = rax - rdi` |
| `xor_rax_rdi` | `xor rax, rdi; ret` | `rax = rax ^ rdi` |
| `imul_rax_rdi` | `imul rax, rdi; ret` | `rax = rax * rdi` |
| `mov_rax_rdi` | `mov rax, rdi; ret` | `rax = rdi` |
| `mov_rdi_rax` | `mov rdi, rax; ret` | `rdi = rax` |
| `mov_rsi_rax` | `mov rsi, rax; ret` | `rsi = rax` |
| `mov_rax_rsi` | `mov rax, rsi; ret` | `rax = rsi` |
| `store_rdi_rsi` | `mov [rdi], rsi; ret` | `[rdi..rdi+8) = rsi` (little-endian 8 bytes) |
| `load_rax_rdi` | `mov rax, [rdi]; ret` | `rax = qword at [rdi..rdi+8)` |
| `store_byte_rdi_sil` | `mov byte [rdi], sil; ret` | `[rdi] = low byte of rsi` |
| `load_byte_rax_rdi` | `movzx rax, byte [rdi]; ret` | `rax = byte at [rdi]`, zero-extended |
| `call_puts` | `call puts` | print null-terminated string at `rdi`, add `\n` |
| `call_print_int` | `call print_int` | print signed `rdi` as decimal + `\n` |
| `call_putchar` | `call putchar` | print low byte of `rdi` as a character |
| `call_read_int` | `call read_int` | parse int from stdin → `rax` |
| `call_read_char` | `call read_char` | next byte of stdin → `rax` (`-1` on EOF) |
| `call_gets` | `call gets` | read line from stdin into `.bss` at `rdi`, length → `rax` |
| `call_scanf` | `call scanf` | format string at `rdi`, dest pointer at `rsi`; only `"%d"` supported |
| `call_printf` | `call printf` | format string at `rdi`, one arg in `rsi`; supports `%d`, `%s`, `%c`, `%%` |

---

## Memory map

The VM has three regions:

| Region | Range | Access | Purpose |
|---|---|---|---|
| `.rodata` | `0x402000`+ | read-only | strings from `initState.rodata` |
| `.bss` | `0x403000` – `0x4031FF` (512 bytes) | read/write | scratch space, writable with the store gadgets |
| stack | `0x7ffffffe0000`+ (4 KiB) | ROP chain | each `ret` pops 8 bytes; `rip = 0x0` halts |

The **Memory Map** panel on the right shows all three, lists the live
`.rodata` strings and any bytes written to `.bss`, and reminds kids which
gadgets read/write each region.

---

## Authoring challenges

Every challenge is **one JSON file** dropped into
[`server/src/challenges/`](server/src/challenges/). No code changes, no
restart — the loader re-reads the directory on each `GET /api/challenges`.

**Filename convention:** `NN-slug.json` — the `NN` controls order in the
dropdown. Copy `_TEMPLATE.json.example` to start.

### Schema

```jsonc
{
  "id":              "unique_snake_case",    // stable ID used by /api/submit
  "title":           "Display name",         // shown in dropdown
  "prompt":          "Multi-line prompt...", // shown to the kid, \n for breaks

  "initState": {
    "registers": { "rdi": "7", "rax": "0x2A" },  // optional starting values
    "rodata":    { "0x402000": "HELLO" },        // optional strings (auto-null-terminated)
    "stdin":     "line1\nline2\n"                // optional stdin buffer
  },

  "expectedOutput": "exact stdout, including final \\n",
  "flag":           "flag{your_flag}",

  "stepBudget":     1000,            // optional, default 10000

  "allowedGadgets": ["pop_rdi", "call_puts"]  // optional — omit to expose all gadgets
}
```

### `allowedGadgets`

When set, the client palette filters to just those gadget IDs, and the server
rejects any submission that uses a gadget outside the list (with a clear
error message). This lets you design a puzzle that funnels the student
toward a specific technique.

Omit the field entirely to expose every gadget — useful for open-ended
puzzles. The **value (immediate)** block is always available regardless.

Valid IDs are the first column of the [Gadget catalog](#gadget-catalog).

### Reference solution (informal)

Keep a reference solution in your head (or in a private file). The tool
judges on output equality, not on chain shape — multiple solutions may be
accepted. This is usually fine for kids; restrict `allowedGadgets` if you
need to force a particular approach.

### Example: hello

`server/src/challenges/01-hello.json`:

```json
{
  "id": "hello",
  "title": "Hello, ROP",
  "prompt": "Print HELLO using pop rdi → [0x402000] → call puts.",
  "initState": { "rodata": { "0x402000": "HELLO" } },
  "expectedOutput": "HELLO\n",
  "flag": "flag{welcome_to_rop_land}",
  "stepBudget": 1000,
  "allowedGadgets": ["pop_rdi", "call_puts"]
}
```

Drop the file in, refresh the browser, and the new challenge appears in the
dropdown. That's it.

---

## Adding new gadgets

Edit `shared/src/gadgets.ts`:

```ts
effectGadget("shl_rax_1", 0x400240n, "shl rax, 1; ret",
  "rax <<= 1", "arith",
  s => { s.regs.rax = (s.regs.rax << 1n) & ((1n << 64n) - 1n); }),
```

- Pick an unused address in the `0x400___` range.
- Category `"load" | "arith" | "move" | "mem" | "libc"` controls the palette
  grouping.
- `immediates: 1` on a pop-style gadget makes the chain linearizer require
  a `value` block after it on the canvas.

Rebuild: `docker compose build --no-cache && docker compose up -d`.

---

## Development

```bash
npm install
npm run dev              # client :5173, server :5174, vite proxies /api
npm run typecheck        # all three workspaces
npm run build            # production client build
```

Layout:

```
shared/    VM, gadgets, chain linearizer (imported by both client and server)
server/    Express + judge + per-challenge JSON files
client/    Vite + React + ReactFlow SPA
e2e/       Puppeteer smoke tests
```

### UI tests

```bash
# stack must be running on :8080
cd e2e && node ui-test.mjs
```

Checks page structure, palette, mode switch, drag/drop, submit + flag,
disallowed-gadget rejection, and Memory Map content.

---

## Architecture

**Shared VM.** The same TypeScript VM runs in the browser (for the live
Playground/Step experience) and in the server (for authoritative challenge
judging). No drift between the two environments — running a chain in the
Playground is identical to submitting it.

**Flag gating.** Flags live only in the challenge JSON files inside the
`server` container image. The `/api/challenges` response strips the `flag`
field; `/api/submit` returns it only on an exact `expectedOutput` match.

**Rate limiting.** `POST /api/submit` is limited to 5 requests / 10 seconds
per IP, enough to stop casual brute-forcing of the flag by output-matching.

**Stack → ROP chain.** The UI is a simple ordered list of blocks. The
linearizer emits each gadget's address onto a fake stack; for pop gadgets,
the *next* block must be a value block and its value is pushed as the qword
the pop will read. The chain ends with a halt sentinel (`0x0`). The VM's
execution loop pops each qword as the next `rip`, exactly as a real ROP
chain would. (The server still accepts the general DAG-shaped `Flowchart`
format — the block stack just emits a linear one.)
