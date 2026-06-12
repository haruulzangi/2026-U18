export type Reg =
  | "rax" | "rbx" | "rcx" | "rdx"
  | "rsi" | "rdi" | "rbp" | "rsp"
  | "rip"
  | "r8" | "r9" | "r10" | "r11" | "r12" | "r13" | "r14" | "r15";

export const REGS: Reg[] = [
  "rax", "rbx", "rcx", "rdx",
  "rsi", "rdi", "rbp", "rsp", "rip",
  "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15",
];

export type Immediate = { kind: "imm"; value: string };

export type FlowNode =
  | { id: string; kind: "gadget"; gadgetId: string }
  | { id: string; kind: "imm"; value: string };

export type FlowEdge = {
  from: string;
  to: string;
  branch?: "zero" | "nonzero";
};

export type Flowchart = {
  startNodeId: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type InitState = {
  registers?: Partial<Record<Reg, string>>;
  rodata?: Record<string, string>;
  bssSize?: number;
  stdin?: string;
  /**
   * Pre-stage qwords in .bss before the chain runs. Each entry is
   * `address: 64-bit-value` (decimal or 0x-prefixed) and is written as 8
   * little-endian bytes. Useful for stack-pivot challenges where a
   * "secondary chain" is parked in .bss for the kid to redirect rsp into.
   */
  bssQwords?: Record<string, string>;
};

export type TestCase = {
  /** overrides initState.stdin for this run */
  stdin?: string;
  /** overrides/extends initState.registers for this run */
  registers?: Partial<Record<Reg, string>>;
  /** If present, the chain's stdout must equal this string exactly. */
  expectedOutput?: string;
  /**
   * If present, the chain's stdout must NOT equal this string. Useful for
   * "negative" cases in conditional challenges where the kid may print
   * anything EXCEPT the success sentinel.
   */
  forbiddenOutput?: string;
};

export type Challenge = {
  id: string;
  title: string;
  prompt: string;
  initState: InitState;
  /** Used for judging when testCases is absent; and as the Playground preview input. */
  expectedOutput: string;
  stepBudget?: number;
  /**
   * Algorithm-problem mode: when set, judging runs the chain once per test
   * case (initState merged with each case's stdin/registers overrides). All
   * cases must match their expectedOutput for the flag to be awarded.
   * Hardcoding the answer fails because it only matches one case.
   */
  testCases?: TestCase[];
  /**
   * If set, the client palette shows only these gadget IDs and the server
   * rejects submissions using any other gadget. Omit to expose the full set.
   * Note: the "imm" value block is always available.
   */
  allowedGadgets?: string[];

  /**
   * If set, every imm (value block) submitted must have all 8 of its bytes
   * outside this list. Classic "bad chars" filter — forces kids to compute
   * forbidden byte values via arithmetic gadgets instead of writing them
   * as literal immediates.
   */
  blacklistedBytes?: number[];

  /**
   * When true, the stdin used by judging comes from the kid (sent in the
   * submit body), not from initState.stdin. The UI also unlocks the stdin
   * box and defaults it to hex-byte input mode — useful for "type your own
   * ROP chain bytes here" challenges.
   */
  kidStdin?: boolean;

  /**
   * Hard cap on the number of blocks the kid may place on the canvas (every
   * gadget block and every value block counts as one). Designed to force
   * stack-pivot solutions: when the cap is smaller than what a "naive" chain
   * would need, the kid must park the rest of the chain in .bss and pivot.
   */
  maxBlocks?: number;
};

export type ChallengePublic = Challenge;

export type SubmitRequest = {
  challengeId: string;
  flowchart: Flowchart;
  /**
   * Kid-provided stdin bytes (raw codepoints 0..255). Only honoured when the
   * challenge has kidStdin: true. The UI is responsible for any hex→bytes
   * decoding before sending.
   */
  stdin?: string;
};

export type SubmitResponse =
  | { correct: true; flag: string; output: string }
  | { correct: false; output: string; error?: string; hint?: string };

export type MemoryRegions = {
  bssStart: string;
  bssEnd: string;
  stackBase: string;
  bssBytes: Record<string, number>;
  rodataBytes: Record<string, number>;
};

export type StdinState = {
  buffer: string;
  cursor: number;
};

export type Snapshot = {
  step: number;
  registers: Record<Reg, string>;
  stack: string[];
  stackBase: string;
  output: string;
  currentGadgetAddr: string | null;
  halted: boolean;
  error?: string;
  memory: MemoryRegions;
  stdin: StdinState;
};
