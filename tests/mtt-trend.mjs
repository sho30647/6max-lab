// MTT chip trend: the graph during play (推移 button) and after the tournament (tap a row of 最近の結果).
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, '../index.html');
const SHOTS = process.env.SHOTS || '';
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
const bad = [];
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push('console: ' + m.text().slice(0, 200)); });
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { localStorage.removeItem(MT.key()); MT.data = null; document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; Nav.setScreen('mtt'); });
await page.click('#mttGo'); await page.waitForTimeout(200);
// before any hand: a message, no graph
await page.click('#mttTrendBtn');
if (await page.locator('#mttBoard .trsvg').count()) bad.push('graph shown with no hands');
await page.click('#mttBoardX');
// play 25 hands, then open the graph in play
const n = await page.evaluate(async () => { S.autoHero = true; for (let i = 0; i < 25 && !MT.over; i++) await playHand(); S.autoHero = false; return MT.hands.length; });
await page.click('#mttTrendBtn');
const live = await page.evaluate(() => ({ svg: !!document.querySelector('#mttBoard .trsvg'), lines: document.querySelectorAll('#mttBoard .trsvg polyline').length, pts: MT.trendPts(MT.id), h0: MT.hands[0].st, last: MT.hands[MT.hands.length - 1] }));
if (!live.svg || live.lines !== 2) bad.push('live graph: ' + JSON.stringify({ svg: live.svg, lines: live.lines }));
if (live.pts.you.length !== n + 1) bad.push('points ' + live.pts.you.length + ' vs hands ' + n);
if (live.pts.you[0] !== 100000) bad.push('first point ' + live.pts.you[0]);
if (live.pts.you[n] !== live.last.en) bad.push('last point is not the final stack');
// each hand starts where the previous one ended
const chain = await page.evaluate(() => MT.hands.some((h, i) => i && h.st !== MT.hands[i - 1].en && !MT.hands[i - 1].moved));
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trend-live.png') });
// hover readout
const box = await page.locator('#mttBoard .trsvg').boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
const rd = await page.textContent('#mttTrRead'); if (!/ハンド目/.test(rd)) bad.push('no readout: ' + rd);
await page.click('#mttBoardX');
// finish the tournament, back to the lobby, tap the row
await page.evaluate(async () => { S.autoHero = true; MT.forfeit; const t = Date.now(); while (!MT.over && Date.now() - t < 100000) await playHand(); });
await page.evaluate(() => { document.getElementById('mttResult').classList.add('hidden'); MT.on = false; ringRestore(); MT.view(); });
await page.waitForSelector('.trrow');
await page.click('.trrow');
const after = await page.evaluate(() => ({ svg: !!document.querySelector('#mttBoard .trsvg'), title: document.querySelector('#mttBoard h3').textContent }));
if (!after.svg) bad.push('past graph missing');
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'trend-past.png') });
console.log(JSON.stringify({ hands: n, live: live.lines, chain, after }));
await browser.close();
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('mtt-trend OK');
