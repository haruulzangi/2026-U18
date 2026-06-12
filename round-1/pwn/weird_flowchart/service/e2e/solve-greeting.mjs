// Canonical solution for the "greeting" challenge.
// Builds "Hello, %s!\n\0" across two qword stores, then gets + printf.

const FMT_ADDR = 0x403000n;
const NAME_ADDR = 0x403100n;

// "Hello, %" (bytes 0-7) packed little-endian:
//   0x25 0x20 0x2c 0x6f 0x6c 0x6c 0x65 0x48 (high→low)
const QWORD1 = 0x25202c6f6c6c6548n;
// "s!\n\0\0\0\0\0" (bytes 8-15):
//   0x73 0x21 0x0a 0x00 0x00 0x00 0x00 0x00 → 0xa2173
const QWORD2 = 0xa2173n;

const nodes = [];
const edges = [];
let last = null;
let uid = 0;
const g = id => { const n = `n${++uid}`; nodes.push({ id: n, kind: "gadget", gadgetId: id }); if (last) edges.push({ from: last, to: n }); last = n; };
const v = val => { const n = `v${++uid}`; nodes.push({ id: n, kind: "imm", value: "0x" + val.toString(16) }); if (last) edges.push({ from: last, to: n }); last = n; };

// store QWORD1 at FMT_ADDR
g("pop_rdi"); v(FMT_ADDR);
g("pop_rsi"); v(QWORD1);
g("store_rdi_rsi");
// store QWORD2 at FMT_ADDR + 8
g("pop_rdi"); v(FMT_ADDR + 8n);
g("pop_rsi"); v(QWORD2);
g("store_rdi_rsi");
// gets(NAME_ADDR)
g("pop_rdi"); v(NAME_ADDR);
g("call_gets");
// printf(FMT_ADDR, NAME_ADDR)
g("pop_rdi"); v(FMT_ADDR);
g("pop_rsi"); v(NAME_ADDR);
g("call_printf");

const flowchart = { startNodeId: nodes[0].id, nodes, edges };
const body = JSON.stringify({ challengeId: "greeting", flowchart });
const r = await fetch("http://localhost:8080/api/submit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});
const j = await r.json();
console.log(`chain length: ${nodes.length} blocks`);
console.log("response:", j);
if (!j.correct) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
