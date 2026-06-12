// Build and submit a valid solution for the "hello_world_noconst" challenge.
// Each character of "Hello World!" is computed as base +/- offset where the
// base (0x50 = 'P') and every offset avoid the banned byte set.

const TARGET = "Hello World!";
const BASE = 0x50;

// op: "add" | "sub" ; delta: value to add/sub with BASE to produce char
const plan = Array.from(TARGET).map((ch, i) => {
  const c = ch.charCodeAt(0);
  if (c > BASE) return { i, op: "add", delta: c - BASE };
  if (c === BASE) return { i, op: "add", delta: 0 };
  return { i, op: "sub", delta: BASE - c };
});

const BANNED = new Set([0x20, 0x21, 0x48, 0x57, 0x64, 0x65, 0x6c, 0x6f, 0x72]);
function bytesOf(v) {
  const out = [];
  let x = BigInt(v);
  for (let i = 0; i < 8; i++) {
    out.push(Number(x & 0xffn));
    x >>= 8n;
  }
  return out;
}
function verifySafe(v, label) {
  for (const b of bytesOf(v)) {
    if (BANNED.has(b)) throw new Error(`${label}=${v} uses banned byte 0x${b.toString(16)}`);
  }
}
verifySafe(BASE, "BASE");
for (const { delta } of plan) verifySafe(delta, "delta");
for (let i = 0; i < TARGET.length; i++) verifySafe(0x403000 + i, `dest[${i}]`);

const nodes = [];
const edges = [];
let lastId = null;
let uid = 0;
function add(kind, data) {
  const id = `n${++uid}`;
  if (kind === "g") nodes.push({ id, kind: "gadget", gadgetId: data });
  else nodes.push({ id, kind: "imm", value: data });
  if (lastId) edges.push({ from: lastId, to: id });
  lastId = id;
}

for (const { i, op, delta } of plan) {
  add("g", "pop_rax");
  add("v", "0x" + BASE.toString(16));
  add("g", "pop_rdi");
  add("v", "0x" + delta.toString(16));
  add("g", op === "add" ? "add_rax_rdi" : "sub_rax_rdi");
  add("g", "mov_rsi_rax");
  add("g", "pop_rdi");
  add("v", "0x" + (0x403000 + i).toString(16));
  add("g", "store_byte_rdi_sil");
}
// Final: puts the buffer
add("g", "pop_rdi");
add("v", "0x403000");
add("g", "call_puts");

const flowchart = { startNodeId: nodes[0].id, nodes, edges };

const body = JSON.stringify({ challengeId: "hello_world_noconst", flowchart });
const r = await fetch("http://localhost:8080/api/submit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});
const j = await r.json();
console.log(`chain length: ${nodes.length} blocks`);
console.log(`response:`, j);
if (!j.correct) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS");
