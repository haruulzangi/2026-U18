import { Router, type Request, type Response } from "express";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import type {
  Challenge,
  ChallengePublic,
  SubmitRequest,
  SubmitResponse,
} from "@ctf-rop/shared";
import { judge } from "./judge.js";

const here = dirname(fileURLToPath(import.meta.url));
const CHALLENGE_DIR = resolve(here, "./challenges");
const LEGACY_FILE = resolve(here, "./challenges.json");

type FullChallenge = Challenge & { flag: string };

function loadChallenges(): FullChallenge[] {
  // Per-file layout: every *.json in /challenges is one challenge.
  if (existsSync(CHALLENGE_DIR)) {
    const files = readdirSync(CHALLENGE_DIR)
      .filter(f => f.endsWith(".json"))
      .sort();
    return files.map(f => {
      const raw = readFileSync(join(CHALLENGE_DIR, f), "utf8");
      return JSON.parse(raw) as FullChallenge;
    });
  }
  // Fallback: single-array legacy file (kept for backwards compat).
  if (existsSync(LEGACY_FILE)) {
    const raw = readFileSync(LEGACY_FILE, "utf8");
    return JSON.parse(raw) as FullChallenge[];
  }
  return [];
}

export const routes = Router();

routes.get("/challenges", (_req: Request, res: Response) => {
  const cs = loadChallenges();
  const publicCs: ChallengePublic[] = cs.map(({ flag: _flag, ...pub }) => pub);
  res.json(publicCs);
});

const recentSubmits = new Map<string, number[]>();
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recentSubmits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recentSubmits.set(ip, hits);
  return hits.length > RATE_MAX;
}

routes.post("/submit", (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({
      correct: false,
      output: "",
      error: "too many submissions, slow down",
    } satisfies SubmitResponse);
    return;
  }

  const body = req.body as SubmitRequest;
  if (!body || typeof body.challengeId !== "string" || !body.flowchart) {
    res.status(400).json({
      correct: false,
      output: "",
      error: "bad request body",
    } satisfies SubmitResponse);
    return;
  }

  const cs = loadChallenges();
  const c = cs.find(x => x.id === body.challengeId);
  if (!c) {
    res.status(404).json({
      correct: false,
      output: "",
      error: "unknown challenge",
    } satisfies SubmitResponse);
    return;
  }

  const result = judge(
    body.flowchart,
    c.initState,
    c.expectedOutput,
    c.stepBudget ?? 10_000,
    c.allowedGadgets,
    c.blacklistedBytes,
    c.testCases,
  );
  if (result.correct) {
    res.json({
      correct: true,
      flag: c.flag,
      output: result.output,
    } satisfies SubmitResponse);
  } else {
    res.json({
      correct: false,
      output: result.output,
      error: result.error,
      hint: hintFor(c, result),
    } satisfies SubmitResponse);
  }
});

function hintFor(c: FullChallenge, r: ReturnType<typeof judge>): string {
  if (r.error) return `execution stopped: ${r.error}`;
  if (!r.output) return "the program produced no output — did you call puts or print_int?";
  return `output did not match. expected ${JSON.stringify(c.expectedOutput)}, got ${JSON.stringify(r.output)}`;
}
