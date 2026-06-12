import type {
  ChallengePublic,
  Flowchart,
  SubmitResponse,
} from "@ctf-rop/shared";

export async function fetchChallenges(): Promise<ChallengePublic[]> {
  const r = await fetch("/api/challenges");
  if (!r.ok) throw new Error(`GET /challenges failed: ${r.status}`);
  return r.json();
}

export async function submitChain(
  challengeId: string,
  flowchart: Flowchart,
  stdin?: string,
): Promise<SubmitResponse> {
  const r = await fetch("/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId, flowchart, stdin }),
  });
  return r.json();
}
