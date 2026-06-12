import { GADGET_BY_ADDR, HALT_ADDR, newStack, popQword, type VmState } from "./gadgets.js";
import { REGS, type InitState, type Reg, type Snapshot } from "./types.js";

export const STACK_BASE = 0x7ffffffe0000n;
export const RODATA_BASE = 0x402000n;
export const BSS_BASE = 0x403000n;
export const BSS_SIZE = 0x200n;

export type LoadedChain = {
  initialStack: bigint[];
  initialRsp: bigint;
};

export function createState(
  init: InitState,
  chain: LoadedChain,
): VmState {
  const regs: Record<Reg, bigint> = Object.fromEntries(
    REGS.map(r => [r, 0n]),
  ) as Record<Reg, bigint>;
  if (init.registers) {
    for (const [r, v] of Object.entries(init.registers)) {
      if (v !== undefined) regs[r as Reg] = parseBig(v);
    }
  }
  regs.rsp = chain.initialRsp;
  // "ret into" the first chain entry: read the first qword as the entry rip,
  // then advance rsp past it.
  const entryIdx = Number(regs.rsp - STACK_BASE) / 8;
  regs.rip = chain.initialStack[entryIdx] ?? 0n;
  regs.rsp = (regs.rsp + 8n) & ((1n << 64n) - 1n);

  const rodata = new Map<string, number>();
  if (init.rodata) {
    for (const [addrStr, str] of Object.entries(init.rodata)) {
      const base = parseBig(addrStr);
      for (let i = 0; i < str.length; i++) {
        rodata.set((base + BigInt(i)).toString(), str.charCodeAt(i));
      }
      rodata.set((base + BigInt(str.length)).toString(), 0);
    }
  }

  const mem = new Map<string, number>();
  if (init.bssQwords) {
    const mask = (1n << 64n) - 1n;
    for (const [addrStr, valStr] of Object.entries(init.bssQwords)) {
      const addr = parseBig(addrStr);
      let v = parseBig(valStr) & mask;
      for (let i = 0; i < 8; i++) {
        mem.set((addr + BigInt(i)).toString(), Number(v & 0xffn));
        v >>= 8n;
      }
    }
  }

  return {
    regs,
    stack: chain.initialStack,
    stackBaseAddr: STACK_BASE,
    mem,
    rodata,
    bssStart: BSS_BASE,
    bssEnd: BSS_BASE + BSS_SIZE,
    output: "",
    stdin: init.stdin ?? "",
    stdinPos: 0,
    halted: false,
    step: 0,
  };
}

export function stepOnce(s: VmState): void {
  if (s.halted) return;
  const gadget = GADGET_BY_ADDR.get(s.regs.rip.toString());
  if (!gadget) {
    s.halted = true;
    s.error = `no gadget at rip=0x${s.regs.rip.toString(16)}`;
    return;
  }
  gadget.apply(s);
  s.step++;
  if (s.halted) return;
  const next = popQword(s);
  if (s.halted) return;
  if (next === HALT_ADDR) {
    s.halted = true;
    return;
  }
  s.regs.rip = next;
}

export function runToEnd(s: VmState, budget: number = 10_000): void {
  while (!s.halted && s.step < budget) stepOnce(s);
  if (!s.halted) {
    s.halted = true;
    s.error = `step budget exceeded (${budget})`;
  }
}

export function snapshot(s: VmState): Snapshot {
  const registers: Record<Reg, string> = Object.fromEntries(
    REGS.map(r => [r, "0x" + s.regs[r].toString(16)]),
  ) as Record<Reg, string>;
  const bssBytes: Record<string, number> = {};
  for (const [k, v] of s.mem.entries()) {
    const addr = BigInt(k);
    if (addr >= s.bssStart && addr < s.bssEnd) {
      bssBytes["0x" + addr.toString(16)] = v;
    }
  }
  const rodataBytes: Record<string, number> = {};
  for (const [k, v] of s.rodata.entries()) {
    rodataBytes["0x" + BigInt(k).toString(16)] = v;
  }
  return {
    step: s.step,
    registers,
    stack: s.stack.map(q => "0x" + q.toString(16)),
    stackBase: "0x" + s.stackBaseAddr.toString(16),
    output: s.output,
    currentGadgetAddr: s.halted ? null : "0x" + s.regs.rip.toString(16),
    halted: s.halted,
    error: s.error,
    memory: {
      bssStart: "0x" + s.bssStart.toString(16),
      bssEnd: "0x" + s.bssEnd.toString(16),
      stackBase: "0x" + s.stackBaseAddr.toString(16),
      bssBytes,
      rodataBytes,
    },
    stdin: {
      buffer: s.stdin,
      cursor: s.stdinPos,
    },
  };
}

export function previewMemory(init: InitState): import("./types.js").MemoryRegions {
  const rodataBytes: Record<string, number> = {};
  if (init.rodata) {
    for (const [addrStr, str] of Object.entries(init.rodata)) {
      const base = parseBig(addrStr);
      for (let i = 0; i < str.length; i++) {
        rodataBytes["0x" + (base + BigInt(i)).toString(16)] = str.charCodeAt(i);
      }
      rodataBytes["0x" + (base + BigInt(str.length)).toString(16)] = 0;
    }
  }
  const bssBytes: Record<string, number> = {};
  if (init.bssQwords) {
    const mask = (1n << 64n) - 1n;
    for (const [addrStr, valStr] of Object.entries(init.bssQwords)) {
      const addr = parseBig(addrStr);
      let v = parseBig(valStr) & mask;
      for (let i = 0; i < 8; i++) {
        bssBytes["0x" + (addr + BigInt(i)).toString(16)] = Number(v & 0xffn);
        v >>= 8n;
      }
    }
  }
  return {
    bssStart: "0x" + BSS_BASE.toString(16),
    bssEnd: "0x" + (BSS_BASE + BSS_SIZE).toString(16),
    stackBase: "0x" + STACK_BASE.toString(16),
    bssBytes,
    rodataBytes,
  };
}

export function parseBig(v: string | number | bigint): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  const s = v.trim();
  if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
  if (s.startsWith("-")) return BigInt(s) & ((1n << 64n) - 1n);
  return BigInt(s);
}

export { newStack };
