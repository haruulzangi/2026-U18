import { GADGET_BY_ID, HALT_ADDR } from "./gadgets.js";
import type { Flowchart, FlowNode } from "./types.js";
import { STACK_BASE, parseBig, type LoadedChain } from "./vm.js";

export type LinearizeResult =
  | { ok: true; chain: LoadedChain; order: string[] }
  | { ok: false; error: string };

export function linearize(fc: Flowchart): LinearizeResult {
  if (!fc.startNodeId) return { ok: false, error: "no start node set" };
  const nodeMap = new Map<string, FlowNode>(fc.nodes.map(n => [n.id, n]));
  const start = nodeMap.get(fc.startNodeId);
  if (!start)
    return { ok: false, error: `start node ${fc.startNodeId} not found` };
  if (start.kind !== "gadget")
    return { ok: false, error: "start must connect to a gadget, not a value block" };

  const nextEdge = new Map<string, string>();
  for (const e of fc.edges) {
    if (e.branch) continue;
    if (nextEdge.has(e.from))
      return { ok: false, error: `node ${e.from} has multiple outgoing edges` };
    nextEdge.set(e.from, e.to);
  }

  const order: string[] = [];
  const stack: bigint[] = [];
  const visited = new Set<string>();

  let cur: string | undefined = fc.startNodeId;
  while (cur) {
    if (visited.has(cur))
      return { ok: false, error: `cycle detected at node ${cur}` };
    visited.add(cur);
    const node = nodeMap.get(cur);
    if (!node) return { ok: false, error: `node ${cur} missing` };
    if (node.kind !== "gadget")
      return { ok: false, error: `node ${cur} should be a gadget` };
    const gadget = GADGET_BY_ID[node.gadgetId];
    if (!gadget)
      return { ok: false, error: `unknown gadget ${node.gadgetId}` };

    order.push(cur);
    stack.push(gadget.address);

    if (gadget.immediates > 0) {
      const nextId = nextEdge.get(cur);
      if (!nextId)
        return {
          ok: false,
          error: `${gadget.mnemonic} needs a value block connected after it (the number to pop)`,
        };
      const immNode = nodeMap.get(nextId);
      if (!immNode)
        return { ok: false, error: `node ${nextId} missing` };
      if (immNode.kind !== "imm")
        return {
          ok: false,
          error: `${gadget.mnemonic} must be followed by a value block, not another gadget`,
        };
      if (visited.has(nextId))
        return { ok: false, error: `cycle detected at node ${nextId}` };
      visited.add(nextId);
      let imm: bigint;
      try {
        imm = parseBig(immNode.value || "0");
      } catch {
        return {
          ok: false,
          error: `value block ${nextId}: "${immNode.value}" is not a valid number`,
        };
      }
      stack.push(imm);
      cur = nextEdge.get(nextId);
    } else {
      const nextId = nextEdge.get(cur);
      if (nextId) {
        const nextNode = nodeMap.get(nextId);
        if (nextNode?.kind === "imm")
          return {
            ok: false,
            error: `${gadget.mnemonic} does not consume a value block — wire it to another gadget`,
          };
      }
      cur = nextId;
    }
  }

  stack.push(HALT_ADDR);

  const STACK_QWORDS = 512;
  if (stack.length > STACK_QWORDS)
    return {
      ok: false,
      error: `chain too long (${stack.length} qwords > ${STACK_QWORDS})`,
    };
  while (stack.length < STACK_QWORDS) stack.push(0n);

  return {
    ok: true,
    order,
    chain: { initialStack: stack, initialRsp: STACK_BASE },
  };
}
