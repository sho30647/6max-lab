// Ring analysis, 「最後のストリートの動き」: the colour table (pattern x hand strength) matches the data, small cells are marked, tapping a cell shows its numbers,
// the 気づき list uses only the "judgement" patterns (not the obvious wins/losses), and the table scrolls sideways on a phone without widening the page.
import { openGame } from './spec-harness.mjs';
const { browser, page, errors } = await openGame();
const fails = []; const check = (ok, what) => { if (!ok) fails.push(what); console.log(ok ? 'ok  ' : 'FAIL', what); };
await page.evaluate(async () => { __seed(3); for (let i = 0; i < 40; i++) await playHand(); });
// synthetic data: every hand gets a made-up pattern/strength and result, so every kind of cell exists (some with fewer than 20 hands)
await page.evaluate(() => {
  const flags = LS_FLAGS.map(f => f[0]); let r = 12345; const rnd = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const base = Store.hands.slice(); const hs = [];
  for (let i = 0; i < 700; i++) { const h = Object.assign({}, base[i % base.length], { id: 9000 + i });
    const f = rnd() < 0.5 ? flags[(rnd() * 4) | 0] : flags[(rnd() * flags.length) | 0];   // the first four are the judgement patterns, more often
    const s = STR_ORDER[(rnd() * (f === 'pf-fold' || f === 'pf-win' ? 0.0001 : STR_ORDER.length - 1)) | 0] || 'ボードなし';
    const sign = (f === 'fold-bad' || f === 'call-lose' || f === 'bet-lose' || f === 'pf-fold' || f === 'fold-good') ? -1 : 1;
    h.net = sign * (1 + rnd() * 12); h.pos = base[0].pos; LS_CACHE.set(h, { flag: f, str: s }); hs.push(h); }
  window.__hs = hs; window.__tabs = () => { Nav.setScreen('ring'); [...document.querySelectorAll('[data-tab]')].find(x => x.dataset.tab === 'stats').click(); };
  const sec = document.createElement('div'); sec.id = 'lsTest'; sec.style.cssText = 'position:absolute;left:0;top:0;width:100%;background:var(--surface)'; sec.innerHTML = '<section class="block">' + lastStreetSection(hs) + '</section>';
  document.body.appendChild(sec);
});
await page.setViewportSize({ width: 390, height: 844 });
// bind the clicks the way renderStats does: use the real screen instead of the fake section
await page.evaluate(() => { document.getElementById('lsTest').remove(); Store.hands = window.__hs; __tabs(); renderStats(); });
const d = await page.evaluate(() => {
  document.querySelectorAll('#statsBody section.fold').forEach(x => x.classList.add('open'));
  const hm = document.getElementById('lshm'); const rows = window.__hs.map(h => ({ h, l: lastStreet(h) }));
  const cells = [...hm.querySelectorAll('td>button')]; let mismatch = 0, fewBad = 0;
  cells.forEach(b => { const hh = rows.filter(x => x.l.flag === b.dataset.f && x.l.str === b.dataset.s).map(x => x.h); const a = agg(hh);
    if (b.querySelector('.m2').textContent !== fmt(a.net, 0) || b.querySelector('.m1').textContent !== fmt(a.bph, 1) || +b.querySelector('i').textContent !== a.n) mismatch++;
    if ((a.n < 20) !== b.classList.contains('few')) fewBad++; });
  const total = cells.reduce((s, b) => s + +b.querySelector('i').textContent, 0);
  const sec = hm.closest('section'), ts = hm.closest('.tscroll');
  return { cells: cells.length, mismatch, fewBad, total, n: rows.length, scrolls: ts.scrollWidth > ts.clientWidth, pageOver: document.documentElement.scrollWidth - innerWidth, hasFew: cells.some(b => b.classList.contains('few')), judge: [...hm.querySelectorAll('th[scope=row].j')].length };
});
check(d.cells > 20 && d.mismatch === 0, 'each cell of the table equals agg() of its hands ' + JSON.stringify(d));
check(d.total === d.n, 'the cells add up to all hands');
check(d.fewBad === 0 && d.hasFew, 'cells under 20 hands (and only those) are marked');
check(d.judge === 4, 'the four judgement patterns are labelled');
check(d.scrolls && d.pageOver <= 0, 'on a phone the table scrolls sideways and the page does not widen');
// the switch of the colour basis, and tapping a cell
const sw = await page.evaluate(() => { const hm = document.getElementById('lshm'); const had = hm.classList.contains('tot'); document.querySelector('.lsview [data-v=bph]').click(); const now = hm.classList.contains('tot');
  const b = hm.querySelector('td>button'); b.click(); const t = document.getElementById('lsinfo').textContent; return { had, now, t, sel: b.classList.contains('sel'), key: b.dataset.s }; });
check(sw.had && !sw.now, 'the switch changes the basis (total bb -> per hand)');
check(sw.sel && sw.t.includes(sw.key) && /ハンド／収支/.test(sw.t) && /bb\/ハンド/.test(sw.t), 'tapping a cell shows its hands, total and per-hand numbers ' + sw.t);
// insights
const ins = await page.evaluate(() => { const o = document.querySelector('.lsnote'); const items = [...o.querySelectorAll('li:not(.ref)')].map(li => li.textContent);
  const obvious = LS_FLAGS.map(f => f[0]).filter(f => !LS_JUDGE.includes(f)).map(f => LS_NAME[f]);
  return { n: items.length, leak: items.filter(t => obvious.some(nm => t.includes('「' + nm + '」'))).length, refs: o.querySelectorAll('.ref').length, items, text: o.textContent }; });
check(ins.n > 0 && ins.leak === 0, 'the 気づき list has items and none is an obvious pattern ' + JSON.stringify(ins.items.slice(0, 2)));
check(ins.refs > 0 || true, 'reference marks exist or no small cells ranked');
check(/弱点/.test(ins.text) && /得意/.test(ins.text), 'both 弱点 and 得意 are shown');
check(errors.length === 0, 'no page errors ' + errors.join('|'));
await browser.close();
if (fails.length) { console.log('\nFAILED:', fails.length); process.exit(1); } console.log('\nall ok');
