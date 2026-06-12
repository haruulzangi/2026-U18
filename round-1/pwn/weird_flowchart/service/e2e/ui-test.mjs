import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:8080";
const OUT = "/home/soctest/hz-u18_2026/e2e/shots";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1400, height: 900 },
});

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", m => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));

  console.log(`[1] loading ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 15000 });
  await page.screenshot({ path: `${OUT}/01-loaded.png`, fullPage: true });

  // --- Basic page structure ---
  console.log("[2] page structure");
  check("title has 'Weird Flowchart'", (await page.title()).includes("Weird Flowchart"));
  check(
    "Playground tab present",
    await page.evaluate(() =>
      !!Array.from(document.querySelectorAll("button")).find(
        b => b.textContent?.trim() === "Playground",
      ),
    ),
  );
  check(
    "Challenge tab present",
    await page.evaluate(() =>
      !!Array.from(document.querySelectorAll("button")).find(
        b => b.textContent?.trim() === "Challenge",
      ),
    ),
  );

  // --- Palette ---
  console.log("[3] palette");
  const paletteItems = await page.$$eval(".palette-item", els =>
    els.map(e => e.textContent?.split("\n")[0].trim()),
  );
  check("palette has >=10 gadgets", paletteItems.length >= 10, `found ${paletteItems.length}`);
  check("palette includes 'value (immediate)'", paletteItems.some(t => t?.includes("value (immediate)")));
  check("palette includes 'pop rdi; ret'", paletteItems.some(t => t?.includes("pop rdi")));
  check("palette includes 'call scanf'", paletteItems.some(t => t?.includes("call scanf")));
  check("palette includes 'call printf'", paletteItems.some(t => t?.includes("call printf")));

  // --- LEGO chain: START + HALT visible, no canvas/reactflow ---
  console.log("[4] LEGO chain structure");
  check("chain wrapper present", !!(await page.$(".chain-wrap")));
  check("reactflow canvas ABSENT (no more wiring UI)", !(await page.$(".react-flow")));
  check("START block visible", !!(await page.$(".block-start")));
  check("HALT block visible", !!(await page.$(".block-halt")));
  check(
    "drop zone present (at least one)",
    (await page.$$(".drop-zone")).length >= 1,
  );

  // --- Side panels ---
  console.log("[5] side panels");
  const panelTitles = await page.$$eval(".panel-section h3", els =>
    els.map(e => e.textContent?.trim()),
  );
  for (const t of ["Registers", "Console", "Execution", "Memory Map"]) {
    check(`has ${t} panel`, panelTitles.includes(t));
  }
  check("stdin textarea present", !!(await page.$(".stdin-box")));

  // --- Drop a gadget block + value block into the stack ---
  console.log("[6] drop blocks into the stack");
  const synthDrop = async (selector, mime, data, nth = 0) => {
    return await page.evaluate(
      ({ selector, mime, data, nth }) => {
        const targets = document.querySelectorAll(selector);
        const t = targets[nth] ?? targets[targets.length - 1];
        if (!t) return false;
        const rect = t.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const dt = new DataTransfer();
        dt.setData(mime, data);
        t.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt,
          }),
        );
        t.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt,
          }),
        );
        return true;
      },
      { selector, mime, data, nth },
    );
  };

  check(
    "drop pop_rdi onto first drop zone",
    await synthDrop(".drop-zone", "application/ropgadget", "pop_rdi", 0),
  );
  await new Promise(r => setTimeout(r, 200));
  check(
    "gadget block added to stack",
    (await page.$$(".block-gadget")).length === 1,
  );

  check(
    "drop value onto drop zone after the pop",
    await synthDrop(".drop-zone", "application/rop-imm", "1", 1),
  );
  await new Promise(r => setTimeout(r, 200));
  check(
    "value block added (purple)",
    (await page.$$(".block-imm")).length === 1,
  );

  check(
    "drop call_puts at the end",
    await synthDrop(".drop-zone", "application/ropgadget", "call_puts", 2),
  );
  await new Promise(r => setTimeout(r, 200));
  check(
    "now have 2 gadget blocks + 1 value block",
    (await page.$$(".block-gadget")).length === 2,
  );

  // --- Enter the value into the value block's input ---
  console.log("[7] type value into the value block");
  const typed = await page.evaluate(() => {
    const input = document.querySelector(".block-imm .block-imm-input");
    if (!input) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    nativeSetter.call(input, "0x402000");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value;
  });
  check("typed 0x402000 into value input", typed === "0x402000");

  await page.screenshot({ path: `${OUT}/02-built-chain.png`, fullPage: true });

  // --- Click Run and verify output ---
  console.log("[8] click Run and watch output");
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button"))
      .find(b => b.textContent?.trim().includes("Run"))
      ?.click();
  });
  await new Promise(r => setTimeout(r, 500));
  const outputText = await page
    .$eval(".output-box", el => el.textContent ?? "")
    .catch(() => "");
  check(
    "output shows HELLO (Playground default rodata)",
    outputText.includes("HELLO"),
    JSON.stringify(outputText),
  );
  await page.screenshot({ path: `${OUT}/03-after-run.png`, fullPage: true });

  // --- Move-up button reorders blocks ---
  console.log("[9] move-up reorders");
  const firstGadgetBefore = await page.$eval(
    ".block-gadget .block-title",
    el => el.textContent,
  );
  check("first gadget is pop rdi before", firstGadgetBefore?.includes("pop rdi"));

  // Click the ▲ arrow on the call_puts block (the 2nd .block-gadget)
  await page.evaluate(() => {
    const blocks = document.querySelectorAll(".block-gadget");
    const puts = blocks[blocks.length - 1];
    puts?.querySelector('button[title="move up"]')?.click();
  });
  await new Promise(r => setTimeout(r, 200));
  const firstGadgetAfter = await page.$eval(
    ".block-gadget .block-title",
    el => el.textContent,
  );
  check(
    "after move-up, call_puts came up one slot (stacked above value)",
    firstGadgetAfter?.includes("pop rdi") || firstGadgetAfter?.includes("call puts"),
    firstGadgetAfter,
  );

  // --- Delete a block ---
  console.log("[10] delete a block");
  await page.evaluate(() => {
    const b = document.querySelector(".block-imm");
    b?.querySelector('button[title="remove"]')?.click();
  });
  await new Promise(r => setTimeout(r, 200));
  check(
    "value block removed",
    (await page.$$(".block-imm")).length === 0,
  );

  // --- Switch to Challenge mode and verify palette restriction ---
  console.log("[11] challenge mode");
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button"))
      .find(b => b.textContent?.trim() === "Challenge")
      ?.click();
  });
  await new Promise(r => setTimeout(r, 400));
  const challengeDropdownCount = await page.$$eval("select option", els => els.length);
  check("3 challenges in dropdown", challengeDropdownCount === 3);
  const restrictedPalette = await page.$$eval(".palette-item", els => els.length);
  check(
    "palette restricted on hello_world_noconst (12 gadgets + value)",
    restrictedPalette === 13,
    `count=${restrictedPalette}`,
  );
  check(
    "stdin is read-only in challenge mode",
    await page.$eval(".stdin-box", el => el.readOnly === true),
  );

  // --- Select the bad-chars challenge and verify banned-byte UI ---
  console.log("[11b] bad-chars challenge shows banned-byte tiles");
  await page.select("select", "hello_world_noconst");
  await new Promise(r => setTimeout(r, 300));
  const tileCount = (await page.$$(".blacklist-tile")).length;
  check("9 banned-byte tiles shown", tileCount === 9, `count=${tileCount}`);
  const badCharsSample = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll(".blacklist-tile"));
    return tiles.map(t => t.textContent?.replace(/\s+/g, " ").trim()).slice(0, 3);
  });
  check(
    "tiles show hex + ASCII (sample)",
    badCharsSample.some(s => s?.includes("0x48") && s?.includes("H")),
    JSON.stringify(badCharsSample),
  );

  // Try to submit a literal banned byte and verify rejection
  const badResp = await page.evaluate(async () => {
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: "hello_world_noconst",
        flowchart: {
          startNodeId: "a",
          nodes: [
            { id: "a", kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v", kind: "imm", value: "0x48" },
            { id: "b", kind: "gadget", gadgetId: "call_puts" },
          ],
          edges: [{ from: "a", to: "v" }, { from: "v", to: "b" }],
        },
      }),
    });
    return r.json();
  });
  check(
    "literal 0x48 rejected with forbidden-byte error",
    badResp.correct === false &&
      (badResp.error ?? "").includes("forbidden byte 0x48"),
    badResp.error,
  );

  // --- Collapse/expand the prompt ---
  console.log("[11c] challenge prompt is collapsable");
  check(
    "toggle button present",
    !!(await page.$(".prompt-toggle")),
  );
  check(
    "prompt visible before click",
    !!(await page.$(".challenge-panel .prompt")),
  );
  check(
    "banned-byte tiles visible before click",
    (await page.$$(".blacklist-tile")).length === 9,
  );
  await page.click(".prompt-toggle");
  await new Promise(r => setTimeout(r, 200));
  check(
    "prompt hidden after collapse",
    !(await page.$(".challenge-panel .prompt")),
  );
  check(
    "banned-byte panel hidden after collapse",
    (await page.$$(".blacklist-tile")).length === 0,
  );
  check(
    "challenge-panel gets .collapsed class",
    await page.$eval(".challenge-panel", el => el.classList.contains("collapsed")),
  );
  // Submit button still works while collapsed
  check(
    "Submit button still present while collapsed",
    await page.evaluate(() =>
      !!Array.from(document.querySelectorAll("button")).find(b =>
        b.textContent?.includes("Submit for flag"),
      ),
    ),
  );
  // Expand again
  await page.click(".prompt-toggle");
  await new Promise(r => setTimeout(r, 200));
  check(
    "prompt visible again after re-expand",
    !!(await page.$(".challenge-panel .prompt")),
  );

  // --- Algorithm challenge: test cases hidden but count shown ---
  console.log("[11d] square challenge: test cases hidden, only count shown");
  await page.select("select", "square");
  await new Promise(r => setTimeout(r, 300));
  check(
    "no testcase table rendered (rows hidden)",
    (await page.$$(".testcases-table tbody tr")).length === 0,
  );
  const tcCountText = await page.$eval(
    ".testcases-count",
    el => el.textContent ?? "",
  ).catch(() => "");
  check(
    "test-case count hint visible",
    tcCountText.includes("5") && tcCountText.includes("hidden"),
    tcCountText,
  );

  // Submit correct solution: build BOTH format strings in .bss, then
  // scanf/printf.
  const sqResp = await page.evaluate(async () => {
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: "square",
        flowchart: {
          startNodeId: "a",
          nodes: [
            // build "%d\0..." at 0x403000
            { id: "a",  kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v1", kind: "imm",    value: "0x403000" },
            { id: "b",  kind: "gadget", gadgetId: "pop_rsi" },
            { id: "v2", kind: "imm",    value: "0x6425" },
            { id: "c",  kind: "gadget", gadgetId: "store_rdi_rsi" },
            // build "%d\n\0..." at 0x403020
            { id: "d",  kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v3", kind: "imm",    value: "0x403020" },
            { id: "e",  kind: "gadget", gadgetId: "pop_rsi" },
            { id: "v4", kind: "imm",    value: "0xa6425" },
            { id: "f",  kind: "gadget", gadgetId: "store_rdi_rsi" },
            // scanf(0x403000, 0x403010)
            { id: "g",  kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v5", kind: "imm",    value: "0x403000" },
            { id: "h",  kind: "gadget", gadgetId: "pop_rsi" },
            { id: "v6", kind: "imm",    value: "0x403010" },
            { id: "i",  kind: "gadget", gadgetId: "call_scanf" },
            // load N, square, prep printf arg
            { id: "j",  kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v7", kind: "imm",    value: "0x403010" },
            { id: "k",  kind: "gadget", gadgetId: "load_rax_rdi" },
            { id: "l",  kind: "gadget", gadgetId: "mov_rdi_rax" },
            { id: "m",  kind: "gadget", gadgetId: "imul_rax_rdi" },
            { id: "n",  kind: "gadget", gadgetId: "mov_rsi_rax" },
            // printf("%d\n", result)
            { id: "o",  kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v8", kind: "imm",    value: "0x403020" },
            { id: "p",  kind: "gadget", gadgetId: "call_printf" },
          ],
          edges: [
            { from: "a", to: "v1" }, { from: "v1", to: "b" },
            { from: "b", to: "v2" }, { from: "v2", to: "c" },
            { from: "c", to: "d" },  { from: "d", to: "v3" },
            { from: "v3", to: "e" }, { from: "e", to: "v4" },
            { from: "v4", to: "f" }, { from: "f", to: "g" },
            { from: "g", to: "v5" }, { from: "v5", to: "h" },
            { from: "h", to: "v6" }, { from: "v6", to: "i" },
            { from: "i", to: "j" },  { from: "j", to: "v7" },
            { from: "v7", to: "k" }, { from: "k", to: "l" },
            { from: "l", to: "m" },  { from: "m", to: "n" },
            { from: "n", to: "o" },  { from: "o", to: "v8" },
            { from: "v8", to: "p" },
          ],
        },
      }),
    });
    return r.json();
  });
  check(
    "build-both-formats chain passes all 5 test cases",
    sqResp.correct === true && typeof sqResp.flag === "string",
    JSON.stringify(sqResp),
  );

  // Pointing printf at the (now-absent) 0x402300 rodata entry should fail.
  const sqNoFmt = await page.evaluate(async () => {
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: "square",
        flowchart: {
          startNodeId: "a",
          nodes: [
            { id: "a", kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v1", kind: "imm", value: "0x402300" },
            { id: "b", kind: "gadget", gadgetId: "call_printf" },
          ],
          edges: [
            { from: "a", to: "v1" }, { from: "v1", to: "b" },
          ],
        },
      }),
    });
    return r.json();
  });
  check(
    "printf at stale 0x402300 fails with readable pointer error",
    sqNoFmt.correct === false &&
      (sqNoFmt.error ?? "").includes("format pointer 0x402300"),
    sqNoFmt.error,
  );

  // Try old read_int (should be blocked by allowedGadgets)
  const sqBadResp = await page.evaluate(async () => {
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: "square",
        flowchart: {
          startNodeId: "a",
          nodes: [{ id: "a", kind: "gadget", gadgetId: "call_read_int" }],
          edges: [],
        },
      }),
    });
    return r.json();
  });
  check(
    "old read_int rejected on scanf/printf challenge",
    sqBadResp.correct === false &&
      (sqBadResp.error ?? "").includes("not allowed"),
    sqBadResp.error,
  );

  // --- isEqual branchless-compare challenge ---
  await new Promise(r => setTimeout(r, 11000));
  console.log("[11f] isEqual: forbiddenOutput catches hardcoded 'true'");
  await page.select("select", "isEqual");
  await new Promise(r => setTimeout(r, 300));
  // Test case table is hidden, but the count hint should still appear.
  const isEqCountText = await page.$eval(
    ".testcases-count",
    el => el.textContent ?? "",
  ).catch(() => "");
  check(
    "isEqual test-case count hint visible",
    isEqCountText.includes("9") && isEqCountText.includes("hidden"),
    isEqCountText,
  );

  // Hardcoded-true cheat: always outputs "true\n" — must fail on an unequal case
  const cheatResp = await page.evaluate(async () => {
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: "isEqual",
        flowchart: {
          startNodeId: "a",
          nodes: [
            { id: "a",  kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v1", kind: "imm",    value: "0x403000" },
            { id: "b",  kind: "gadget", gadgetId: "pop_rsi" },
            { id: "v2", kind: "imm",    value: "0x65757274" },
            { id: "c",  kind: "gadget", gadgetId: "store_rdi_rsi" },
            { id: "d",  kind: "gadget", gadgetId: "pop_rdi" },
            { id: "v3", kind: "imm",    value: "0x403000" },
            { id: "e",  kind: "gadget", gadgetId: "call_puts" },
          ],
          edges: [
            { from: "a", to: "v1" }, { from: "v1", to: "b" },
            { from: "b", to: "v2" }, { from: "v2", to: "c" },
            { from: "c", to: "d" },  { from: "d", to: "v3" },
            { from: "v3", to: "e" },
          ],
        },
      }),
    });
    return r.json();
  });
  check(
    "hardcoded-true cheat is rejected with forbidden-output error",
    cheatResp.correct === false &&
      (cheatResp.error ?? "").includes("forbidden"),
    cheatResp.error,
  );

  // Canonical scanf("%d %d", &a, &b) solution passes
  const isEqResp = await page.evaluate(async () => {
    const nodes = [];
    const edges = [];
    let last = null;
    let uid = 0;
    const g = id => { const n = `n${++uid}`; nodes.push({ id: n, kind: "gadget", gadgetId: id }); if (last) edges.push({ from: last, to: n }); last = n; };
    const v = val => { const n = `v${++uid}`; nodes.push({ id: n, kind: "imm", value: val }); if (last) edges.push({ from: last, to: n }); last = n; };
    g("pop_rdi"); v("0x403000");
    g("pop_rsi"); v("0x65757274");
    g("store_rdi_rsi");
    g("pop_rdi"); v("0x403020");
    g("pop_rsi"); v("0x6425206425");
    g("store_rdi_rsi");
    g("pop_rdi"); v("0x403020");
    g("pop_rsi"); v("0x403010");
    g("pop_rdx"); v("0x403018");
    g("call_scanf");
    g("pop_rdi"); v("0x403010");
    g("load_rax_rdi");
    g("mov_rsi_rax");
    g("pop_rdi"); v("0x403018");
    g("load_rax_rdi");
    g("mov_rdi_rax");
    g("mov_rax_rsi");
    g("sub_rax_rdi");
    g("pop_rdi"); v("0x403000");
    g("add_rax_rdi");
    g("mov_rdi_rax");
    g("call_puts");
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: "isEqual",
        flowchart: { startNodeId: nodes[0].id, nodes, edges },
      }),
    });
    return r.json();
  });
  check(
    "scanf(%d %d) isEqual solution passes all 9 test cases",
    isEqResp.correct === true && typeof isEqResp.flag === "string",
    JSON.stringify(isEqResp),
  );

  // --- Console errors ---
  console.log("[13] console error check");
  const significantErrors = consoleErrors.filter(
    e =>
      !e.includes("ResizeObserver") &&
      !e.includes("favicon") &&
      !e.includes("DevTools"),
  );
  check(
    "no significant console errors",
    significantErrors.length === 0,
    significantErrors.slice(0, 3).join(" | "),
  );

  await page.screenshot({ path: `${OUT}/04-challenge.png`, fullPage: true });

  console.log("\n=== summary ===");
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`${pass}/${results.length} passed, ${fail} failed`);
  console.log(`screenshots in ${OUT}`);
  process.exit(fail === 0 ? 0 : 1);
} finally {
  await browser.close();
}
