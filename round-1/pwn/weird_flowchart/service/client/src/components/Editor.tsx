import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createState,
  linearize,
  previewMemory,
  snapshot,
  stepOnce,
  type ChallengePublic,
  type Flowchart,
  type InitState,
  type Snapshot,
  type SubmitResponse,
} from "@ctf-rop/shared";
import {
  ChainStack,
  blocksToFlowchart,
  type StackBlock,
} from "./ChainStack.js";
import { GadgetPalette } from "./GadgetPalette.js";
import { RegisterView } from "./RegisterView.js";
import { StackView } from "./StackView.js";
import { ConsoleView } from "./ConsoleView.js";
import { MemoryView } from "./MemoryView.js";
import { Controls } from "./Controls.js";
import { submitChain } from "../api.js";

export function Editor({
  challenge,
  defaultInitState,
}: {
  challenge?: ChallengePublic;
  defaultInitState?: InitState;
}) {
  const [blocks, setBlocks] = useState<StackBlock[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [prevSnap, setPrevSnap] = useState<Snapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [linearError, setLinearError] = useState<string | null>(null);
  const [submitMsg, setSubmitMsg] = useState<SubmitResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const initState: InitState = challenge?.initState ?? defaultInitState ?? {};
  const stdinLocked = !!challenge;
  const [stdinInput, setStdinInput] = useState<string>(initState.stdin ?? "");
  const [promptOpen, setPromptOpen] = useState(true);

  const vmRef = useRef<ReturnType<typeof createState> | null>(null);
  const orderRef = useRef<string[]>([]);

  const flowchart: Flowchart = useMemo(() => blocksToFlowchart(blocks), [blocks]);

  const effectiveInitState: InitState = useMemo(
    () => ({
      ...initState,
      stdin: stdinLocked ? initState.stdin ?? "" : stdinInput,
    }),
    [initState, stdinInput, stdinLocked],
  );

  const buildAndLoad = useCallback((): boolean => {
    const lin = linearize(flowchart);
    if (!lin.ok) {
      setLinearError(lin.error);
      vmRef.current = null;
      orderRef.current = [];
      setSnap(null);
      setPrevSnap(null);
      return false;
    }
    setLinearError(null);
    const state = createState(effectiveInitState, lin.chain);
    vmRef.current = state;
    orderRef.current = lin.order;
    setSnap(snapshot(state));
    setPrevSnap(null);
    return true;
  }, [flowchart, effectiveInitState]);

  const handleReset = useCallback(() => {
    vmRef.current = null;
    orderRef.current = [];
    setSnap(null);
    setPrevSnap(null);
    setRunning(false);
    setLinearError(null);
    setSubmitMsg(null);
  }, []);

  const handleStep = useCallback(() => {
    if (!vmRef.current) {
      if (!buildAndLoad()) return;
    }
    const s = vmRef.current;
    if (!s || s.halted) return;
    const before = snapshot(s);
    stepOnce(s);
    setPrevSnap(before);
    setSnap(snapshot(s));
  }, [buildAndLoad]);

  const handleRun = useCallback(async () => {
    if (!vmRef.current) {
      if (!buildAndLoad()) return;
    }
    const s = vmRef.current;
    if (!s) return;
    setRunning(true);
    const BUDGET = 10_000;
    try {
      const before = snapshot(s);
      setPrevSnap(before);
      while (!s.halted && s.step < BUDGET) {
        stepOnce(s);
      }
      setPrevSnap(before);
      setSnap(snapshot(s));
    } finally {
      setRunning(false);
    }
  }, [buildAndLoad]);

  const activeUid = useMemo(() => {
    if (!snap || snap.halted) return null;
    const idx = snap.step;
    return orderRef.current[idx] ?? null;
  }, [snap]);

  const handleSubmit = useCallback(async () => {
    if (!challenge) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await submitChain(challenge.id, flowchart);
      setSubmitMsg(res);
    } catch (e) {
      setSubmitMsg({
        correct: false,
        output: "",
        error: `network error: ${(e as Error).message}`,
      });
    } finally {
      setSubmitting(false);
    }
  }, [challenge, flowchart]);

  // Reset blocks + VM when challenge changes.
  useEffect(() => {
    setBlocks([]);
    handleReset();
    setStdinInput(initState.stdin ?? "");
    setPromptOpen(true);
  }, [challenge?.id, handleReset, initState.stdin]);

  return (
    <div className="main">
      <GadgetPalette allowedGadgets={challenge?.allowedGadgets ?? null} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {challenge && (
          <div className={`challenge-panel${promptOpen ? "" : " collapsed"}`}>
            <div className="row">
              <button
                className="prompt-toggle"
                onClick={() => setPromptOpen(o => !o)}
                title={promptOpen ? "collapse description" : "expand description"}
                aria-expanded={promptOpen}
              >
                {promptOpen ? "▾" : "▸"}
              </button>
              <strong>{challenge.title}</strong>
              <span style={{ color: "var(--muted)" }}>· {challenge.id}</span>
              <div className="spacer" style={{ flex: 1 }} />
              <button
                className="primary"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Submitting…" : "Submit for flag"}
              </button>
            </div>
            {promptOpen && (
              <>
                <div className="prompt">{challenge.prompt}</div>
                {challenge.testCases && challenge.testCases.length > 1 && (
                  <div className="testcases-count">
                    judged against {challenge.testCases.length} hidden test cases
                  </div>
                )}
                {challenge.allowedGadgets && (
                  <div className="allowed-hint">
                    palette restricted to {challenge.allowedGadgets.length} gadgets
                    for this challenge
                  </div>
                )}
                {challenge.blacklistedBytes && challenge.blacklistedBytes.length > 0 && (
                  <div className="blacklist-row">
                    <div className="blacklist-label">
                      ⚠ banned bytes in value blocks:
                    </div>
                    <div className="blacklist-tiles">
                      {challenge.blacklistedBytes.map(b => (
                        <span key={b} className="blacklist-tile">
                          <span className="blacklist-hex">
                            0x{b.toString(16).padStart(2, "0")}
                          </span>
                          <span className="blacklist-char">
                            {b >= 32 && b < 127 ? String.fromCharCode(b) : "·"}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {submitMsg?.correct && (
              <div className="flag-box">
                ✅ Correct! Flag: <strong>{submitMsg.flag}</strong>
              </div>
            )}
            {submitMsg && !submitMsg.correct && (
              <div className="error-box">
                ❌ {submitMsg.hint ?? submitMsg.error ?? "not quite"}
                {submitMsg.output && (
                  <div style={{ marginTop: 4 }}>
                    your output: <code>{JSON.stringify(submitMsg.output)}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <ChainStack
          blocks={blocks}
          setBlocks={setBlocks}
          activeUid={activeUid}
        />
      </div>
      <div className="sidepanel">
        <Controls
          onRun={handleRun}
          onStep={handleStep}
          onReset={handleReset}
          canStep={!!(vmRef.current ? !vmRef.current.halted : blocks.length > 0)}
          running={running}
        />
        {linearError && (
          <div className="error-box">chain error: {linearError}</div>
        )}
        <MemoryView mem={snap?.memory ?? previewMemory(initState)} />
        <RegisterView snap={snap} prev={prevSnap} />
        <StackView snap={snap} />
        <ConsoleView
          snap={snap}
          stdin={stdinInput}
          onStdinChange={setStdinInput}
          stdinLocked={stdinLocked}
        />
      </div>
    </div>
  );
}
