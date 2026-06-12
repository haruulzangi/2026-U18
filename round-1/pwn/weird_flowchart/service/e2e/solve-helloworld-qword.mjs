// Cleverer solution for hello_world_noconst: use the new qword store.
// Build "Hello World!\0..." in 2 qwords by XORing two SAFE operands.
//
//   Target bytes 0..7  = "Hello Wo"  = 48 65 6c 6c 6f 20 57 6f
//   Target bytes 8..15 = "rld!\0\0\0\0" = 72 6c 64 21 00 00 00 00
//
// Using mask 0x60 per byte (safe — not in banned list):
//   A1[i] = target1[i] XOR 0x60 → all bytes safe
//   A2[i] = target2[i] XOR 0x60 → all bytes safe
//
// Banned bytes: 20, 21, 48, 57, 64, 65, 6c, 6f, 72.

const BANNED = new Set([0x20, 0x21, 0x48, 0x57, 0x64, 0x65, 0x6c, 0x6f, 0x72]);
const MASK = 0x6060606060606060n;
function packLE(bytes) { let v = 0n; for (let i = 0; i < 8; i++) v |= BigInt(bytes[i] ?? 0) << BigInt(i * 8); return v; }
function bytesOf(v) { const out = []; for (let i = 0; i < 8; i++) out.push(Number((BigInt(v) >> BigInt(i * 8)) & 0xffn)); return out; }

const t1 = packLE([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f]); // "Hello Wo"
const t2 = packLE([0x72, 0x6c, 0x64, 0x21, 0, 0, 0, 0]);             // "rld!\0\0\0\0"

const A1 = t1 ^ MASK;
const A2 = t2 ^ MASK;

// Sanity: A1, A2, MASK must all have every byte outside the banned set.
for (const [name, v] of [["A1", A1], ["A2", A2], ["MASK", MASK]]) {
  for (const b of bytesOf(v)) {
    if (BANNED.has(b)) throw new Error(`${name} has banned byte 0x${b.toString(16)}`);
  }
}
// .bss addresses also must be safe.
for (const a of [0x403000, 0x403008]) {
  for (const b of bytesOf(BigInt(a))) {
    if (BANNED.has(b)) throw new Error(`addr 0x${a.toString(16)} uses banned byte 0x${b.toString(16)}`);
  }
}

const nodes = []; const edges = []; let last = null; let uid = 0;
const g = id => { const n = `n${++uid}`; nodes.push({ id: n, kind: "gadget", gadgetId: id }); if (last) edges.push({ from: last, to: n }); last = n; };
const v = val => { const n = `v${++uid}`; nodes.push({ id: n, kind: "imm", value: typeof val === "bigint" ? "0x" + val.toString(16) : val }); if (last) edges.push({ from: last, to: n }); last = n; };

// First 8 bytes at 0x403000
g("pop_rax"); v(A1);
g("pop_rdi"); v(MASK);
g("xor_rax_rdi");
g("mov_rsi_rax");
g("pop_rdi"); v("0x403000");
g("store_rdi_rsi");

// Second 8 bytes at 0x403008
g("pop_rax"); v(A2);
g("pop_rdi"); v(MASK);
g("xor_rax_rdi");
g("mov_rsi_rax");
g("pop_rdi"); v("0x403008");
g("store_rdi_rsi");

// puts(0x403000)
g("pop_rdi"); v("0x403000");
g("call_puts");

const flowchart = { startNodeId: nodes[0].id, nodes, edges };
const r = await fetch("http://localhost:8080/api/submit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ challengeId: "hello_world_noconst", flowchart }),
});
const j = await r.json();
console.log(`chain length: ${nodes.length} blocks`);
console.log("response:", j);
if (!j.correct) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
