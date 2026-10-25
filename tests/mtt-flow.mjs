// MTT flow: bust -> the hand stays on the table -> 「結果へ進む」 -> result; champion screen; bankroll 300,000 and the part-time jobs; end-of-hand action labels.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
await page.waitForTimeout(1500);
const shot = process.argv[2];   // optional: directory for screenshots
const fail = []; const ok = (c, m) => { if (!c) fail.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
// 1) end-of-hand action labels on the felt (ring game)
await page.evaluate(() => { Nav.setScreen('ring'); });
const ring = await page.evaluate(async () => { document.getElementById('optAuto').checked = false; let seen = new Set(); for (let h = 0; h < 12; h++) { S.autoHero = true; await playHand(); document.querySelectorAll('.res small').forEach(e => seen.add(e.textContent)); } return [...seen]; });
ok(ring.includes('フォールド') && ring.some(x => /コール|チェック|ベット|レイズ|オールイン/.test(x)), 'end of hand shows what the others did: ' + ring.join(','));
// 1b) the strip under the table says how the hand ended: a showdown (who called) or a fold
const strips = await page.evaluate(async () => { document.getElementById('optAuto').checked = false; const seen = {}; const ex = {}; for (let h = 0; h < 60; h++) { S.autoHero = true; await playHand(); const e = document.getElementById('endStrip'); if (e.classList.contains('hidden')) { seen.hidden = (seen.hidden || 0) + 1; continue; } const tag = e.querySelector('.et').textContent; seen[tag] = (seen[tag] || 0) + 1; ex[tag] = e.innerText.replace(/\n/g, ' '); } return { seen, ex }; });
ok(strips.seen['ショーダウン'] > 0 && strips.seen['フォールドで決着'] > 0 && !strips.seen.hidden, 'end strip: ' + JSON.stringify(strips.seen));
ok(/→/.test(strips.ex['ショーダウン'] || '') && /フォールド/.test(strips.ex['フォールドで決着'] || ''), 'end strip texts: ' + JSON.stringify(strips.ex));
if (shot) await page.screenshot({ path: `${shot}/end-strip.png` });
// 2) bankroll
await page.evaluate(() => { localStorage.clear(); MT.data = null; });
let r = await page.evaluate(() => ({ b0: MT.load().bank0, bank: MT.bank() }));
ok(r.b0 === 300000 && r.bank === 300000, 'bankroll starts at 300,000 ' + JSON.stringify(r));
r = await page.evaluate(() => { MT.data = null; localStorage.setItem(MT.key(), JSON.stringify({ v: 1, bank0: 3000000, results: [{ t: 1, net: -50000, prize: 0, place: 90, bankAfter: 2950000 }], updated: 5 })); return { b0: MT.load().bank0, bank: MT.bank(), after: MT.load().results[0].bankAfter }; });
ok(r.b0 === 300000 && r.bank === 250000 && r.after === 250000, 'a saved 3,000,000 is cut to 300,000 and the balances follow ' + JSON.stringify(r));
// 3) part-time jobs
await page.evaluate(() => { MT.data = null; localStorage.clear(); const d = MT.load(); d.results.push({ t: 1, net: -280000, prize: 0, place: 90, bankAfter: 20000, hands: 5, level: 3 }); MT.save(); Nav.setScreen('mtt'); MT.lobby(); });
const jobs = await page.evaluate(() => [...document.querySelectorAll('[data-job]')].map(b => b.dataset.job + ':' + (document.getElementById('mttGo') ? (document.getElementById('mttGo').disabled ? 'dis' : 'en') : '-')));
ok(jobs.length === 3, 'three jobs are offered when the bankroll is below the fee ' + jobs.join(','));
for (const [k, amt] of [['izakaya', 50000], ['tutor', 100000], ['trial', 300000]]) {
  await page.evaluate(k => { MT.data = null; localStorage.clear(); const d = MT.load(); d.results.push({ t: 1, net: -280000, prize: 0, place: 90, bankAfter: 20000, hands: 5, level: 3 }); MT.save(); MT.lobby(); document.querySelector(`[data-job="${k}"]`).click(); }, k);
  const scene = await page.evaluate(() => !!document.querySelector('#mttResult svg.scene') && !document.getElementById('mttResult').classList.contains('hidden'));
  ok(scene, k + ': the scene is shown while working');
  if (shot && k !== 'x') await page.screenshot({ path: `${shot}/job-${k}.png` });
  await page.waitForFunction(() => document.getElementById('mttJobOk'), null, { timeout: 5000 });
  const after = await page.evaluate(() => { const b = MT.bank(); document.getElementById('mttJobOk').click(); return { b, hidden: document.getElementById('mttResult').classList.contains('hidden'), adj: MT.load().adj.length }; });
  ok(after.b === 20000 + amt && after.hidden && after.adj === 1, `${k}: +${amt} -> ${after.b}`);
}
// 4) bust: the hand is shown as usual, the button goes on to the result
const bust = await page.evaluate(async () => {
  localStorage.clear(); MT.data = null; Nav.setScreen('mtt'); MT.start(); const T = MT.T, tb = MTT.heroTable(T);
  MTT.occ(tb).forEach(s => { const p = T.players[tb.seats[s]]; p.stack = p.isHero ? 500 : 60000; });   // the hero is short; 500 = one blind + ante
  S.autoHero = true; let n = 0; const log = [];
  while (!MT.over && n++ < 60) { await playHand(); const h = T.players[0]; if (MT.over) break; if (h.stack < 1) break; }
  const hidden = document.getElementById('mttResult').classList.contains('hidden'), btn = document.getElementById('btnDeal') && document.getElementById('btnDeal').textContent;
  const labels = [...document.querySelectorAll('.res')].map(e => e.textContent).join('|');
  return { over: MT.over, hidden, btn, hands: n, labels };
});
ok(bust.over && bust.hidden && bust.btn === '結果へ進む', 'bust: no result popup yet, the button says 結果へ進む ' + JSON.stringify(bust));
if (shot) await page.screenshot({ path: `${shot}/bust-hand.png` });
await page.click('#btnDeal');
const res = await page.evaluate(() => !document.getElementById('mttResult').classList.contains('hidden') && !!document.querySelector('.mttres'));
ok(res, 'pressing the button opens the result');
await page.evaluate(() => document.getElementById('mttResClose').click());
// 5) champion
await page.evaluate(() => { MT.result = { id: 'x', t: Date.now(), place: 1, field: 100, buyIn: 50000, prize: 1100000, net: 1050000, hands: 321, level: 25, bankAfter: 1350000 }; MT.showResult(); });
const champ = await page.evaluate(() => ({ win: !!document.querySelector('.mttwin'), conf: document.querySelectorAll('.mwconf i').length, bg: document.getElementById('mttResult').classList.contains('winbg'), txt: document.querySelector('.mwt').textContent }));
ok(champ.win && champ.conf > 30 && champ.bg && champ.txt === '優勝！', 'champion screen ' + JSON.stringify(champ));
if (shot) { await page.waitForTimeout(1800); await page.screenshot({ path: `${shot}/champion.png` }); }
// 6) in the money: the popup when the money is reached, the result screen when the run ends in the money
await page.evaluate(() => { document.getElementById('mttResClose') && document.getElementById('mttResClose').click(); window.__noPopup = false; window.__pp = MT.popup({ k: 'IN THE MONEY', t: 'おめでとう！インマネ確定！', d: '残り15人', b: 'ここから先は賞金が確定です。いまの最低賞金は ¥100,000（15位）', ms: 9000, fx: 'itm' }); });
const pop = await page.evaluate(() => ({ cls: document.querySelector('.mttpop').className, conf: document.querySelectorAll('.mttpop .mwconf i').length, coin: !!document.querySelector('.mttpop .itmcoin'), txt: document.querySelector('.mttpop .pt').textContent }));
ok(/itm/.test(pop.cls) && pop.conf > 20 && pop.coin && /インマネ確定/.test(pop.txt), 'in-the-money popup is festive ' + JSON.stringify(pop));
if (shot) { await page.waitForTimeout(1200); await page.screenshot({ path: `${shot}/itm-popup.png` }); }
await page.evaluate(async () => { document.getElementById('mttPopOk').click(); await window.__pp; window.__noPopup = true; });
for (const pl of [2, 3, 7]) {
  const cheer = await page.evaluate(pl => { MT.result = { id: 'x', t: Date.now(), place: pl, field: 100, buyIn: 50000, prize: 160000, net: 110000, hands: 280, level: 21, bankAfter: 460000, itm: true, ft: pl <= 8 }; MT.showResult(); return { win: !!document.querySelector('.mttwin.itm'), bg: document.getElementById('mttResult').classList.contains('itmbg'), txt: document.querySelector('.mttwin.itm').innerText.replace(/\n/g, ' ') }; }, pl);
  ok(cheer.win && cheer.bg && cheer.txt.includes('おめでとう') && cheer.txt.includes(pl + '位'), `place ${pl} in the money: celebration ` + cheer.txt.slice(0, 60));
  if (shot && pl === 3) { await page.waitForTimeout(1500); await page.screenshot({ path: `${shot}/itm-result.png` }); }
  await page.evaluate(() => document.getElementById('mttResClose').click());
}
const out = await page.evaluate(() => { MT.result = { id: 'x', t: Date.now(), place: 40, field: 100, buyIn: 50000, prize: 0, net: -50000, hands: 90, level: 12, bankAfter: 200000, itm: false }; MT.showResult(); return { cheer: !!document.querySelector('.mttwin'), plain: !!document.querySelector('.mttres') }; });
ok(!out.cheer && out.plain, 'out of the money: the plain result');
await browser.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
process.exit(fail.length ? 1 : 0);
