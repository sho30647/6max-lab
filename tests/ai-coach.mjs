// AI coach (dev only): the demo build gets the coach, production index.html does not, and the coach's tools read the real game state.
// A fake window.claude.sample stands in for the Artifact capability.   usage: node tests/ai-coach.mjs
import { createRequire } from 'module';
import { execFileSync } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const demo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicoach-')), 'demo.html');
execFileSync('python3', [path.join(root, 'tools/build-demo.py'), demo]);
const bad = []; const ok = (c, m) => { if (!c) bad.push(m); };

// 1) production has no trace of the coach
const prod = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
ok(!/ai-coach|aiFab|AI_COACH|use\(['"]sample['"]\)/.test(prod), 'index.html must not reference the AI coach');

const FAKE = `window.__asked=null; window.claude={use:async n=>n==='sample'?Object.assign(async(input,opts)=>{window.__asked={input,tools:opts.tools.map(t=>t.name)};opts.onText({text:'考え中の途中'});return{text:'FAKE-ANSWER',truncated:false};},{}):null};`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
async function open(withClaude) {
  const p = await browser.newPage({ viewport: { width: 420, height: 900 } });
  p.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
  await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  if (withClaude) await p.addInitScript(FAKE);
  await p.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, Math.min(ms || 0, 30), ...a); });
  await p.goto('file://' + demo);
  await p.waitForFunction(() => typeof playHand === 'function' && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
  await p.waitForTimeout(1500);
  return p;
}

// 2) outside an Artifact (no window.claude) the coach does nothing
let p = await open(false);
ok(!(await p.$('#aiFab')), 'no button without window.claude');
await p.close();

// 3) inside an Artifact: button, panel, context, tools
p = await open(true);
await p.waitForSelector('#aiFab', { timeout: 5000 });
// play until the hero acts on the flop with nothing to call
const found = await p.evaluate(async () => {
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  for (let g = 0; g < 80; g++) {
    S.autoHero = false; playHand();
    for (let t = 0; t < 400; t++) {
      await new Promise(r => setTimeout(r, 5));
      if (!S.running) break;
      if (S.heroResolve) {
        const h = S.players[0], toCall = S.currentBet - h.bet;
        if (S.street >= 1 && toCall === 0 && S.players.filter(q => !q.folded).length >= 2) return true;
        heroChoose(toCall > 0 ? (S.street === 0 ? { act: 'call' } : { act: 'fold' }) : { act: 'check' });
      }
    }
  }
  return false;
});
ok(found, 'could not reach a flop spot with the hero to act');
const ctx = await p.evaluate(() => AI_COACH.tableContext());
const hole = await p.evaluate(() => S.players[0].hole.map(cardStr).join(' '));
ok(ctx && ctx.includes(hole) && ctx.includes('ポット') && ctx.includes('ボード'), 'context holds hole cards, pot and board: ' + ctx);
ok(!(await p.evaluate(() => S.players.slice(1).some(q => q.hole.length && AI_COACH.tableContext().includes(q.hole.map(cardStr).join(' '))))), 'context must not reveal bot hole cards');

const lookup = await p.evaluate(() => AI_COACH.tools.find(t => t.name === 'preflop_lookup').execute({ hand: 'a5s', spot: 'open' }));
ok(lookup.freq && lookup.freq.BTN && lookup.freq.BTN.raise >= lookup.freq.UTG.raise, 'A5s opens at least as often on BTN as UTG: ' + JSON.stringify(lookup));
const vs = await p.evaluate(() => AI_COACH.tools.find(t => t.name === 'preflop_lookup').execute({ hand: 'AKo', spot: 'vsOpen', position: 'BB', versus: ['CO'] }));
ok(vs.freq && vs.freq.CO && vs.freq.CO.raise > 0, 'AKo 3bets from BB vs CO: ' + JSON.stringify(vs));
ok((await p.evaluate(() => AI_COACH.tools.find(t => t.name === 'preflop_lookup').execute({ hand: 'xx' }))).error, 'bad hand is reported');

const br = await p.evaluate(() => AI_COACH.tools.find(t => t.name === 'bot_response').execute({ sizes_pct_of_pot: [33, 75, 150] }));
ok(br.opponents && br.opponents.length >= 1, 'bot_response lists opponents: ' + JSON.stringify(br));
for (const o of br.opponents || []) {
  const c = o.by_size.map(x => x.est_continue_pct_of_range);
  ok(c[0] >= c[1] && c[1] >= c[2], o.position + ' continues less as the bet grows: ' + c);
  ok(o.by_size[2].pot_odds_needed_pct > o.by_size[0].pot_odds_needed_pct, 'bigger bet needs more equity');
  ok(!/hole|cards/i.test(JSON.stringify(o)), 'no hole cards in bot_response');
}

// 4) ask through the panel
await p.click('#aiFab');
await p.fill('#aiQ', 'このハンドは他のポジションだと？'); await p.click('#aiSend');
await p.waitForFunction(() => document.querySelector('#aiLog .a')?.textContent === 'FAKE-ANSWER', null, { timeout: 5000 }).catch(() => bad.push('answer not shown'));
const asked = await p.evaluate(() => window.__asked);
ok(asked && asked.input.includes(hole) && asked.input.includes('他のポジション') && asked.tools.join() === 'preflop_lookup,bot_response', 'prompt carries the table and both tools: ' + (asked && asked.tools));
await p.screenshot({ path: path.join(os.tmpdir(), 'aicoach.png') });
await browser.close();
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('OK: AI coach tests passed');
