import { useEffect, useMemo, useState } from "react";
import type { Snapshot } from "@ctf-rop/shared";

type Mode = "text" | "hex";

export function ConsoleView({
  snap,
  stdin,
  onStdinChange,
  stdinLocked,
  defaultHex,
  blacklistedBytes,
}: {
  snap: Snapshot | null;
  stdin: string;
  onStdinChange: (v: string) => void;
  stdinLocked: boolean;
  defaultHex?: boolean;
  blacklistedBytes?: number[];
}) {
  const cursor = snap?.stdin.cursor ?? 0;
  const bufferLen = (snap?.stdin.buffer ?? stdin).length;
  const remaining = Math.max(0, bufferLen - cursor);

  const [mode, setMode] = useState<Mode>(defaultHex ? "hex" : "text");
  const [hexDraft, setHexDraft] = useState<string>(() =>
    defaultHex ? bytesToHexBlock(stdin) : "",
  );

  useEffect(() => {
    if (mode === "hex" && hexDraft === "" && stdin) {
      setHexDraft(bytesToHexBlock(stdin));
    }
  }, [mode, hexDraft, stdin]);

  const hexParse = useMemo(() => parseHex(hexDraft), [hexDraft]);

  const banned = useMemo(() => {
    if (!hexParse.ok) return null;
    if (!blacklistedBytes || blacklistedBytes.length === 0) return null;
    const bad = new Set(blacklistedBytes.map(b => b & 0xff));
    for (let i = 0; i < hexParse.bytes.length; i++) {
      const byte = hexParse.bytes.charCodeAt(i) & 0xff;
      if (bad.has(byte)) return { offset: i, byte };
    }
    return null;
  }, [hexParse, blacklistedBytes]);

  // When hex draft parses cleanly, push the decoded bytes upstream.
  useEffect(() => {
    if (mode !== "hex") return;
    if (!hexParse.ok) return;
    if (hexParse.bytes === stdin) return;
    onStdinChange(hexParse.bytes);
  }, [mode, hexParse, stdin, onStdinChange]);

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
        <span>
          stdin {stdinLocked ? "(preset by challenge)" : "(editable before Run)"}
        </span>
        {!stdinLocked && (
          <span className="stdin-mode">
            <button
              type="button"
              className={`stdin-mode-btn${mode === "text" ? " active" : ""}`}
              onClick={() => setMode("text")}
            >
              text
            </button>
            <button
              type="button"
              className={`stdin-mode-btn${mode === "hex" ? " active" : ""}`}
              onClick={() => {
                setHexDraft(d => (d ? d : bytesToHexBlock(stdin)));
                setMode("hex");
              }}
            >
              hex
            </button>
          </span>
        )}
      </div>
      {mode === "text" ? (
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
      ) : (
        <textarea
          className="stdin-box mono"
          value={hexDraft}
          spellCheck={false}
          placeholder={"00 01 40 00 00 00 00 00   # pop rdi\n# whitespace, # comments, optional 0x prefix all OK"}
          rows={6}
          onChange={e => setHexDraft(e.target.value)}
        />
      )}

      {mode === "hex" && (
        <div className="hex-status">
          {!hexParse.ok ? (
            <span className="hex-error">hex parse error: {hexParse.error}</span>
          ) : banned ? (
            <span className="hex-error">
              byte {banned.offset} is forbidden: 0x
              {banned.byte.toString(16).padStart(2, "0")}
              {banned.byte >= 32 && banned.byte < 127
                ? ` ('${String.fromCharCode(banned.byte)}')`
                : ""}
            </span>
          ) : (
            <>
              decoded {hexParse.bytes.length} byte
              {hexParse.bytes.length === 1 ? "" : "s"}
            </>
          )}
        </div>
      )}

      <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
        cursor {cursor}/{bufferLen} · {remaining} byte
        {remaining === 1 ? "" : "s"} remaining
        {snap ? ` · step ${snap.step}` : ""}
        {snap?.halted ? " · halted" : snap ? " · running" : ""}
      </div>
    </div>
  );
}

type ParseResult =
  | { ok: true; bytes: string }
  | { ok: false; error: string };

function parseHex(raw: string): ParseResult {
  // Strip "# ..." comments to end of line.
  const noComments = raw.replace(/#[^\n]*/g, "");
  // Strip whitespace and "0x"/"0X" prefixes.
  const cleaned = noComments.replace(/0x/gi, "").replace(/[\s,;]+/g, "");
  if (cleaned.length === 0) return { ok: true, bytes: "" };
  if (cleaned.length % 2 !== 0) {
    return { ok: false, error: `odd number of hex digits (${cleaned.length})` };
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    const bad = cleaned.match(/[^0-9a-fA-F]/);
    return {
      ok: false,
      error: `non-hex character ${JSON.stringify(bad?.[0])}`,
    };
  }
  let out = "";
  for (let i = 0; i < cleaned.length; i += 2) {
    out += String.fromCharCode(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return { ok: true, bytes: out };
}

function bytesToHexBlock(s: string): string {
  if (!s) return "";
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    out.push(s.charCodeAt(i).toString(16).padStart(2, "0"));
  }
  // 8 bytes per line for readability (matches ROP qword grouping).
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 8) {
    lines.push(out.slice(i, i + 8).join(" "));
  }
  return lines.join("\n");
}
