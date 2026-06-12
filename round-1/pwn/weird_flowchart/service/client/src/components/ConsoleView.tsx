import type { Snapshot } from "@ctf-rop/shared";

export function ConsoleView({
  snap,
  stdin,
  onStdinChange,
  stdinLocked,
}: {
  snap: Snapshot | null;
  stdin: string;
  onStdinChange: (v: string) => void;
  stdinLocked: boolean;
}) {
  const cursor = snap?.stdin.cursor ?? 0;
  const bufferLen = (snap?.stdin.buffer ?? stdin).length;
  const remaining = Math.max(0, bufferLen - cursor);

  return (
    <div className="panel-section">
      <h3>Console</h3>

      <div className="console-sub">stdout</div>
      <div className="output-box">{snap?.output ?? ""}</div>
      {snap?.error && (
        <div className="error-box" style={{ marginTop: 6 }}>
          {snap.error}
        </div>
      )}

      <div className="console-sub" style={{ marginTop: 8 }}>
        stdin {stdinLocked ? "(preset by challenge)" : "(editable before Run)"}
      </div>
      <textarea
        className="stdin-box"
        value={stdin}
        readOnly={stdinLocked}
        spellCheck={false}
        placeholder={
          stdinLocked
            ? ""
            : "type input here — read_int / read_char / gets consume from this"
        }
        rows={3}
        onChange={e => onStdinChange(e.target.value)}
      />

      <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
        cursor {cursor}/{bufferLen} · {remaining} byte
        {remaining === 1 ? "" : "s"} remaining
        {snap ? ` · step ${snap.step}` : ""}
        {snap?.halted ? " · halted" : snap ? " · running" : ""}
      </div>
    </div>
  );
}
