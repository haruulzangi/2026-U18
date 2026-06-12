import type { Reg } from "./types.js";

export type GadgetKind = "pop" | "effect" | "libcall";

export type GadgetDef = {
  id: string;
  address: bigint;
  mnemonic: string;
  description: string;
  kind: GadgetKind;
  category: string;
  immediates: number;
  popsReg?: Reg;
  apply: (s: VmState) => void;
};

export type VmState = {
  regs: Record<Reg, bigint>;
  stack: bigint[];
  stackBaseAddr: bigint;
  mem: Map<string, number>;
  rodata: Map<string, number>;
  bssStart: bigint;
  bssEnd: bigint;
  output: string;
  stdin: string;
  stdinPos: number;
  halted: boolean;
  step: number;
  error?: string;
};

const MASK64 = (1n << 64n) - 1n;
export const HALT_ADDR = 0n;
const STACK_SIZE = 4096;

export const GADGETS: GadgetDef[] = [
  // pop REG; ret
  popGadget("pop_rdi", 0x400100n, "rdi"),
  popGadget("pop_rsi", 0x400108n, "rsi"),
  popGadget("pop_rdx", 0x400110n, "rdx"),
  popGadget("pop_rax", 0x400118n, "rax"),
  popGadget("pop_rbx", 0x400120n, "rbx"),
  popGadget("pop_rcx", 0x400128n, "rcx"),

  effectGadget("add_rax_rdi", 0x400200n, "add rax, rdi; ret",
    "rax = rax + rdi", "arith",
    s => { s.regs.rax = (s.regs.rax + s.regs.rdi) & MASK64; }),
  effectGadget("sub_rax_rdi", 0x400208n, "sub rax, rdi; ret",
    "rax = rax - rdi", "arith",
    s => { s.regs.rax = (s.regs.rax - s.regs.rdi) & MASK64; }),
  effectGadget("xor_rax_rdi", 0x400210n, "xor rax, rdi; ret",
    "rax = rax ^ rdi", "arith",
    s => { s.regs.rax = (s.regs.rax ^ s.regs.rdi) & MASK64; }),
  effectGadget("imul_rax_rdi", 0x400218n, "imul rax, rdi; ret",
    "rax = rax * rdi", "arith",
    s => { s.regs.rax = (s.regs.rax * s.regs.rdi) & MASK64; }),

  effectGadget("mov_rax_rdi", 0x400220n, "mov rax, rdi; ret",
    "rax = rdi", "move",
    s => { s.regs.rax = s.regs.rdi; }),
  effectGadget("mov_rdi_rax", 0x400228n, "mov rdi, rax; ret",
    "rdi = rax", "move",
    s => { s.regs.rdi = s.regs.rax; }),
  effectGadget("mov_rsi_rax", 0x400230n, "mov rsi, rax; ret",
    "rsi = rax", "move",
    s => { s.regs.rsi = s.regs.rax; }),
  effectGadget("mov_rax_rsi", 0x400238n, "mov rax, rsi; ret",
    "rax = rsi", "move",
    s => { s.regs.rax = s.regs.rsi; }),

  effectGadget("store_rdi_rsi", 0x400300n, "mov [rdi], rsi; ret",
    "memory[rdi..rdi+8] = rsi (little-endian 8 bytes)", "mem",
    s => {
      const addr = s.regs.rdi;
      if (addr < s.bssStart || addr + 8n > s.bssEnd) {
        s.halted = true;
        s.error = `mov [rdi], rsi: [0x${addr.toString(16)}..0x${(addr + 8n).toString(16)}) not writable (.bss is 0x${s.bssStart.toString(16)}..0x${s.bssEnd.toString(16)})`;
        return;
      }
      let v = s.regs.rsi;
      for (let i = 0; i < 8; i++) {
        s.mem.set((addr + BigInt(i)).toString(), Number(v & 0xffn));
        v >>= 8n;
      }
    }),
  effectGadget("load_rax_rdi", 0x400308n, "mov rax, [rdi]; ret",
    "rax = 8 bytes at memory[rdi..rdi+8] (little-endian)", "mem",
    s => {
      const base = s.regs.rdi;
      let v = 0n;
      for (let i = 0; i < 8; i++) {
        const key = (base + BigInt(i)).toString();
        const b = s.mem.get(key) ?? s.rodata.get(key);
        if (b === undefined) {
          s.halted = true;
          s.error = `mov rax, [rdi]: no byte at 0x${(base + BigInt(i)).toString(16)}`;
          return;
        }
        v |= BigInt(b) << BigInt(i * 8);
      }
      s.regs.rax = v;
    }),
  effectGadget("store_byte_rdi_sil", 0x400310n, "mov byte [rdi], sil; ret",
    "memory[rdi] = low byte of rsi (1 byte only)", "mem",
    s => {
      const addr = s.regs.rdi;
      if (addr < s.bssStart || addr >= s.bssEnd) {
        s.halted = true;
        s.error = `mov byte [rdi], sil: address 0x${addr.toString(16)} not writable`;
        return;
      }
      s.mem.set(addr.toString(), Number(s.regs.rsi & 0xffn));
    }),
  effectGadget("load_byte_rax_rdi", 0x400318n, "movzx rax, byte [rdi]; ret",
    "rax = 1 byte at memory[rdi], zero-extended", "mem",
    s => {
      const addr = s.regs.rdi;
      const b = s.mem.get(addr.toString()) ?? s.rodata.get(addr.toString());
      if (b === undefined) {
        s.halted = true;
        s.error = `movzx rax, byte [rdi]: no byte at 0x${addr.toString(16)}`;
        return;
      }
      s.regs.rax = BigInt(b);
    }),

  libcallGadget("call_puts", 0x401000n, "call puts",
    "prints null-terminated string at rdi",
    s => {
      let addr = s.regs.rdi;
      let out = "";
      for (let i = 0; i < 256; i++) {
        const b =
          s.rodata.get(addr.toString()) ?? s.mem.get(addr.toString());
        if (b === undefined || b === 0) break;
        out += String.fromCharCode(b);
        addr = (addr + 1n) & MASK64;
      }
      s.output += out + "\n";
    }),
  libcallGadget("call_print_int", 0x401008n, "call print_int",
    "prints signed rdi as decimal",
    s => {
      let v = s.regs.rdi;
      if (v >= 1n << 63n) v = v - (1n << 64n);
      s.output += v.toString() + "\n";
    }),
  libcallGadget("call_putchar", 0x401010n, "call putchar",
    "prints low byte of rdi as a character",
    s => {
      s.output += String.fromCharCode(Number(s.regs.rdi & 0xffn));
    }),

  libcallGadget("call_read_int", 0x401018n, "call read_int",
    "reads one integer line from stdin into rax (sign-extended)",
    s => {
      const r = parseStdinInt(s);
      if (!r.ok) {
        s.halted = true;
        s.error = `read_int: ${r.error}`;
        return;
      }
      s.regs.rax = r.value & MASK64;
    }),

  libcallGadget("call_read_char", 0x401020n, "call read_char",
    "reads one byte from stdin into rax, or -1 (0xff..ff) on EOF",
    s => {
      if (s.stdinPos >= s.stdin.length) {
        s.regs.rax = MASK64;
        return;
      }
      s.regs.rax = BigInt(s.stdin.charCodeAt(s.stdinPos)) & MASK64;
      s.stdinPos++;
    }),

  libcallGadget("call_scanf", 0x401030n, "call scanf",
    "format in rdi; %d args in rsi, rdx, rcx, r8, r9 (SysV order); returns count in rax",
    s => {
      const fmt = readCString(s, s.regs.rdi);
      if (fmt === null) {
        s.halted = true;
        s.error = `scanf: format pointer 0x${s.regs.rdi.toString(16)} is not readable`;
        return;
      }
      const argRegs: Reg[] = ["rsi", "rdx", "rcx", "r8", "r9"];
      let argIdx = 0;
      let matched = 0;
      const isWs = (c: string) =>
        c === " " || c === "\t" || c === "\n" || c === "\r";
      for (let i = 0; i < fmt.length; i++) {
        const c = fmt[i];
        if (c === "%") {
          if (i + 1 >= fmt.length) {
            s.halted = true;
            s.error = "scanf: trailing % with no conversion";
            return;
          }
          const code = fmt[++i];
          if (code === "%") {
            if (s.stdinPos >= s.stdin.length || s.stdin[s.stdinPos] !== "%") {
              s.halted = true;
              s.error = `scanf: expected literal % at stdin position ${s.stdinPos}`;
              return;
            }
            s.stdinPos++;
            continue;
          }
          if (code !== "d") {
            s.halted = true;
            s.error = `scanf: only %d is supported, got %${code}`;
            return;
          }
          if (argIdx >= argRegs.length) {
            s.halted = true;
            s.error = "scanf: too many %d (max 5 args: rsi, rdx, rcx, r8, r9)";
            return;
          }
          const parsed = parseStdinInt(s);
          if (!parsed.ok) {
            s.halted = true;
            s.error = `scanf: ${parsed.error}`;
            return;
          }
          const addr = s.regs[argRegs[argIdx]];
          if (addr < s.bssStart || addr + 8n > s.bssEnd) {
            s.halted = true;
            s.error = `scanf: target 0x${addr.toString(16)} (from ${argRegs[argIdx]}) is not a writable .bss address`;
            return;
          }
          let v = parsed.value;
          for (let j = 0; j < 8; j++) {
            s.mem.set((addr + BigInt(j)).toString(), Number(v & 0xffn));
            v >>= 8n;
          }
          argIdx++;
          matched++;
        } else if (isWs(c)) {
          while (s.stdinPos < s.stdin.length && isWs(s.stdin[s.stdinPos])) s.stdinPos++;
        } else {
          if (s.stdinPos >= s.stdin.length || s.stdin[s.stdinPos] !== c) {
            s.halted = true;
            s.error = `scanf: expected literal ${JSON.stringify(c)} at stdin position ${s.stdinPos}`;
            return;
          }
          s.stdinPos++;
        }
      }
      s.regs.rax = BigInt(matched);
    }),

  libcallGadget("call_printf", 0x401038n, "call printf",
    "format string at rdi, one arg in rsi; supports %d, %s, %%",
    s => {
      const fmt = readCString(s, s.regs.rdi);
      if (fmt === null) {
        s.halted = true;
        s.error = `printf: format pointer 0x${s.regs.rdi.toString(16)} is not readable`;
        return;
      }
      let out = "";
      let argUsed = false;
      for (let i = 0; i < fmt.length; i++) {
        const c = fmt[i];
        if (c !== "%") { out += c; continue; }
        if (i + 1 >= fmt.length) {
          s.halted = true;
          s.error = "printf: trailing % with no conversion";
          return;
        }
        const code = fmt[++i];
        if (code === "%") { out += "%"; continue; }
        if (argUsed) {
          s.halted = true;
          s.error = "printf: only one argument (rsi) supported per call";
          return;
        }
        if (code === "d") {
          let v = s.regs.rsi;
          if (v >= 1n << 63n) v -= 1n << 64n;
          out += v.toString();
        } else if (code === "s") {
          const str = readCString(s, s.regs.rsi);
          if (str === null) {
            s.halted = true;
            s.error = `printf: %s pointer 0x${s.regs.rsi.toString(16)} is not readable`;
            return;
          }
          out += str;
        } else if (code === "c") {
          out += String.fromCharCode(Number(s.regs.rsi & 0xffn));
        } else {
          s.halted = true;
          s.error = `printf: unsupported conversion %${code}`;
          return;
        }
        argUsed = true;
      }
      s.output += out;
      s.regs.rax = BigInt(out.length);
    }),

  libcallGadget("call_gets", 0x401028n, "call gets",
    "reads a line from stdin into .bss buffer at rdi, null-terminates, length → rax",
    s => {
      const base = s.regs.rdi;
      if (base < s.bssStart || base >= s.bssEnd) {
        s.halted = true;
        s.error = `gets: buffer at 0x${base.toString(16)} is not in .bss`;
        return;
      }
      let len = 0;
      while (s.stdinPos < s.stdin.length) {
        const ch = s.stdin.charCodeAt(s.stdinPos);
        s.stdinPos++;
        if (ch === 10) break; // \n — consume but do not store
        if (ch === 13) continue; // \r — skip
        if (base + BigInt(len) + 1n >= s.bssEnd) {
          s.halted = true;
          s.error = `gets: buffer overflowed .bss at 0x${(base + BigInt(len)).toString(16)}`;
          return;
        }
        s.mem.set((base + BigInt(len)).toString(), ch);
        len++;
      }
      s.mem.set((base + BigInt(len)).toString(), 0);
      s.regs.rax = BigInt(len);
    }),
];

export const GADGET_BY_ID: Record<string, GadgetDef> = Object.fromEntries(
  GADGETS.map(g => [g.id, g]),
);

export const GADGET_BY_ADDR: Map<string, GadgetDef> = new Map(
  GADGETS.map(g => [g.address.toString(), g]),
);

function popGadget(id: string, addr: bigint, reg: Reg): GadgetDef {
  return {
    id,
    address: addr,
    mnemonic: `pop ${reg}; ret`,
    description: `pop a value off the stack into ${reg}`,
    kind: "pop",
    category: "load",
    immediates: 1,
    popsReg: reg,
    apply: s => {
      s.regs[reg] = popQword(s);
    },
  };
}

function effectGadget(
  id: string,
  addr: bigint,
  mnemonic: string,
  description: string,
  category: string,
  fn: (s: VmState) => void,
): GadgetDef {
  return { id, address: addr, mnemonic, description, kind: "effect", category, immediates: 0, apply: fn };
}

function libcallGadget(
  id: string,
  addr: bigint,
  mnemonic: string,
  description: string,
  fn: (s: VmState) => void,
): GadgetDef {
  return { id, address: addr, mnemonic, description, kind: "libcall", category: "libc", immediates: 0, apply: fn };
}

export function popQword(s: VmState): bigint {
  const idx = Number(s.regs.rsp - s.stackBaseAddr) / 8;
  if (!Number.isInteger(idx) || idx < 0 || idx >= s.stack.length) {
    s.halted = true;
    s.error = `stack underflow at rsp=0x${s.regs.rsp.toString(16)}`;
    return 0n;
  }
  const v = s.stack[idx];
  s.regs.rsp = (s.regs.rsp + 8n) & MASK64;
  return v;
}

export function newStack(sizeQwords: number = STACK_SIZE / 8): bigint[] {
  return new Array(sizeQwords).fill(0n);
}

function readCString(s: VmState, addr: bigint, max: number = 256): string | null {
  let out = "";
  for (let i = 0; i < max; i++) {
    const key = (addr + BigInt(i)).toString();
    const b = s.rodata.get(key) ?? s.mem.get(key);
    if (b === undefined) return null;
    if (b === 0) return out;
    out += String.fromCharCode(b);
  }
  return out;
}

function parseStdinInt(
  s: VmState,
): { ok: true; value: bigint } | { ok: false; error: string } {
  let i = s.stdinPos;
  while (i < s.stdin.length && (s.stdin[i] === " " || s.stdin[i] === "\n" || s.stdin[i] === "\r" || s.stdin[i] === "\t")) i++;
  const start = i;
  if (i < s.stdin.length && (s.stdin[i] === "-" || s.stdin[i] === "+")) i++;
  const digitStart = i;
  while (i < s.stdin.length && s.stdin[i] >= "0" && s.stdin[i] <= "9") i++;
  if (i === digitStart) {
    return { ok: false, error: `stdin exhausted or no digits at position ${start}` };
  }
  const text = s.stdin.slice(start, i);
  let v: bigint;
  try {
    v = BigInt(text);
  } catch {
    return { ok: false, error: `"${text}" is not a valid integer` };
  }
  if (i < s.stdin.length && s.stdin[i] === "\r") i++;
  if (i < s.stdin.length && s.stdin[i] === "\n") i++;
  s.stdinPos = i;
  return { ok: true, value: v };
}
