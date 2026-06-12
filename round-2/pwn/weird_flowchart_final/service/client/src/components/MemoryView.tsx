import type { MemoryRegions } from "@ctf-rop/shared";

export function MemoryView({ mem }: { mem: MemoryRegions }) {
  const rodataStrings = groupStrings(mem.rodataBytes);
  const bssStrings = groupStrings(mem.bssBytes);
  const bssStart = BigInt(mem.bssStart);
  const bssEnd = BigInt(mem.bssEnd);
  const bssSize = Number(bssEnd - bssStart);

  return (
    <div className="panel-section">
      <h3>Memory Map</h3>

      <div className="mem-region">
        <div className="mem-title">
          <span className="mem-tag ro">.rodata</span>
          <span className="mem-sub">read-only · strings</span>
        </div>
        {rodataStrings.length === 0 ? (
          <div className="mem-empty">(nothing loaded)</div>
        ) : (
          rodataStrings.map(s => (
            <div key={s.addr} className="mem-row">
              <span className="mem-addr">{s.addr}</span>
              <span className="mem-val">{JSON.stringify(s.text)}</span>
            </div>
          ))
        )}
        <div className="mem-hint">
          read 8 bytes with <code>mov rax, [rdi]</code> · or 1 byte with{" "}
          <code>movzx rax, byte [rdi]</code>
        </div>
      </div>

      <div className="mem-region">
        <div className="mem-title">
          <span className="mem-tag rw">.bss</span>
          <span className="mem-sub">
            read/write · {mem.bssStart}–{mem.bssEnd} ({bssSize} bytes)
          </span>
        </div>
        {Object.keys(mem.bssBytes).length === 0 ? (
          <div className="mem-empty">(empty — nothing written yet)</div>
        ) : (
          bssStrings.map(s => (
            <div key={s.addr} className="mem-row">
              <span className="mem-addr">{s.addr}</span>
              <span className="mem-val">
                {JSON.stringify(s.text)}{" "}
                <span className="mem-sub">
                  [
                  {s.bytes
                    .map(b => "0x" + b.toString(16).padStart(2, "0"))
                    .join(", ")}
                  ]
                </span>
              </span>
            </div>
          ))
        )}
        <div className="mem-hint">
          write 8 bytes with <code>mov [rdi], rsi</code> (little-endian) · or
          1 byte with <code>mov byte [rdi], sil</code>
        </div>
      </div>

      <div className="mem-region">
        <div className="mem-title">
          <span className="mem-tag stk">stack</span>
          <span className="mem-sub">the ROP chain lives here · base {mem.stackBase}</span>
        </div>
        <div className="mem-hint">
          each <code>ret</code> pops 8 bytes from top — see the Stack panel below
        </div>
      </div>
    </div>
  );
}

function groupStrings(bytes: Record<string, number>): Array<{
  addr: string;
  text: string;
  bytes: number[];
}> {
  const entries = Object.entries(bytes)
    .map(([a, v]) => ({ addr: BigInt(a), byte: v }))
    .sort((a, b) => (a.addr < b.addr ? -1 : a.addr > b.addr ? 1 : 0));
  const out: Array<{ addr: string; text: string; bytes: number[] }> = [];
  let cur: { addr: bigint; bytes: number[] } | null = null;
  for (const e of entries) {
    if (!cur || e.addr !== cur.addr + BigInt(cur.bytes.length)) {
      if (cur) out.push(finish(cur));
      cur = { addr: e.addr, bytes: [] };
    }
    cur.bytes.push(e.byte);
  }
  if (cur) out.push(finish(cur));
  return out;
}

function finish(g: { addr: bigint; bytes: number[] }) {
  const printable = g.bytes
    .map(b => (b === 0 ? "\\0" : b >= 32 && b < 127 ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`))
    .join("");
  return {
    addr: "0x" + g.addr.toString(16),
    text: printable,
    bytes: g.bytes,
  };
}
