import {
  createState,
  linearize,
  parseBig,
  runToEnd,
  snapshot,
  type Flowchart,
  type InitState,
  type TestCase,
} from "@ctf-rop/shared";

export type JudgeResult = {
  correct: boolean;
  output: string;
  error?: string;
  steps: number;
};

export function judge(
  flowchart: Flowchart,
  init: InitState,
  expectedOutput: string,
  stepBudget: number = 10_000,
  allowedGadgets?: string[],
  blacklistedBytes?: number[],
  testCases?: TestCase[],
): JudgeResult {
  if (allowedGadgets && allowedGadgets.length > 0) {
    const allow = new Set(allowedGadgets);
    for (const n of flowchart.nodes) {
      if (n.kind === "gadget" && !allow.has(n.gadgetId)) {
        return {
          correct: false,
          output: "",
          error: `gadget "${n.gadgetId}" is not allowed for this challenge`,
          steps: 0,
        };
      }
    }
  }
  if (blacklistedBytes && blacklistedBytes.length > 0) {
    const bad = new Set(blacklistedBytes.map(b => b & 0xff));
    const mask = (1n << 64n) - 1n;
    for (const n of flowchart.nodes) {
      if (n.kind !== "imm") continue;
      let v: bigint;
      try {
        v = parseBig(n.value || "0") & mask;
      } catch {
        return {
          correct: false,
          output: "",
          error: `value "${n.value}" in block ${n.id} is not a valid number`,
          steps: 0,
        };
      }
      for (let i = 0; i < 8; i++) {
        const byte = Number((v >> BigInt(i * 8)) & 0xffn);
        if (bad.has(byte)) {
          const ch =
            byte >= 32 && byte < 127 ? ` ('${String.fromCharCode(byte)}')` : "";
          return {
            correct: false,
            output: "",
            error: `value block ${n.id} (${n.value}) contains forbidden byte 0x${byte.toString(16).padStart(2, "0")}${ch} `,
            steps: 0,
          };
        }
      }
    }
  }
  const lin = linearize(flowchart);
  if (!lin.ok) {
    return { correct: false, output: "", error: lin.error, steps: 0 };
  }

  const cases: TestCase[] =
    testCases && testCases.length > 0
      ? testCases
      : [{ expectedOutput }];

  let lastOutput = "";
  let totalSteps = 0;
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    const mergedInit: InitState = {
      ...init,
      registers: { ...(init.registers ?? {}), ...(tc.registers ?? {}) },
      stdin: tc.stdin ?? init.stdin,
    };
    const state = createState(mergedInit, lin.chain);
    runToEnd(state, stepBudget);
    const snap = snapshot(state);
    lastOutput = snap.output;
    totalSteps += snap.step;

    const label = describeCase(tc, i, cases.length);

    // A halted-with-error run is only a problem when the case expects a
    // specific output. Negative cases (forbiddenOutput only) may intentionally
    // produce bad pointers / halts — that's fine as long as nothing forbidden
    // was printed.
    if (snap.error && tc.expectedOutput !== undefined) {
      return {
        correct: false,
        output: snap.output,
        error: `${label}: ${snap.error}`,
        steps: totalSteps,
      };
    }
    if (tc.expectedOutput !== undefined && snap.output !== tc.expectedOutput) {
      return {
        correct: false,
        output: snap.output,
        error: `${label}: expected ${JSON.stringify(tc.expectedOutput)}, got ${JSON.stringify(snap.output)}`,
        steps: totalSteps,
      };
    }
    if (tc.forbiddenOutput !== undefined && snap.output === tc.forbiddenOutput) {
      return {
        correct: false,
        output: snap.output,
        error: `${label}: output ${JSON.stringify(snap.output)} was forbidden for this case`,
        steps: totalSteps,
      };
    }
  }

  return {
    correct: true,
    output: lastOutput,
    steps: totalSteps,
  };
}

function describeCase(tc: TestCase, i: number, n: number): string {
  if (n === 1) return "judgement";
  const inHint = tc.stdin
    ? ` (stdin=${JSON.stringify(tc.stdin.slice(0, 40))})`
    : tc.registers
    ? ` (registers=${JSON.stringify(tc.registers)})`
    : "";
  return `test case ${i + 1}/${n}${inHint}`;
}
