// The new bot's review screen (ring game, phone width): the settings switch turns the new bot on and off; after a hand (never during one) the button
// 「ボットの判断を見る」 opens the list of the bot's decisions, a row opens its explanation (「結論：」...); the hand history opens the same list
// (or says the record is not in this browser any more); with the switch off the button never shows.
import { openGame } from './spec-harness.mjs';
const { browser, page, errors } = await openGame();
await page.setViewportSize({ width: 390, height: 844 });
const fails = []; const check = (ok, what) => { if (!ok) fails.push(what); console.log(ok ? 'ok  ' : 'FAIL', what); };

// the switch: off by default, reflects specBotOn(), calls setSpecBot
const sw = await page.evaluate(() => { localStorage.removeItem('sixmaxlab_specbot'); const c = document.getElementById('optSpec'); return { exists: !!c, checked: c ? c.checked : null, on: specBotOn() }; });
check(sw.exists && sw.checked === false && sw.on === false, 'the settings have the switch, off by default ' + JSON.stringify(sw));
await page.evaluate(() => { Nav.setScreen('ring'); document.getElementById('navSet').click(); });
await page.click('#optSpec');
check(await page.evaluate(() => specBotOn() && document.getElementById('optSpec').checked), 'turning the switch on calls setSpecBot(true)');
await page.click('#setBack');

// play until a hand has decisions of the new bot; the button is never there while a hand runs
const play = await page.evaluate(async () => {
  __seed(21); window.__inHand = []; const oa = SpecBot.onAction;
  SpecBot.onAction = function () { window.__inHand.push(!!document.getElementById('btnSpecReview')); return oa.apply(this, arguments); };
  let n = 0;
  for (; n < 60; n++) { await playHand(); if (SpecBot.lastHand && SpecBot.lastHand.records.length >= 2) break; }
  SpecBot.onAction = oa;
  return { n: n + 1, recs: SpecBot.lastHand ? SpecBot.lastHand.records.length : 0, shownInHand: window.__inHand.filter(Boolean).length, actions: window.__inHand.length };
});
check(play.recs > 0, 'a hand with the new bot\'s decisions within 60 hands ' + JSON.stringify(play));
check(play.actions > 0 && play.shownInHand === 0, 'no review button while a hand runs ' + JSON.stringify(play));
check(await page.evaluate(() => !!document.getElementById('btnSpecReview')), 'after the hand the review button is shown');

// the list and the explanation
await page.click('#btnSpecReview');
const list = await page.evaluate(() => { const o = document.getElementById('specReview'); const rows = [...o.querySelectorAll('.srRow')];
  return { open: !o.classList.contains('hidden'), rows: rows.length, recs: SpecBot.lastHand.records.length, firstRow: rows[0] ? rows[0].textContent : '', textShown: o.querySelectorAll('.srText:not(.hidden)').length }; });
check(list.open && list.rows === list.recs && /結論：/.test(list.firstRow) && list.textShown === 0, 'the list has one row per decision with its conclusion, explanations closed ' + JSON.stringify(list));
await page.click('#specReview .srRow');
const txt = await page.evaluate(() => { const t = document.querySelector('#specReview .srText:not(.hidden)'); const exp = SpecBot.explain(SpecBot.lastHand.records[0]).text;
  const box = document.querySelector('#specReview .srBox').getBoundingClientRect();
  return { shown: !!t, same: !!t && t.textContent === exp, pre: t ? getComputedStyle(t).whiteSpace : '', has: !!t && t.textContent.includes('結論：'),
    fits: box.right <= innerWidth + 0.5 && box.left >= -0.5, noXScroll: !!t && t.scrollWidth <= t.clientWidth + 1 }; });
check(txt.shown && txt.same && txt.has && txt.pre === 'pre-wrap', 'a row opens its explanation text as it is ' + JSON.stringify(txt));
check(txt.fits && txt.noXScroll, 'the explanation fits the phone width ' + JSON.stringify(txt));
await page.click('#specReview .srRow');
check(await page.evaluate(() => !document.querySelector('#specReview .srText:not(.hidden)')), 'pressing the row again closes it');
await page.click('#specReviewClose');
check(await page.evaluate(() => document.getElementById('specReview').classList.contains('hidden')), 'the close button closes the list');

// the next hand: the button goes away as soon as it starts
const gone = await page.evaluate(async () => { const p = playHand(); await new Promise(r => setTimeout(r, 0)); const during = !!document.getElementById('btnSpecReview') && S.running; await p; return { during }; });
check(!gone.during, 'the button is gone once the next hand starts');

// the hand history: the hand's record keeps the id, the detail opens the same list
const hist = await page.evaluate(async () => {
  document.querySelector('#tab-ring .subtabs button[data-tab="hist"]').click(); await new Promise(r => setTimeout(r, 50));
  const b = document.querySelector('#histBody [data-specrev]'); if (!b) return { button: false };
  const showdownIdLeak = [...document.querySelectorAll('#histBody .hitem .log')].some(l => /ショーダウン: \d+-\d+/.test(l.textContent));
  b.click(); const o = document.getElementById('specReview');
  const r = { button: true, open: !o.classList.contains('hidden'), rows: o.querySelectorAll('.srRow').length, showdownIdLeak };
  document.getElementById('specReviewClose').click();
  // a hand whose traces are not in this browser any more
  const id = b.dataset.specrev; localStorage.removeItem('spec_traces__' + UserGate.safe(UserGate.get() || '')); SpecBot.lastHand = null;
  b.click(); r.gone = o.querySelector('.srEmpty') ? o.querySelector('.srEmpty').textContent : ''; r.goneRows = o.querySelectorAll('.srRow').length;
  document.getElementById('specReviewClose').click(); return r; });
check(hist.button && hist.open && hist.rows > 0, 'the hand history opens the bot\'s decisions ' + JSON.stringify(hist));
check(/残っていません/.test(hist.gone || '') && hist.goneRows === 0, 'a hand whose record is gone says so ' + JSON.stringify(hist));
check(await page.evaluate(() => statsHands().every(h => !/^\d+-\d+$/.test(h.sh || ''))), 'the showdown hands (h.sh) are kept: the trace id has its own key (h.spt)');
check(hist.showdownIdLeak === false, 'the history does not show the trace id as the showdown hands');
check(await page.evaluate(() => [...document.querySelectorAll('#histBody .hitem')].every(d => { const h = statsHands().find(x => '#' + x.id === d.querySelector('.id').textContent); return !h || !!d.querySelector('[data-specrev]') === !!h.spt; })), 'the history button only on hands with the new bot\'s record');

// the switch off: the bots go back to the old logic, no button after the hands
await page.evaluate(() => { Nav.setScreen('ring'); document.getElementById('navSet').click(); });
await page.click('#optSpec'); await page.click('#setBack');
const off = await page.evaluate(async () => { let shown = 0, recs = 0; for (let k = 0; k < 8; k++) { await playHand(); if (document.getElementById('btnSpecReview')) shown++; recs += SpecBot.lastHand ? SpecBot.lastHand.records.length : 0; } return { on: specBotOn(), shown, recs }; });
check(!off.on && off.shown === 0 && off.recs === 0, 'switch off: no new bot, no review button ' + JSON.stringify(off));
check(!errors.length, 'no page errors ' + JSON.stringify(errors.slice(0, 3)));
await browser.close();
console.log(fails.length ? 'FAIL ' + fails.length : 'ok all');
process.exit(fails.length ? 1 : 0);
