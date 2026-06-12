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
await page.select("select", "hello_world_noconst");
await new Promise(r => setTimeout(r, 400));
await page.screenshot({
  path: "/home/soctest/hz-u18_2026/e2e/shots/05-badchars.png",
  fullPage: true,
});
await browser.close();
console.log("captured 05-badchars.png");
