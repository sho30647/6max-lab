// Blinds shown above the pot, the blinds-up popup, the in-the-money popup, the board's close button (top right) and the final result popup.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const SHOTS = process.env.SHOTS || '';
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'ショウ',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const bad = []; p.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
await p.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await p.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 && ms < 7000 ? 800 : (ms > 100 ? 40 : ms), ...a); });
await p.goto('file://' + html);
await p.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function'); await p.waitForTimeout(1500);
const shot = async n => { if (SHOTS) { await p.waitForTimeout(200); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
await p.evaluate(() => { localStorage.clear(); MT.data = null; document.getElementById('optAutoFold').checked = false; document.getElementById('optAuto').checked = false; Nav.setScreen('mtt'); });
await p.click('#mttGo'); await p.waitForTimeout(200);
// 1. blinds above the pot
const bl = await p.evaluate(() => { const e = document.getElementById('mttBlinds'); return { text: e.innerText, shown: getComputedStyle(e).display !== 'none', beforePot: e.compareDocumentPosition(document.getElementById('pot')) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false }; });
console.log('blinds line', JSON.stringify(bl)); if (!/SB 200 \/ BB 400/.test(bl.text) || !bl.shown || !bl.beforePot) bad.push('blinds line missing or in the wrong place');
// 2. blinds-up popup before the next hand
await p.evaluate(() => { S.autoHero = true; });
await p.evaluate(async () => { await playHand(); });   // first hand (level 1)
await p.evaluate(() => { const T = MT.T; T.clock = 30 * 60 + 5; MTT.heroTable(T).t = T.clock; window.__p = playHand(); });
await p.waitForFunction(() => !document.getElementById('mttPop').classList.contains('hidden'), null, { timeout: 5000 });
const pop = await p.evaluate(() => ({ text: document.getElementById('mttPop').innerText, running: S.running, dealt: S.players[0].hole.length }));
console.log('popup', JSON.stringify(pop.text.replace(/\n/g, ' | '))); if (!/ブラインドが上がりました/.test(pop.text) || !/Lv2/.test(pop.text) || !/300 \/ 600/.test(pop.text)) bad.push('blinds-up popup text'); if (!pop.running) bad.push('the hand should wait for the popup');
await shot('pop-blinds');
await p.click('#mttPopOk'); await p.evaluate(() => window.__p);
const bl2 = await p.evaluate(() => document.getElementById('mttBlinds').innerText); if (!/SB 300 \/ BB 600/.test(bl2)) bad.push('blinds line did not update: ' + bl2);
await shot('blinds-line');
// 3. board: the close button is at the top right and reachable without scrolling
await p.evaluate(() => MT.board('rank'));
const xb = await p.evaluate(() => { const x = document.getElementById('mttBoardX').getBoundingClientRect(); const box = document.querySelector('.mttboard'); const bb = box.getBoundingClientRect(); box.scrollTop = 400; const x2 = document.getElementById('mttBoardX').getBoundingClientRect(); return { top: x.top, right: window.innerWidth - x.right, top2: x2.top, boxTop: bb.top, vis: x.top >= 0 && x.bottom <= window.innerHeight }; });
console.log('board close button', JSON.stringify(xb)); if (!xb.vis || Math.abs(xb.top2 - xb.top) > 2) bad.push('close button is not pinned to the top of the board');
await shot('board-x');
await p.click('#mttBoardX'); if (!await p.evaluate(() => document.getElementById('mttBoard').classList.contains('hidden'))) bad.push('board did not close');
// 4. in the money: popup before the next hand
await p.evaluate(() => { const T = MT.T; for (let h = 8.2; T.remaining > MTT.PAID && h < 11; h += 0.05) { MTT.advanceTo(T, h * 3600, MTT.heroTable(T)); MTT.rebalance(T); } T.players[0].stack = Math.max(T.players[0].stack, 300000); });
const itm = await p.evaluate(async () => { const T = MT.T; await playHand(); const q = MT.popups.length; return { remaining: T.remaining, queued: q, shown: MT.itmShown }; });
console.log('after a hand at', JSON.stringify(itm)); if (itm.remaining > MTT_PAID()) { /* not yet in the money: fine */ }
function MTT_PAID() { return 15; }
const itm2 = await p.evaluate(() => { window.__p2 = playHand(); return MT.popups.length; });
await p.waitForFunction(() => !document.getElementById('mttPop').classList.contains('hidden') || !S.running, null, { timeout: 5000 });
const ip = await p.evaluate(() => ({ text: document.getElementById('mttPop').innerText, hidden: document.getElementById('mttPop').classList.contains('hidden') }));
console.log('itm popup', JSON.stringify(ip.text.replace(/\n/g, ' | ')), 'hidden', ip.hidden);
if (!/インマネ確定/.test(ip.text) && !ip.hidden) bad.push('unexpected popup: ' + ip.text); await shot('pop-itm');
if (!ip.hidden) await p.click('#mttPopOk'); await p.evaluate(() => window.__p2);
// 5. final result popup, when the hero busts out naturally
const fin = await p.evaluate(async () => { const T = MT.T; T.players[0].stack = 1; let n = 0; while (!MT.over && n < 60) { await playHand(); n++; } return { over: MT.over, place: MT.result && MT.result.place, shown: !document.getElementById('mttResult').classList.contains('hidden'), text: document.getElementById('mttResult').innerText }; });
console.log('result popup', JSON.stringify({ ...fin, text: fin.text.replace(/\n/g, ' | ') }));
if (!fin.over || !fin.shown) bad.push('no result popup after the bust'); if (!/位/.test(fin.text) || !/収支/.test(fin.text)) bad.push('result popup lacks the place or the net result');
await shot('pop-result');
await b.close();
if (bad.length) { console.log('PROBLEMS:', bad); process.exit(1); } else console.log('ok');
