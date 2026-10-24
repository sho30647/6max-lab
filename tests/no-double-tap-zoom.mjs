// Double-tap zoom must be off: html carries touch-action:manipulation (pinch still works; tap delay removed).
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
await page.goto('file://' + html);
const ta = await page.evaluate(() => getComputedStyle(document.documentElement).touchAction);
console.log(ta === 'manipulation' ? 'ok' : 'FAIL', 'html touch-action =', ta);
await browser.close();
process.exit(ta === 'manipulation' ? 0 : 1);
