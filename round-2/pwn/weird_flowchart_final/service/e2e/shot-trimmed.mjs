import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
await page.goto("http://localhost:8080", { waitUntil: "networkidle0" });
await page.evaluate(() => {
  Array.from(document.querySelectorAll("button")).find(
    b => b.textContent?.trim() === "Challenge",
  )?.click();
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({
  path: "/home/soctest/hz-u18_2026/e2e/shots/11-hello-world.png",
  fullPage: true,
});
await page.select("select", "square");
await new Promise(r => setTimeout(r, 400));
await page.screenshot({
  path: "/home/soctest/hz-u18_2026/e2e/shots/12-square-trimmed.png",
  fullPage: true,
});
await page.select("select", "isEqual");
await new Promise(r => setTimeout(r, 400));
await page.screenshot({
  path: "/home/soctest/hz-u18_2026/e2e/shots/13-isequal-trimmed.png",
  fullPage: true,
});
await browser.close();
console.log("captured 3 screenshots");
