// Writes docs/trace_samples.md: one explanation of the new bot's decision trace (docs/postflop_spec.md §12) for every node kind, from played hands
// (all seats on the new bot, so every street and line shows up). For a betting node a hand that bets is preferred; a multiway pot and a hand-over
// to the old bot are added.
// Usage: node tests/spec-samples.mjs [deals=200] [out=docs/trace_samples.md]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { openGame } from './spec-harness.mjs';
const N = +process.argv[2] || 200;
const OUT = process.argv[3] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/trace_samples.md');
const { browser, page, errors } = await openGame();
const out = await page.evaluate(async (N) => {
  for (let d = 0; d < N; d++) { S.players.forEach(p => { p.ver = 'spec'; }); S.resetStacks = true; S.button = d % 6; Store.hands.length = 0; __seed(31337 + d * 11); await playHand(); }
  const recs = __hands.flatMap(h => h.records);
  const pickOne = (f, pref) => recs.filter(f).sort((a, b) => (pref(b) ? 1 : 0) - (pref(a) ? 1 : 0))[0];
  const acted = r => r.applied && r.applied.act !== 'check' && r.applied.act !== 'fold';
  const want = [
    ['CB・バレル（cbet）', r => !r.other.fallback && r.step0.nodeKind === 'cbet' && r.step0.nPlayers === 2, acted],
    ['ドンク（donk）', r => !r.other.fallback && r.step0.nodeKind === 'donk', r => false],
    ['プローブ（probe）', r => !r.other.fallback && r.step0.nodeKind === 'probe', acted],
    ['ディレイド（delayed）', r => !r.other.fallback && r.step0.nodeKind === 'delayed', acted],
    ['スタブ（stab：アグレッサーのチェックを受けて）', r => !r.other.fallback && r.step0.nodeKind === 'stab', acted],
    ['被ベット（facingBet）', r => !r.other.fallback && r.step0.nodeKind === 'facingBet', r => r.applied && r.applied.act === 'call'],
    ['被レイズ（facingRaise）', r => !r.other.fallback && r.step0.nodeKind === 'facingRaise', r => true],
    ['リバーのベット判断', r => !r.other.fallback && r.street === 3 && r.step0.toCall === 0, acted],
    ['マルチウェイ（3人以上）', r => !r.other.fallback && r.step0.nPlayers > 2, acted],
    ['旧ボットに任せた判断', r => !!r.other.fallback, r => true]
  ];
  return want.map(([title, f, pref]) => { const r = pickOne(f, pref); return { title, text: r ? SpecBot.explain(r).text : null, und: r ? SpecBot.explain(r).undefined : [] }; });
}, N);
let md = '# 新ボットの判断トレースの説明文（サンプル）\n\n';
md += '指示書12章の形式で、ノード種別ごとに1例ずつ載せています。生成方法は `node tests/spec-samples.mjs` です。全席を新ボットにして、固定の乱数で ' + N + ' 配牌を打ち、各種別の最初の例を取りました。ベットする局面では、ベットした例を優先しています。\n\n';
md += 'カードは ♠♥♦♣ で表します。金額の bb はビッグブラインドの枚数、パーセントは特に断りがなければポットに対する割合です。説明文はすべて、判断のときに記録した数値だけからテンプレートで作っています。\n\n';
for (const x of out) {
  md += `## ${x.title}\n\n`;
  md += x.text ? '```text\n' + x.text + '\n```\n\n' : '（この ' + N + ' 配牌では出現しませんでした）\n\n';
  if (x.und.length) md += '**説明テンプレート未定義：** ' + x.und.join(', ') + '\n\n';
}
fs.writeFileSync(OUT, md);
console.log('wrote', OUT, out.map(x => x.title + (x.text ? '' : ' (none)')).join(' / '));
if (errors.length) console.log('page errors:', errors.slice(0, 3));
await browser.close();
