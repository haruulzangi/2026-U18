const puppeteer = require('puppeteer');
const FLAG2 = 'HZU18{bl1nd_x55_m0ng0l_t4l1in_n4r}';
const BASE = process.env.BOT_BASE || 'http://127.0.0.1:3000';
let browser = null;

async function init() {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu',
           '--disable-web-security'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  console.log('[BOT] Browser launched');
}

async function visitReport(sid, reportId) {
  if (!browser) await init();
  let page;
  try {
    page = await browser.newPage();

    // Set cookie before navigation
    await page.setCookie({
      name: 'secret',
      value: FLAG2,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    });

    // Log network requests for debugging
    page.on('request', req => {
      if (req.url().includes('/hook/')) console.log('[BOT] XSS fired! ->', req.url());
    });

    const url = `${BASE}/challenge/admin/report/${reportId}?sid=${sid}`;
    console.log('[BOT] Visiting:', url);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });

    // Verify cookie is accessible
    const cookies = await page.cookies();
    console.log('[BOT] Cookies on page:', cookies.map(c => c.name + '=' + c.value.substring(0,20)).join(', '));

    // Wait for XSS to execute
    await new Promise(r => setTimeout(r, 5000));
  } catch(e) {
    console.error('[BOT] Error:', e.message);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { visitReport, init };
