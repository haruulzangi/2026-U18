export function Controls({
  onRun,
  onStep,
  onReset,
  canStep,
  running,
}: {
  onRun: () => void;
  onStep: () => void;
  onReset: () => void;
  canStep: boolean;
  running: boolean;
}) {
  return (
    <div className="panel-section">
      <h3>Execution</h3>
      <div className="controls">
        <button className="primary" onClick={onRun} disabled={running}>
          ▶ Run
        </button>
        <button onClick={onStep} disabled={!canStep || running}>
          ▷ Step
        </button>
        <button onClick={onReset}>↺ Reset</button>
      </div>
    </div>
  );
}
