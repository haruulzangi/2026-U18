const tape = document.getElementById("tape");
const statusNode = document.getElementById("status");
const verifyForm = document.getElementById("verify-form");
const verifyInput = document.getElementById("verify-input");
const getFlagButton = document.querySelector('[data-path="/get-flag"]');
const publicKeyButton = document.querySelector('[data-path="/public-key"]');
const folioNode = document.getElementById("folio");

function setStatus(value) {
  statusNode.textContent = value;
}

function setTape(lines) {
  tape.textContent = lines.join("\n");
}

function stampFolio() {
  const value = Math.floor(Math.random() * 900 + 100);
  folioNode.textContent = String(value);
}

async function handlePublicKey() {
  setStatus("working");
  setTape([
    "  soliciting the apparatus —",
    "  requesting the bureau's publick key from /public-key ...",
  ]);

  try {
    const response = await fetch("/public-key");
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || typeof payload.public_key !== "string") {
      throw new Error(payload.error || "failed to retrieve public key");
    }

    setStatus("public key loaded");
    setTape([
      "  dispatch received —",
      "  the bureau's publick key, set in lead:",
      "",
      ...payload.public_key.trimEnd().split("\n").map((line) => `  ${line}`),
    ]);
  } catch (error) {
    setStatus("error");
    setTape([
      "  the mechanism stutters —",
      `  ${error instanceof Error ? error.message : "unknown failure"}`,
    ]);
  }
}

async function handleGetFlag() {
  setStatus("working");
  setTape([
    "  soliciting the apparatus —",
    "  the wire crackles; brass answers.",
    "  awaiting sealed dispatch from /get-flag ...",
  ]);

  try {
    const response = await fetch("/get-flag");
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || typeof payload.ciphertext !== "string") {
      throw new Error(payload.error || "failed to retrieve ciphertext");
    }

    verifyInput.value = payload.ciphertext;
    setStatus("ciphertext loaded");
    setTape([
      "  dispatch received —",
      "  ciphertext copied into the submission field.",
      "",
      `  ${payload.ciphertext}`,
    ]);
  } catch (error) {
    setStatus("error");
    setTape([
      "  the mechanism stutters —",
      `  ${error instanceof Error ? error.message : "unknown failure"}`,
    ]);
  }
}

async function handleVerify(event) {
  event.preventDefault();
  const ciphertext = verifyInput.value.trim();

  if (!ciphertext) {
    setStatus("awaiting ciphertext");
    setTape([
      "  nothing was transmitted —",
      "  enter or fetch a ciphertext first.",
    ]);
    return;
  }

  setStatus("judging");
  setTape([
    "  transmitting sealed dispatch —",
    "  the bureau examines the submitted ciphertext.",
  ]);

  try {
    const response = await fetch("/check-flag", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ciphertext }),
    });

    if (response.ok) {
      setStatus("accepted");
      setTape([
        "  judgement returned —",
        "  the ciphertext decrypted correctly.",
        "  the dispatch accords with the bureau's template.",
      ]);
      return;
    }

    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "ciphertext rejected");
  } catch (error) {
    setStatus("rejected");
    setTape([
      "  judgement returned —",
      `  ${error instanceof Error ? error.message : "ciphertext rejected"}`,
    ]);
  }
}

stampFolio();
publicKeyButton?.addEventListener("click", handlePublicKey);
getFlagButton?.addEventListener("click", handleGetFlag);
verifyForm?.addEventListener("submit", handleVerify);
