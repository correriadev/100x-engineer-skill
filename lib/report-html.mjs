import { breakable, COPY_SCRIPT, esc, THEME } from './gallery.mjs';
import { afterFirstSentence, firstSentence, sameGround } from './text.mjs';
import { badgeWords, JUDGE_SAID_NO } from './look-first.mjs';
import { modern } from './runfile.mjs';
import { reasonParts, sharedState } from './why-not.mjs';

const LABEL = { ship: 'Ready to ship', fine: 'Fine', dud: 'Needs work', look: 'Look first' };
const CHIP = { done: 'Done', dropped: 'Dropped', open: 'Open' };

// Five sizes, each with a job: the title, the moment, a heading or the pitch, the text, and the small print.
const STYLE = `${THEME}
:root{--t-title:clamp(2rem,5vw,3.25rem);--t-moment:1.5rem;--t-head:1.25rem;--t-body:1rem;--t-small:.875rem}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--t-body)/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}
main{max-width:960px;margin:0 auto;padding:40px 24px 80px;display:flex;flex-direction:column;gap:36px}
.top{display:grid;gap:28px 40px;grid-template-columns:minmax(0,1fr) minmax(0,320px);grid-template-areas:"intro hero" "go hero";align-items:start}
.top.bare{grid-template-columns:minmax(0,1fr);grid-template-areas:"intro" "go"}
.top>*{min-width:0}
.intro{grid-area:intro}.hero{grid-area:hero}.go{grid-area:go;display:flex;flex-direction:column;gap:28px}
.eyebrow{font:700 var(--t-small)/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;color:var(--muted);margin:0 0 4px;display:flex;flex-wrap:wrap;align-items:center;gap:0 16px;min-height:44px}
.back{display:inline-flex;align-items:center;min-height:44px;color:var(--ink)}
h1{font:700 var(--t-title)/1.05 ui-serif,Georgia,"Times New Roman",serif;letter-spacing:-.02em;margin:0}
.badge,.chip{display:inline-block;font-weight:700;font-size:var(--t-small);letter-spacing:.04em;text-transform:uppercase;padding:2px 10px;border-radius:0;white-space:nowrap}
.badge{margin-top:12px;padding:4px 12px}
.ship{background:var(--ship-bg);color:var(--ship)}.fine,.look.warn{background:var(--fine-bg);color:var(--fine)}.dud,.look{background:var(--dud-bg);color:var(--dud)}
.done{background:var(--ship-bg);color:var(--ship)}.dropped{background:var(--fine-bg);color:var(--fine)}.open{background:var(--dud-bg);color:var(--dud)}
.pitch{font-size:var(--t-head);margin:16px 0 0;max-width:60ch}
.hero{margin:0;border:1px solid var(--line);border-radius:0;overflow:hidden;background:var(--line)}
.hero a{display:block;position:relative}
.hero img{display:block;width:100%;height:auto;max-height:520px;object-fit:cover;object-position:top center}
.full{position:absolute;right:10px;bottom:10px;padding:4px 10px;border-radius:0;background:var(--pick);color:var(--on-pick);font-size:var(--t-small);font-weight:700;pointer-events:none}
.hero.gone{display:flex;align-items:center;justify-content:center;min-height:200px;padding:24px;background:var(--panel);border-style:dashed;color:var(--muted);text-align:center}
h2{font:700 var(--t-head)/1.2 ui-serif,Georgia,serif;margin:0 0 12px}
p{margin:0}
.alert{border-left:6px solid var(--dud);background:var(--dud-bg);border-radius:0;padding:16px 20px}
.alert.warn{border-color:var(--fine);background:var(--fine-bg)}
.alert ul{max-width:none;font-weight:700}
.alert .reasons{font-weight:400;margin-top:6px}
.alert p.state{margin-top:6px;font-weight:400}
.alert p.state.left{font-weight:700}
.state{display:block;font-size:var(--t-small);color:var(--muted)}
.state.left{color:var(--dud);font-weight:700}
.momenttext{font-size:var(--t-moment);line-height:1.3;max-width:50ch}
.why{color:var(--muted);max-width:70ch}
code{font:var(--t-small)/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:0;padding:2px 8px}
.run{margin-bottom:16px;max-width:70ch}.run code{display:block;overflow-wrap:anywhere;user-select:all}
ol,ul{margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:6px;max-width:70ch}
.checks{display:grid;margin:0;border:1px solid var(--line);border-radius:0;background:var(--panel);overflow:hidden}
.checks div{display:grid;grid-template-columns:minmax(8rem,13rem) minmax(0,1fr);gap:4px 16px;padding:12px 16px;border-top:1px solid var(--line)}
.checks div:first-child{border-top:0}
.checks .bad{background:var(--dud-bg)}
.checks dt{color:var(--muted);font-size:var(--t-small)}
.checks dd{margin:0}
.checks .chip{margin-right:8px}
.asks{list-style:none;padding:0;max-width:none}
.asks li{display:flex;gap:12px;align-items:baseline}
.count{color:var(--muted);margin-bottom:12px}
details{border-top:1px solid var(--line);padding-top:8px}
summary{cursor:pointer;padding:10px 0;min-height:44px;display:flex;align-items:center;gap:8px}
summary::before{content:"\\25B8";color:var(--muted)}
details[open]>summary::before{content:"\\25BE"}
summary:focus-visible,a:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.meta{color:var(--muted);font-size:var(--t-small)}
a{color:inherit}
button{font:inherit;min-height:44px;padding:0 16px;border-radius:0;border:1px solid var(--pick);background:var(--pick);color:var(--on-pick);cursor:pointer;transition:opacity .15s ease-out}
button:hover{opacity:.85}
button:active{transform:translateY(1px)}
button:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin-bottom:16px}
.actions a{display:inline-flex;align-items:center;min-height:44px;padding:0 4px}
.hero a{display:block}
.hero a:focus-visible{outline-offset:-6px}
.checks details,.asksfold{border-top:0;padding-top:0}
.checks summary{padding:0;min-height:0;align-items:baseline}
.more p{margin:6px 0 0}
.asksfold{border-top:1px solid var(--line);padding-top:8px;margin-top:12px}
@media (max-width:700px){.top{grid-template-columns:minmax(0,1fr);grid-template-areas:"intro" "hero" "go"}.hero img{max-height:36vh}.checks div{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){button{transition:none}button:active{transform:none}}
`;

const list = (items, tag = 'ul') => `<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`;

// The reasons the judge gave, each with in a quieter voice what became of it. When they all ended the same way, that is said once under
// the list and not on every line, so the first reason is the first thing under the verdict.
function reasonList(reasons) {
  const together = sharedState(reasons);
  const items = reasons.map((reason) => {
    const { title, after } = reasonParts(reason);
    return `${esc(title)}${after && !together ? `<span class="state ${reason.state}">${esc(after)}</span>` : ''}`;
  });
  return `${list(items).replace('<ul>', '<ul class="reasons" aria-label="Why not ready to ship">')}${together ? `<p class="state ${reasons[0].state}">${esc(together)}</p>` : ''}`;
}

// A row says its fact in a line. What runs longer goes behind the line, so the table can be read down in one pass.
const LEAD = 220;
function lead(text) {
  if (text.length <= LEAD) return esc(text);
  const cut = text.lastIndexOf(' ', LEAD);
  const head = text.slice(0, cut > LEAD / 2 ? cut : LEAD).replace(/[\s,;:]+$/, '');
  return `<details class="more"><summary>${esc(head)}…</summary><p>${esc(text)}</p></details>`;
}

function row({ label, badge, text, link }) {
  const mark = badge ? `<span class="chip ${esc(badge.tone)}">${esc(badge.text)}</span>` : '';
  const open = link ? ` <a href="${esc(link.href)}">${esc(link.text)}</a>` : '';
  return `<div${badge?.tone === 'dud' ? ' class="bad"' : ''}><dt>${esc(label)}</dt><dd>${mark}${lead(text)}${open}</dd></div>`;
}

const askLine = (ask, text) => `<li><span class="chip ${esc(ask.status)}">${CHIP[ask.status] ?? esc(ask.status)}</span><span>${esc(text)}</span></li>`;
const askItem = (ask) => askLine(ask, ask.text);
// What an ask rests on is the builder's own sentence, often long, so the fold shows the ask and the markdown report next to the page keeps the rest.
const withoutEvidence = (ask) => askLine(ask, ask.text.replace(/\s*\(evidence:.*\)\s*$/s, ''));

// "11 of 11 closed" is the fact most readers need. Asks still open or dropped stay in view, and the full ledger with its evidence is a click away.
function asksSection(asks, closed) {
  if (!asks.length) return '';
  const count = `<p class="count">${closed} of ${asks.length} closed.</p>`;
  if (asks.length <= 3) return `<section id="asks"><h2>Asks</h2>${count}<ul class="asks">${asks.map(askItem).join('')}</ul></section>`;
  const loose = asks.filter((ask) => ask.status !== 'done');
  return `<section id="asks"><h2>Asks</h2>${count}${loose.length ? `<ul class="asks">${loose.map(askItem).join('')}</ul>` : ''}<details class="asksfold"><summary>All ${asks.length} asks</summary><ul class="asks">${asks.map(withoutEvidence).join('')}</ul><p class="meta">What each one rests on is in <a href="REPORT.md">REPORT.md</a>, next to this page.</p></details></section>`;
}

// What the page says under the title: the sentence that says what the run is, always, and the rest of the pitch unless it is the moment again.
function whatItIs(run) {
  run = modern(run) ?? {};
  const more = afterFirstSentence(run.pitch);
  return [firstSentence(run.pitch), ...(more && !sameGround(more, run.moment) ? [more] : [])].join(' ');
}

// The report as a page. The words and their order are the markdown report's. What would stop the reader is red and comes before the good news.
export function renderReportHtml({ run, name, asks, closed, rows, tags, alerts, tone = 'bad', worst = null, reasons = [], table, command }, { gallery, hero, heroGone }) {
  run = modern(run) ?? {};
  // No verdict means the run has not got to the end, so the page says so and leaves out what is not there yet.
  const unfinished = !run.verdict;
  const title = run.title ?? (unfinished ? name : 'Untitled');
  // The same word the card carries: a ready-to-ship or a fine run with something to look at first says its worst reason, and the block below says all of them.
  const verdict = alerts.length && run.verdict !== 'dud' && !unfinished ? 'look' : (run.verdict ?? 'unknown');
  const verdictWords = run.currentAcceptance ? `Historical: ${LABEL[verdict] ?? verdict}` : verdict === 'look' && worst ? badgeWords(worst) : (LABEL[verdict] ?? verdict);
  const open = run.url ? `<a href="${esc(run.url)}">Then open ${esc(run.url)}</a>` : '';
  const picture = hero
    ? `<figure class="hero"><a href="${esc(hero)}"><img src="${esc(hero)}" alt="${esc(`Screenshot of ${run.title ?? 'the prototype'}`)}"><span class="full">See it full size</span></a></figure>`
    : heroGone ? '<figure class="hero gone"><p>The picture is not in the run folder any more.</p></figure>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}. 100x report</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="top${picture ? '' : ' bare'}">
<header class="intro"><p class="eyebrow"><span>100x report</span>${gallery ? `<a class="back" href="${esc(gallery)}">All finished runs</a>` : ''}</p><h1>${esc(title)}</h1>${unfinished ? '<span class="badge fine">Not finished</span>' : `<span class="badge ${esc(verdict)}${verdict === 'look' && tone === 'warn' ? ' warn' : ''}">${esc(verdictWords)}</span>`}${run.pitch ? `<p class="pitch">${esc(whatItIs(run))}</p>` : ''}</header>
${picture}
<div class="go">
${run.currentAcceptance ? `<section class="alert warn" role="note"><p>Current acceptance: ${esc(run.currentAcceptance.status)}. ${esc(run.currentAcceptance.reason)} The finished assessment and verdict are historical.</p></section>` : ''}
${unfinished ? '<p class="why">This run has not finished, so most of this page is still empty. It fills in when the run does.</p>' : alerts.length ? `<section class="alert${tone === 'warn' ? ' warn' : ''}" id="look-first" role="note" aria-label="Look first">${list(alerts.map((alert) => esc(alert) + (alert === JUDGE_SAID_NO && reasons.length ? reasonList(reasons) : '')))}</section>` : ''}
${run.moment || !unfinished && run.mode !== 'engineering' ? `<section><h2>The moment</h2><p class="momenttext">${esc(run.moment ?? 'not named')}</p></section>` : ''}
${command || run.runCmd || !unfinished && run.mode !== 'engineering' ? `<section><h2>Run it</h2><p class="run"><code data-command>${esc(command ?? run.runCmd ?? 'unknown')}</code></p>${command || open ? `<p class="actions">${command ? `<button type="button" data-copy="${esc(command)}">Copy run command</button>` : ''}${open}</p>` : ''}${run.tryFirst?.length ? `<h2>Try first</h2>${list(run.tryFirst.map((step) => breakable(step)), 'ol')}` : ''}</section>` : ''}
${run.verdictWhy ? `<section><h2>Why this verdict</h2><p class="why">${esc(run.verdictWhy)}</p></section>` : ''}
</div>
</div>
<section id="checks"><h2>Checks</h2><dl class="checks">${table.map(row).join('')}</dl></section>
${asksSection(asks, closed)}
${run.features?.length ? `<section id="features"><h2>Features and how to cut them</h2>${list(run.features.map((feature) => `<b>${esc(feature.name)}</b>. ${breakable(feature.cutHint ?? '')}`))}</section>` : ''}
${run.nextAsks?.length ? `<section><h2>Next likely asks</h2>${list(run.nextAsks.map((ask) => esc(ask)))}</section>` : ''}
${rows.length ? `<details><summary>Trail. ${rows.length} decisions in .100x/decisions.tsv, the last ${Math.min(10, rows.length)} here</summary>${list(rows.slice(-10).map((entry) => `${esc(entry.phase)}. ${esc(entry.decision)} (${esc(entry.result)})`))}</details>` : ''}
<p class="meta">${tags.length ? `Stage tags ${esc(tags.join(', '))}. ` : ''}Built by 100x.</p>
</main>
<script>${COPY_SCRIPT}</script>
</body>
</html>
`;
}
