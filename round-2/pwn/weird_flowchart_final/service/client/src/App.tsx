import { useEffect, useState } from "react";
import type { ChallengePublic } from "@ctf-rop/shared";
import { Editor } from "./components/Editor.js";
import { fetchChallenges } from "./api.js";

type Mode = "playground" | "challenge";

export default function App() {
  const [mode, setMode] = useState<Mode>("playground");
  const [challenges, setChallenges] = useState<ChallengePublic[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchChallenges()
      .then(cs => {
        setChallenges(cs);
        if (cs[0]) setSelectedId(cs[0].id);
      })
      .catch(e => setLoadError(String(e)));
  }, []);

  const selected =
    mode === "challenge" ? challenges.find(c => c.id === selectedId) : undefined;

  return (
    <div className="app">
      <div className="topbar">
        <h1>🪝 Weird Flowchart</h1>
        <div className="mode-tabs">
          <button
            className={mode === "playground" ? "active" : ""}
            onClick={() => setMode("playground")}
          >
            Playground
          </button>
          <button
            className={mode === "challenge" ? "active" : ""}
            onClick={() => setMode("challenge")}
          >
            Challenge
          </button>
        </div>
        {mode === "challenge" && (
          <select
            value={selectedId ?? ""}
            onChange={e => setSelectedId(e.target.value)}
          >
            {challenges.map(c => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        <div className="spacer" style={{ flex: 1 }} />
        {loadError && (
          <span style={{ color: "var(--bad)" }}>
            failed to load challenges: {loadError}
          </span>
        )}
        <span style={{ color: "var(--muted)" }}>
          {mode === "playground"
            ? "free-form sandbox — snap puzzle blocks together, hit Run"
            : "solve the problem, submit, get the flag"}
        </span>
      </div>
      {mode === "playground" ? (
        <Editor
          defaultInitState={{
            rodata: { "0x402000": "HELLO", "0x402100": "WORLD" },
          }}
        />
      ) : selected ? (
        <Editor key={selected.id} challenge={selected} />
      ) : (
        <div style={{ padding: 40, color: "var(--muted)" }}>
          {challenges.length === 0
            ? "loading challenges…"
            : "pick a challenge from the dropdown"}
        </div>
      )}
    </div>
  );
}
