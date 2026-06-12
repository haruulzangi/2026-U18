import type { Snapshot } from "@ctf-rop/shared";

export function StackView({ snap }: { snap: Snapshot | null }) {
  if (!snap) {
    return (
      <div className="panel-section">
        <h3>Stack</h3>
        <div className="stack-list" style={{ color: "var(--muted)" }}>
          (run or step to populate)
        </div>
      </div>
    );
  }
  const rsp = BigInt(snap.registers.rsp);
  const base = BigInt(snap.stackBase);
  const rspIdx = Number(rsp - base) / 8;

  // show a window around rsp
  const start = Math.max(0, Math.floor(rspIdx) - 2);
  const end = Math.min(snap.stack.length, start + 14);

  return (
    <div className="panel-section">
      <h3>Stack (top = next to pop)</h3>
      <div className="stack-list">
        {Array.from({ length: end - start }, (_, i) => {
          const idx = start + i;
          const addr = base + BigInt(idx) * 8n;
          const cur = idx === rspIdx;
          return (
            <div
              key={idx}
              className={`stack-row${cur ? " current" : ""}`}
            >
              <span className="saddr">
                0x{addr.toString(16)}
                {cur ? " ←rsp" : ""}
              </span>
              <span>{snap.stack[idx]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
