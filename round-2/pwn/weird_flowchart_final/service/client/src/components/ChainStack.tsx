import { Fragment, useCallback, useState } from "react";
import { GADGET_BY_ID, type Flowchart } from "@ctf-rop/shared";

export type StackBlock =
  | { uid: string; kind: "gadget"; gadgetId: string }
  | { uid: string; kind: "imm"; value: string };

let uidCounter = 1;
const nextUid = () => `b${uidCounter++}`;

function readPaletteDrop(
  dt: DataTransfer,
): { kind: "gadget"; gadgetId: string } | { kind: "imm" } | null {
  const g = dt.getData("application/ropgadget");
  if (g && GADGET_BY_ID[g]) return { kind: "gadget", gadgetId: g };
  if (dt.getData("application/rop-imm")) return { kind: "imm" };
  return null;
}

export function blocksToFlowchart(blocks: StackBlock[]): Flowchart {
  const nodes = blocks.map(b =>
    b.kind === "gadget"
      ? { id: b.uid, kind: "gadget" as const, gadgetId: b.gadgetId }
      : { id: b.uid, kind: "imm" as const, value: b.value },
  );
  const edges = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    edges.push({ from: blocks[i].uid, to: blocks[i + 1].uid });
  }
  return {
    startNodeId: blocks[0]?.uid ?? null,
    nodes,
    edges,
  };
}

export function ChainStack({
  blocks,
  setBlocks,
  activeUid,
  maxBlocks,
}: {
  blocks: StackBlock[];
  setBlocks: (next: StackBlock[]) => void;
  activeUid: string | null;
  maxBlocks?: number;
}) {
  const atLimit =
    typeof maxBlocks === "number" && blocks.length >= maxBlocks;

  const insertAt = useCallback(
    (index: number, payload: ReturnType<typeof readPaletteDrop>) => {
      if (!payload) return;
      if (atLimit) return;
      const nb: StackBlock =
        payload.kind === "gadget"
          ? { uid: nextUid(), kind: "gadget", gadgetId: payload.gadgetId }
          : { uid: nextUid(), kind: "imm", value: "" };
      const next = [...blocks.slice(0, index), nb, ...blocks.slice(index)];
      setBlocks(next);
    },
    [blocks, setBlocks, atLimit],
  );

  const removeAt = useCallback(
    (index: number) => {
      const next = blocks.slice();
      next.splice(index, 1);
      setBlocks(next);
    },
    [blocks, setBlocks],
  );

  const move = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= blocks.length) return;
      const next = blocks.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      setBlocks(next);
    },
    [blocks, setBlocks],
  );

  const updateImm = useCallback(
    (index: number, value: string) => {
      const next = blocks.slice();
      const b = next[index];
      if (b.kind !== "imm") return;
      next[index] = { ...b, value };
      setBlocks(next);
    },
    [blocks, setBlocks],
  );

  const popExpected = (i: number) => {
    const b = blocks[i];
    if (b?.kind !== "gadget") return false;
    return (GADGET_BY_ID[b.gadgetId]?.immediates ?? 0) > 0;
  };
  const immIsCorrectlyPlaced = (i: number) => {
    if (i === 0) return false; // imm can't be the first block
    const prev = blocks[i - 1];
    if (prev?.kind !== "gadget") return false;
    return (GADGET_BY_ID[prev.gadgetId]?.immediates ?? 0) > 0;
  };

  return (
    <div className="chain-wrap">
      {typeof maxBlocks === "number" && (
        <div className={`block-budget${atLimit ? " full" : ""}`}>
          {blocks.length} / {maxBlocks} blocks used
          {atLimit && " — chain is full, you'll have to pivot"}
        </div>
      )}
      <div className="chain-stack">
        <StartBlock />
        <DropZone
          onDrop={payload => insertAt(0, payload)}
          first
          disabled={atLimit}
        />
        {blocks.map((b, i) => {
          const err =
            b.kind === "gadget" && popExpected(i)
              ? blocks[i + 1]?.kind === "imm"
                ? null
                : "needs a value block below"
              : b.kind === "imm" && !immIsCorrectlyPlaced(i)
              ? "stray value — place directly under a pop gadget"
              : null;
          return (
            <Fragment key={b.uid}>
              <BlockView
                block={b}
                index={i}
                active={b.uid === activeUid}
                error={err}
                onDelete={() => removeAt(i)}
                onUp={() => move(i, -1)}
                onDown={() => move(i, +1)}
                canUp={i > 0}
                canDown={i < blocks.length - 1}
                onImmChange={(v: string) => updateImm(i, v)}
              />
              <DropZone
                onDrop={payload => insertAt(i + 1, payload)}
                disabled={atLimit}
              />
            </Fragment>
          );
        })}
        <HaltBlock />
      </div>
    </div>
  );
}

function StartBlock() {
  return (
    <div className="block block-start">
      <div className="block-title">▶ START</div>
      <div className="block-sub">execution begins here</div>
    </div>
  );
}

function HaltBlock() {
  return (
    <div className="block block-halt">
      <div className="block-title">■ HALT</div>
      <div className="block-sub">ret to 0x0 — program ends</div>
    </div>
  );
}

function BlockView({
  block,
  index,
  active,
  error,
  onDelete,
  onUp,
  onDown,
  canUp,
  canDown,
  onImmChange,
}: {
  block: StackBlock;
  index: number;
  active: boolean;
  error: string | null;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
  canUp: boolean;
  canDown: boolean;
  onImmChange: (v: string) => void;
}) {
  if (block.kind === "gadget") {
    const g = GADGET_BY_ID[block.gadgetId];
    if (!g) {
      return (
        <div className="block block-error">unknown gadget: {block.gadgetId}</div>
      );
    }
    return (
      <div
        className={`block block-gadget${active ? " active" : ""}${error ? " warn" : ""}`}
      >
        <div className="block-head">
          <span className="block-index">#{index + 1}</span>
          <span className="block-addr">0x{g.address.toString(16)}</span>
          <div style={{ flex: 1 }} />
          <BlockButtons
            canUp={canUp}
            canDown={canDown}
            onUp={onUp}
            onDown={onDown}
            onDelete={onDelete}
          />
        </div>
        <div className="block-title">{g.mnemonic}</div>
        <div className="block-sub">{g.description}</div>
        {error && <div className="block-warn">⚠ {error}</div>}
      </div>
    );
  }
  // imm
  return (
    <div
      className={`block block-imm${active ? " active" : ""}${error ? " warn" : ""}`}
    >
      <div className="block-head">
        <span className="block-index">#{index + 1}</span>
        <span className="block-addr">value</span>
        <div style={{ flex: 1 }} />
        <BlockButtons
          canUp={canUp}
          canDown={canDown}
          onUp={onUp}
          onDown={onDown}
          onDelete={onDelete}
        />
      </div>
      <input
        className="block-imm-input"
        type="text"
        placeholder="hex or decimal, e.g. 0x402000"
        value={block.value}
        onChange={e => onImmChange(e.target.value)}
        spellCheck={false}
      />
      {error && <div className="block-warn">⚠ {error}</div>}
    </div>
  );
}

function BlockButtons({
  canUp,
  canDown,
  onUp,
  onDown,
  onDelete,
}: {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="block-buttons">
      <button onClick={onUp} disabled={!canUp} title="move up">
        ▲
      </button>
      <button onClick={onDown} disabled={!canDown} title="move down">
        ▼
      </button>
      <button onClick={onDelete} title="remove" className="x">
        ×
      </button>
    </div>
  );
}

function DropZone({
  onDrop,
  first = false,
  disabled = false,
}: {
  onDrop: (payload: ReturnType<typeof readPaletteDrop>) => void;
  first?: boolean;
  disabled?: boolean;
}) {
  const [hot, setHot] = useState(false);
  return (
    <div
      className={`drop-zone${hot ? " hot" : ""}${first ? " first" : ""}${disabled ? " disabled" : ""}`}
      onDragOver={e => {
        if (disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setHot(true);
      }}
      onDragLeave={() => setHot(false)}
      onDrop={e => {
        if (disabled) return;
        e.preventDefault();
        setHot(false);
        onDrop(readPaletteDrop(e.dataTransfer));
      }}
    >
      <span>{disabled ? "limit reached" : "drop here"}</span>
    </div>
  );
}
