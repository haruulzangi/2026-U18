// Canonical solution using scanf("%d %d", &a, &b).
// Layout in .bss:
//   0x403000  "true\0\0\0\0"
//   0x403010  a (qword)
//   0x403018  b (qword)
//   0x403020  "%d %d\0..."

const nodes = [];
const edges = [];
let last = null;
let uid = 0;
const g = id => { const n = `n${++uid}`; nodes.push({ id: n, kind: "gadget", gadgetId: id }); if (last) edges.push({ from: last, to: n }); last = n; };
const v = val => { const n = `v${++uid}`; nodes.push({ id: n, kind: "imm", value: val }); if (last) edges.push({ from: last, to: n }); last = n; };

// Build "true\0..." at 0x403000.
g("pop_rdi"); v("0x403000");
g("pop_rsi"); v("0x65757274");
g("store_rdi_rsi");

// Build "%d %d\0..." at 0x403020.
g("pop_rdi"); v("0x403020");
g("pop_rsi"); v("0x6425206425");
g("store_rdi_rsi");

// scanf("%d %d", &a=0x403010, &b=0x403018)
g("pop_rdi"); v("0x403020");
g("pop_rsi"); v("0x403010");
g("pop_rdx"); v("0x403018");
g("call_scanf");

// Load a, stash in rsi.
g("pop_rdi"); v("0x403010");
g("load_rax_rdi");
g("mov_rsi_rax");

// Load b, move to rdi.
g("pop_rdi"); v("0x403018");
g("load_rax_rdi");
g("mov_rdi_rax");

// rax = a (from rsi), rax -= rdi (b).
g("mov_rax_rsi");
g("sub_rax_rdi");

// Pointer = 0x403000 + diff, puts.
g("pop_rdi"); v("0x403000");
g("add_rax_rdi");
g("mov_rdi_rax");
g("call_puts");

const flowchart = { startNodeId: nodes[0].id, nodes, edges };
const r = await fetch("http://localhost:8080/api/submit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ challengeId: "isEqual", flowchart }),
});
const j = await r.json();
console.log(`chain length: ${nodes.length} blocks`);
console.log("response:", j);
if (!j.correct) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
