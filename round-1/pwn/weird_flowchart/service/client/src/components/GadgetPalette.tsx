import { GADGETS, type GadgetDef } from "@ctf-rop/shared";

const CATEGORY_ORDER = ["load", "arith", "move", "mem", "libc"];
const CATEGORY_LABEL: Record<string, string> = {
  load: "Load / pop",
  arith: "Arithmetic",
  move: "Register moves",
  mem: "Memory",
  libc: "Library calls",
};

export function GadgetPalette({
  allowedGadgets,
}: {
  allowedGadgets?: string[] | null;
}) {
  const allow = allowedGadgets ? new Set(allowedGadgets) : null;
  const byCat = new Map<string, GadgetDef[]>();
  for (const g of GADGETS) {
    if (allow && !allow.has(g.id)) continue;
    const arr = byCat.get(g.category) ?? [];
    arr.push(g);
    byCat.set(g.category, arr);
  }
  return (
    <div className="palette">
      <h3>Drag to stack</h3>

      <h3>Value</h3>
      <div
        className="palette-item imm-item"
        draggable
        onDragStart={e => {
          e.dataTransfer.setData("application/rop-imm", "1");
          e.dataTransfer.effectAllowed = "move";
        }}
        title="a number on the stack that a pop gadget will read"
      >
        value (immediate)
        <small>wire this after a pop gadget — holds a hex/decimal number</small>
      </div>

      {CATEGORY_ORDER.map(cat => {
        const items = byCat.get(cat);
        if (!items) return null;
        return (
          <div key={cat}>
            <h3>{CATEGORY_LABEL[cat] ?? cat}</h3>
            {items.map(g => (
              <div
                key={g.id}
                className="palette-item"
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("application/ropgadget", g.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                title={g.description}
              >
                {g.mnemonic}
                <small>{g.description}</small>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
