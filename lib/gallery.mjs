import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { badgeWords, decision, REASON_KINDS, trustLine, worstReason } from './look-first.mjs';
import { modern } from './runfile.mjs';
import { runDir } from './run-dir.mjs';
import { RANKED_BY } from './score.mjs';
import { plural, sayWhat, verdictSay, when } from './text.mjs';
import { ON_CARD, reasonParts, reasonsFor, SHORT, sharedState, shownReasons } from './why-not.mjs';
import { currentEngineeringState } from './workbench.mjs';

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// A path or a command may break after its separators, so a narrow column cuts it there before it cuts a word in two.
export const breakable = (text) => esc(text).replace(/([/\\_.-])(?=\S)/g, '$1<wbr>');
const LABEL = { ship: 'Ready to ship', fine: 'Fine', dud: 'Needs work', look: 'Look first', mockup: 'Mockup' };
// The filter and the counts put each run under one word. A mockup is its own group: its badge keeps its verdict, and no judge backs that verdict.
const group = (entry) => (entry.mode === 'mockup' ? 'mockup' : decision(entry));
// The one word a run is filed under for the filter buttons: the worst reason when something is to be looked at first, else the builder's
// word, or mockup. It is the word the badge on its picture says, so a button and the cards it keeps read the same.
const filing = (entry) => (group(entry) === 'look' ? worstReason(entry) : group(entry));
const filingWords = (key) => badgeWords(key) ?? LABEL[key];

// The served page starts a run only when it can tell the run is up, and that needs a server on this machine to wait for. A file, or an
// address online, is the owner's to open, and the card gives the command to copy instead.
export function startableAddress(address) {
  try {
    const { protocol, hostname } = new URL(address);
    return /^https?:$/.test(protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

// A run's files can be gone: the folder was cleaned or moved, or the run finished before the report page existed. A link to a file that
// is not there opens a browser error, so every link is checked the way the picture is, and the card says in words what is gone. A run
// that finished before the page existed still has its report as text, and the card links that.
function links(entry, mode, dir) {
  const has = (name) => fs.existsSync(path.join(dir, name));
  const rel = (name) => (mode === 'serve' ? `file/${entry.id}/${name}` : pathToFileURL(path.join(dir, name)).href);
  const sheet = entry.matrix ? `shots/${entry.matrix.label}/contact-sheet.html` : null;
  return {
    hero: entry.heroRel ? rel(entry.heroRel.replace(/^\.100x\//, '')) : null,
    report: has('REPORT.html') ? { href: rel('REPORT.html'), label: 'Report', features: `${rel('REPORT.html')}#features` } : has('REPORT.md') ? { href: rel('REPORT.md'), label: 'Report as text', features: null } : null,
    sheet: sheet && has(sheet) ? rel(sheet) : null,
  };
}

// A phone screenshot is shown at the width of the card, cropped to its top, so the text in it can be read. The whole picture is one tap away.
function isPortrait(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(24);
      fs.readSync(fd, head, 0, 24, 0);
      return head.toString('latin1', 12, 16) === 'IHDR' && head.readUInt32BE(20) > head.readUInt32BE(16) * 1.15;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function card(entry, index, mode) {
  entry = modern(entry);
  const currentAcceptance = entry.currentAcceptance ?? null;
  const dir = runDir(entry);
  const url = links(entry, mode, dir);
  const trust = trustLine(entry);
  const all = reasonsFor(entry);
  const { first, rest } = shownReasons(all, ON_CARD);
  // When every reason ended the same way, the card says so once, under the last of them, whether the rest are folded or open, and not on
  // every line. The first reason stays the first thing under the judge's verdict.
  const together = sharedState(all);
  const reason = (item) => {
    const { title, after } = reasonParts(item, SHORT);
    return `<li>${esc(title)}${after && !together ? `<span class="state ${item.state}">${esc(after)}</span>` : ''}</li>`;
  };
  const command = `cd ${entry.path} && ${entry.runCmd}`;
  const runs = mode === 'serve' && startableAddress(entry.url);
  // The button says what a click does. A run with an address starts and opens it. One with none on record gets the command to copy,
  // and says so. The black button is the one to press, so a run with something to look at first does not get it, and neither does a
  // mockup, which no judge backs.
  const primary = group(entry) === 'look' || group(entry) === 'mockup' ? '' : ' class="primary"';
  const actions = !entry.runCmd ? '' : runs
    ? `<button type="button"${primary} data-run="${esc(entry.id)}">Run and open</button><button type="button" data-stop="${esc(entry.id)}" hidden>Stop</button><a class="open" data-open="${esc(entry.id)}" target="_blank" rel="noopener" hidden>Open</a>`
    : `<button type="button"${primary} data-copy="${esc(command)}">Copy run command</button>`;
  const notes = [
    mode === 'serve' && entry.runCmd && !entry.url ? 'No address is on record for it. Copy the command and run it in a terminal.' : '',
    mode === 'serve' && entry.url && !runs ? 'Its address is not a server on this machine. Copy the command and run it in a terminal.' : '',
    url.report ? '' : 'The report of this run is gone from its folder.',
  ].filter(Boolean);
  // A folder that moved or was cleaned takes its picture with it. A quiet tile says so, where a broken image looked like a bug.
  const heroFile = entry.heroRel ? path.join(dir, entry.heroRel.replace(/^\.100x\//, '')) : null;
  const picture = heroFile && fs.existsSync(heroFile)
    ? `<a class="shot${isPortrait(heroFile) ? ' tall' : ''}" href="${esc(url.hero)}"><img src="${esc(url.hero)}" alt="${esc(`Screenshot of ${entry.title}`)}" loading="lazy">${isPortrait(heroFile) ? '<span class="full">See it full size</span>' : ''}</a>`
    : `<div class="shot none">${heroFile ? 'The picture of this run is gone from its folder' : 'No screenshot was needed for this run'}</div>`;
  const cut = entry.features?.length ? `${url.report?.features ? `<a href="${esc(url.report.features)}">` : ''}${esc(plural(entry.features.length, 'feature'))} you can cut${url.report?.features ? '</a>' : ''}` : '';
  const facts = [`Finished ${esc(when(entry.finishedAt))}`, `Folder <code>${esc(path.basename(entry.path))}</code>`, cut, entry.ship?.preview ? `<a href="${esc(entry.ship.preview)}">Preview online</a>` : ''].filter(Boolean).map((fact) => `<span>${fact}</span>`).join('');
  // The badge sits on the edge of the picture and says the one thing to know first. A run on the look-first list says its worst reason in
  // words, red when trouble was found and amber when only proof is missing. A mockup says what it is. The builder's own word goes on the
  // rank line for both, because the badge no longer says it.
  const kind = group(entry);
  const badge = currentAcceptance ? { cls: 'look warn', text: 'Historical verdict' } : kind === 'look' ? { cls: `look ${trust.tone}`, text: badgeWords(worstReason(entry)) } : { cls: kind, text: LABEL[kind] };
  const builderSaid = kind === 'look' || kind === 'mockup' ? `<span>builder said ${esc(verdictSay(entry.verdict))}</span>` : '';
  return `<article class="card" data-verdict="${filing(entry)}" data-id="${esc(entry.id)}">
  <div class="pic">${picture}<span class="badge ${badge.cls}">${esc(badge.text)}</span></div>
  <div class="body">
    <div class="head"><p class="rank"><span>No. ${String(index + 1).padStart(2, '0')}</span>${builderSaid}</p><h2>${esc(entry.title)}</h2></div>
    <p class="what">${esc(sayWhat(entry.pitch))}</p>${currentAcceptance ? `\n    <p class="note problem">Current acceptance: ${esc(currentAcceptance.status)}. ${esc(currentAcceptance.reason)} The finished verdict is historical.</p>` : ''}
    <div class="trust ${trust.tone}"><p>${esc(trust.text)}</p>${all.length ? `<ul class="reasons" aria-label="Why not ready to ship">${first.map(reason).join('')}</ul>${rest.length ? `<details class="more"><summary>and ${rest.length} more</summary><ul class="reasons" aria-label="More reasons">${rest.map(reason).join('')}</ul></details>` : ''}${together ? `<p class="state ${all[0].state}">${esc(together)}</p>` : ''}` : ''}</div>
    ${entry.moment ? `<p class="momentline"><span>The moment</span>${esc(entry.moment)}</p>` : ''}
    <div class="actions">${actions}${url.report ? `<a href="${esc(url.report.href)}">${url.report.label}</a>` : ''}${url.sheet ? `<a href="${esc(url.sheet)}">Contact sheet</a>` : ''}</div>
    ${notes.map((note) => `<p class="note">${esc(note)}</p>`).join('')}${runs ? '<p class="note problem" data-problem role="status" hidden></p>' : ''}
    ${entry.runCmd ? `<details class="cmd"><summary>The command</summary><code data-command>${esc(command)}</code></details>` : ''}
    <p class="meta facts">${facts}</p>
  </div>
</article>`;
}

// The colors and the corner radius, shared with the report page so the two never drift.
export const THEME = `:root{color-scheme:light dark;--bg:#f4f1ea;--panel:#fffdf8;--ink:#1b1a17;--muted:#645f55;--line:#ddd7c9;--ship:#0f6b41;--ship-bg:#d9f0e2;--fine:#7a5200;--fine-bg:#fbebc5;--dud:#a3281f;--dud-bg:#f9d9d5;--pick:#1b1a17;--on-pick:#fffdf8;--r:0}
@media (prefers-color-scheme:dark){:root{--bg:#0b0e14;--panel:#131923;--ink:#eef1f6;--muted:#a3acbb;--line:#262e3d;--ship:#7ce0a8;--ship-bg:#12301f;--fine:#ffb000;--fine-bg:#2a2008;--dud:#ff9d94;--dud-bg:#4a1b18;--pick:#eef1f6;--on-pick:#0b0e14}}
[hidden]{display:none!important}`;

const STYLE = `${THEME}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1320px;margin:0 auto;padding:40px 24px 80px}
@media (min-width:1800px){main{max-width:min(2400px,100%)}}
header{margin-bottom:20px}
h1{font:700 clamp(2rem,5vw,3rem)/1.05 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.02em;margin:0}
.lede{margin:8px 0 0;color:var(--muted);max-width:60ch}
.lede+.lede{margin-top:2px}
footer{margin-top:32px;display:flex;flex-direction:column;gap:4px;max-width:60ch}
.how{color:var(--muted);font-size:.875rem}
.ranked{border:0;padding:0;color:var(--muted)}
.ranked summary{padding:12px 0;font-size:.875rem}
.ranked p+p{margin-top:8px}
.filters{display:flex;gap:8px;overflow-x:auto;padding:6px;margin:-6px;scrollbar-width:none}
.filters::-webkit-scrollbar{display:none}
.filters button{flex:0 0 auto}
.filters[data-more]{-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 44px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 44px),transparent)}
.bar{position:sticky;top:0;z-index:5;padding:8px 0;margin-bottom:20px;background:var(--bg);border-bottom:1px solid var(--line)}
.shown{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
button,.actions a{font:inherit;min-height:44px;padding:0 16px;border-radius:0;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}
button,.actions a{transition:background-color .15s ease-out,border-color .15s ease-out,opacity .15s ease-out}
button:hover:not(:disabled),.actions a:hover{border-color:var(--ink)}
button[aria-pressed="true"],button.primary{background:var(--pick);color:var(--on-pick);border-color:var(--pick)}
button[aria-pressed="true"]:hover,button.primary:hover:not(:disabled){opacity:.85}
button:active:not(:disabled),.actions a:active{transform:translateY(1px)}
button:disabled{opacity:.6;cursor:progress}
button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
summary,.facts a{transition:color .15s ease-out}
summary:hover,.facts a:hover{color:var(--ink)}
.shot img{transition:opacity .15s ease-out}
.shot:hover img{opacity:.9}
.grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:0;overflow:hidden;display:flex;flex-direction:column}
.card[hidden]{display:none}
.shot{display:block;aspect-ratio:4/3;background:var(--line);overflow:hidden;border-radius:0}
.shot img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
.shot:focus-visible{outline-offset:-6px}
.shot:not(.tall):focus-visible img{outline:3px solid var(--bg);outline-offset:-3px}
.shot.tall{aspect-ratio:auto;position:relative}
.shot.tall img{width:100%;height:auto;max-height:26rem;object-fit:cover;object-position:top center}
.full{position:absolute;right:10px;bottom:10px;padding:4px 10px;border-radius:0;background:var(--pick);color:var(--on-pick);font-size:.875rem;font-weight:700;pointer-events:none}
.shot.none{display:grid;place-items:center;aspect-ratio:auto;padding:20px 24px 34px;text-align:center;background:var(--bg);border-bottom:1px dashed var(--line);color:var(--muted);font-size:.875rem}
@media (max-width:600px){main{padding-top:24px}header{margin-bottom:12px}h1{font-size:2rem}.shot{aspect-ratio:2/1}.shot.tall{aspect-ratio:auto}.shot.tall img{max-height:26vh}.filters button{padding:0 14px}}
@media (max-width:400px){main{padding-top:16px}header{margin-bottom:12px}h1{font-size:1.75rem}.lede{font-size:.875rem;line-height:1.4}}
@media (max-width:340px){main{padding-inline:16px}.filters{gap:6px}.filters button{padding:0 10px;font-size:.9375rem}}
@media (max-width:600px) and (max-height:700px){.bar{margin-bottom:12px}.shot.tall img{max-height:20vh}}
@media (max-height:520px){.shot{aspect-ratio:auto;height:26vh}.shot.tall img{max-height:26vh}}
.rank{font:700 .875rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;display:flex;flex-wrap:wrap;gap:0 .9em}
.rank span{white-space:nowrap}
.body{padding:24px 20px 20px;display:flex;flex-direction:column;gap:12px;min-width:0;overflow-wrap:anywhere}
.body p{max-width:70ch}
h2{font:700 1.5rem/1.15 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em;margin:0}
.badge{font-weight:700;font-size:.875rem;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:0;white-space:nowrap}
.badge.ship{background:var(--ship-bg);color:var(--ship)}.badge.fine,.badge.look.warn{background:var(--fine-bg);color:var(--fine)}.badge.dud,.badge.look{background:var(--dud-bg);color:var(--dud)}.badge.mockup{background:var(--line);color:var(--ink)}
.pic{position:relative}
.pic .badge{position:absolute;left:12px;bottom:-14px;z-index:1;pointer-events:none}
p{margin:0}
.trust{padding:8px 12px;border-radius:0;font-size:1rem}
.trust.bad{background:var(--dud-bg)}
.trust.warn{background:var(--fine-bg)}
.trust.ok{padding:0;color:var(--muted)}
.trust p+p,.reasons+.state,.more+.state{margin-top:6px}
.reasons{margin:4px 0 0;padding-left:1.1rem}
.reasons li+li{margin-top:4px}
.trust .more{border:0;padding:0;margin-top:2px;font-size:.875rem;color:var(--muted)}
.trust .more summary{padding:12px 0}
.trust .more .reasons{margin-top:0;color:var(--ink);font-size:1rem}
.state{display:block;font-size:.875rem;color:var(--muted)}
.state.left{color:var(--dud);font-weight:700}
.momentline span{display:block;font-size:.875rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.momentline{font-size:1.125rem}
code{font:.875rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.cmd code{display:block;margin-top:4px;color:var(--muted);overflow-wrap:anywhere;user-select:all}
.actions{display:flex;flex-wrap:wrap;gap:8px}
.note{color:var(--muted);font-size:.875rem}
.note.problem{color:var(--dud);font-weight:700}
.note.problem a{display:inline-flex;align-items:center;min-height:44px}
details{border-top:1px solid var(--line);padding-top:8px}
summary{cursor:pointer;padding:10px 0}
.meta{color:var(--muted);font-size:.875rem}
.facts{display:flex;flex-wrap:wrap;align-items:center;gap:2px 16px}
.facts a{display:inline-flex;align-items:center;min-height:44px}
.empty{padding:32px 24px;border:1px dashed var(--line);border-radius:0;color:var(--muted);display:flex;flex-direction:column;gap:8px}
.empty b{color:var(--ink)}
.progress{margin-top:32px;display:flex;flex-direction:column;gap:12px;max-width:60ch}
.progress ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.progress li{padding:16px;border:1px solid var(--line);border-radius:0;background:var(--panel);display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere}
.progress li.idle{border-style:dashed}
.progress p{margin:0}
.progress .quiet{color:var(--muted);font-size:.875rem}
a{color:inherit}
@media (max-height:520px){main{padding:12px 24px 48px}header{margin-bottom:8px;display:flex;flex-wrap:wrap;align-items:baseline;gap:0 16px}h1{font-size:1.75rem}.lede{margin:0}.bar{margin-bottom:8px}}
/* A phone too short to hold both: the verdict and its first reason come before the sentence that says what the run is, and the line of counts, which the buttons repeat, waits for a screen reader. */
@media (max-width:600px) and (max-height:700px),(max-height:520px) and (min-width:640px){.body>*{order:3}.body>.head{order:0}.body>.trust{order:1}.body>.what{order:2}}
@media (max-width:340px){.rank{font-size:.75rem;letter-spacing:.02em;gap:0 .5em}}
@media (max-width:600px) and (max-height:700px){.lede:not(.left-out){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:0}}
@media (max-height:520px) and (min-width:640px){.grid{grid-template-columns:1fr;gap:16px}.card{flex-direction:row}.pic{flex:0 0 34%;display:flex}.pic .shot{flex:1;height:auto;min-width:0;border-radius:0}.pic .shot.tall{align-items:flex-start;padding:12px 0}.pic .shot.tall img{max-height:60vh}.pic .badge{left:auto;right:-14px;top:12px;bottom:auto}.body{flex:1 1 0;padding:14px 24px 14px 28px;gap:8px}}
@media (prefers-reduced-motion:reduce){button,.actions a,summary,.facts a,.shot img{transition:none}button:active:not(:disabled),.actions a:active{transform:none}}
`;

// The copy button. A page opened from a file may not write to the clipboard, so the command is selected and copied the old way, and the
// button says what happened. The report page uses the same script.
export const COPY_SCRIPT = `
const live=document.body.appendChild(document.createElement('p'));live.setAttribute('role','status');live.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
for(const b of document.querySelectorAll('[data-copy]')){b.addEventListener('click',async()=>{
 const said=b.textContent;const say=(text,ms)=>{b.textContent=text;live.textContent=text;setTimeout(()=>{b.textContent=said;live.textContent='';},ms);};
 try{await navigator.clipboard.writeText(b.dataset.copy);say('Copied',2000);return;}catch{}
 const holder=(b.closest('article,section')||document).querySelector('[data-command]');
 if(!holder){say('Could not copy',2500);return;}
 const fold=holder.closest('details');const wasShut=fold&&!fold.open;if(fold)fold.open=true;
 const range=document.createRange();range.selectNodeContents(holder);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
 let copied=false;try{copied=document.execCommand('copy');}catch{}
 if(copied){selection.removeAllRanges();if(wasShut)fold.open=false;}
 say(copied?'Copied':'Selected. Press '+(/Mac|iPhone|iPad/.test(navigator.platform)?'Cmd':'Ctrl')+'+C',copied?2000:4000);
});}
`;

const SCRIPT = `
const cards=[...document.querySelectorAll('.card')];
const shown=document.querySelector('.shown');
const row=document.querySelector('.filters');
if(row){const more=()=>row.toggleAttribute('data-more',row.scrollLeft+row.clientWidth<row.scrollWidth-1);more();row.addEventListener('scroll',more,{passive:true});addEventListener('resize',more);}
for(const b of document.querySelectorAll('.filters [data-filter]')){b.addEventListener('click',()=>{const f=b.dataset.filter;for(const o of document.querySelectorAll('.filters [data-filter]'))o.setAttribute('aria-pressed',String(o===b));for(const c of cards)c.hidden=f!=='all'&&c.dataset.verdict!==f;if(shown)shown.textContent=f==='all'?'':'Showing '+cards.filter((c)=>!c.hidden).length+' of '+cards.length;});}
${COPY_SCRIPT}
const serve=document.body.dataset.mode==='serve';
if(serve){
 const post=(p)=>fetch(p,{method:'POST',headers:{'X-100x':'1'}}).then(r=>r.json());
 const paint=(s)=>{for(const c of cards){const st=s[c.dataset.id]||{};const run=c.querySelector('[data-run]'),stop=c.querySelector('[data-stop]'),open=c.querySelector('[data-open]');if(!run)continue;run.hidden=!!st.running;stop.hidden=!st.running;open.hidden=!st.running;if(st.url)open.href=st.url;}};
 const poll=()=>fetch('api/status').then(r=>r.json()).then(paint).catch(()=>{});
 poll();setInterval(poll,4000);
 for(const b of document.querySelectorAll('[data-run]'))b.addEventListener('click',async()=>{const problem=b.closest('.card').querySelector('[data-problem]');const said=b.textContent;problem.hidden=true;b.disabled=true;b.textContent='Starting';const r=await post('api/run/'+b.dataset.run).catch(()=>({ok:false,error:'The page lost its server. Call 100x-report and it starts again.'}));b.disabled=false;b.textContent=said;if(r.ok){window.open(r.url,'_blank');}else{problem.textContent=r.error||'It did not start.';const link=(href,text)=>{const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener';a.textContent=text;return a;};if(r.log){const a=link(r.log,'See the log');a.title=problem.textContent.replace(/^.* See /,'');problem.textContent=problem.textContent.replace(/ See .*$/,'')+' ';problem.append(a);}if(r.openAnyway)problem.append(' ',link(r.openAnyway,'Open it anyway'));problem.hidden=false;}poll();});
 for(const b of document.querySelectorAll('[data-stop]'))b.addEventListener('click',async()=>{await post('api/stop/'+b.dataset.stop);poll();});
}
`;

// What an empty gallery says. With every run in view there is nothing older to look for, so it says how a run gets here.
// A run that is still being built is the reason nothing has finished, so the page does not tell the owner to start one.
const emptyWords = (windowLabel, all, building = 0) => (all
  ? { head: 'No finished runs yet.', next: building ? `The ${building === 1 ? 'run' : 'runs'} in progress below ${building === 1 ? 'shows' : 'show'} here when ${building === 1 ? 'it finishes' : 'they finish'}.` : 'Run the 100x skill with a brief in your agent app, and the run shows here when it finishes.' }
  : { head: `Nothing finished ${windowLabel}.`, next: '`100x-report all` shows older runs.' });
export const emptyLine = (windowLabel, all, building = 0) => Object.values(emptyWords(windowLabel, all, building)).join(' ');

// The same sentences in a panel of their own. Older runs are a link where there is a page to go to, and a command where there is not.
function emptyPanel(windowLabel, all, olderHref, building) {
  const { head, next } = emptyWords(windowLabel, all, building);
  const second = !all && olderHref ? `<p><a href="${esc(olderHref)}">Show every finished run</a></p>` : `<p>${esc(next).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`;
  return `<div class="empty"><p><b>${esc(head)}</b></p>${second}</div>`;
}

// The runs that have started and not finished, under the cards. Each says whether it is still being worked on, how far it got, and the one line
// that picks it up. A run with nothing to show yet has no card, and without this it would not be on the page at all.
function progressPanel(unfinished) {
  if (!unfinished || (!unfinished.runs.length && !unfinished.older)) return '';
  const row = (run) => {
    const { words } = run;
    return `<li${run.idle ? ' class="idle"' : ''}><p><b>${esc(run.title)}</b></p>${run.what ? `<p>${esc(run.what)}</p>` : ''}<p class="quiet">${esc(words.state)}</p>${run.stage ? `<p>${esc(run.stage)}</p>` : ''}<p>${esc(words.asks)}${words.judge ? ` ${esc(words.judge)}` : ''}</p><p class="quiet">${esc(words.go).replace(/`([^`]+)`/g, '<code>$1</code>')}</p></li>`;
  };
  const head = unfinished.runs.length ? `In progress. ${plural(unfinished.runs.length, 'run')} not finished` : 'Not finished';
  return `<section class="progress" aria-labelledby="progress-title"><h2 id="progress-title">${esc(head)}</h2>${unfinished.runs.length ? `<ul>${unfinished.runs.map(row).join('')}</ul>` : ''}${unfinished.older ? `<p class="quiet">${esc(unfinished.olderWords).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>` : ''}</section>`;
}

const tally = (entries) => {
  const counts = { ship: 0, fine: 0, dud: 0, look: 0, mockup: 0 };
  for (const entry of entries) counts[group(entry)] += 1;
  return counts;
};

// How the window reads in a sentence: "so far", "in the last hour", "in the last 18 hours".
export const windowWords = (hours, all) => (all ? 'so far' : hours === 1 ? 'in the last hour' : `in the last ${hours} hours`);

// The line under the title, and the first line of the ranking in the terminal. Each run is counted once, under its one verdict.
export function lede(entries, label) {
  const counts = tally(entries);
  // Only the words that have a run: "0 fine, 0 needing work" is noise on a phone, and the filter buttons below leave those words out as well.
  const said = [[counts.ship, 'ready to ship'], [counts.fine, 'fine'], [counts.dud, 'needing work'], [counts.look, 'to look at first'], [counts.mockup, counts.mockup === 1 ? 'mockup' : 'mockups']].filter(([count]) => count).map(([count, word]) => `${count} ${word}`).join(', ');
  // With more than one run the order is the first question, and it is the builder's own word that sets it, so the line says that.
  return `${plural(entries.length, 'prototype')} ${label}${entries.length > 1 ? ", ranked by the builder's word" : ''}.${said ? ` ${said}.` : ''}`;
}

// A page opened from a file cannot start anything, so its button copies. The page that starts prototypes is the served one, and the page says so where the buttons are.
export const COPY_ONLY = 'This page copies each run command. The page that `100x-report` opens in your browser has a Run button.';

// A run whose record is damaged is left out of the page. The page says so once, so a missing run is not a mystery, and points at the
// terminal, which names the run and says how to drop it.
const leftOutLine = (count) => (count
  ? `${plural(count, 'finished run')} ${count === 1 ? 'is' : 'are'} left out of this page because ${count === 1 ? 'its record is' : 'their records are'} damaged. \`100x report\` in a terminal names ${count === 1 ? 'it' : 'them'}.`
  : '');

// One button for each word a card's badge says, with the number of runs under it, so the buttons are the reasons the line above adds up
// to. The reason with the most runs comes first, then the builder's words, then mockups.
function filterButtons(entries) {
  const filed = new Map();
  for (const entry of entries) filed.set(filing(entry), (filed.get(filing(entry)) ?? 0) + 1);
  const reasons = REASON_KINDS.filter((kind) => filed.has(kind)).sort((a, b) => filed.get(b) - filed.get(a));
  const rest = ['ship', 'fine', 'dud', 'mockup'].filter((word) => filed.has(word));
  return [...reasons, ...rest].map((key) => `<button type="button" data-filter="${key}" aria-pressed="false">${filingWords(key)} ${filed.get(key)}</button>`).join('');
}

export function renderGallery(entries, { mode = 'static', generatedAt = new Date(), windowLabel = '', all = false, olderHref = null, leftOut = 0, inProgress = null } = {}) {
  entries = entries.map((entry) => {
    const run = modern(entry);
    const currentAcceptance = Object.hasOwn(run, 'currentAcceptance') ? run.currentAcceptance : currentEngineeringState(run.path, run);
    return currentAcceptance ? { ...run, currentAcceptance } : run;
  });
  // The filters stay at the top of the screen, in one row that scrolls sideways when it must, while the cards scroll under them. The line
  // that says how many runs are in view is for a screen reader, which hears it change when a button is pressed.
  const filters = entries.length
    ? `<div class="bar"><div class="filters" role="group" aria-label="Filter by what to look at first"><button type="button" data-filter="all" aria-pressed="true">All ${entries.length}</button>${filterButtons(entries)}</div><p class="shown" role="status"></p></div>`
    : '';
  const how = entries.length && mode === 'static' && entries.some((entry) => entry.url) ? `<p class="how">${esc(COPY_ONLY).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>` : '';
  const body = entries.length ? `<div class="grid">${entries.map((entry, index) => card(entry, index, mode)).join('\n')}</div>` : emptyPanel(windowLabel, all, mode === 'serve' ? '?all=1' : olderHref, inProgress?.runs.length ?? 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>100x report</title>
<style>${STYLE}</style>
</head>
<body data-mode="${mode}">
<main>
<header><h1>Report</h1>${entries.length ? `<p class="lede">${esc(lede(entries, windowLabel))}</p>` : ''}${leftOut ? `<p class="lede left-out">${esc(leftOutLine(leftOut)).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>` : ''}</header>
${filters}
${body}
${progressPanel(inProgress)}
<footer>${entries.length ? `<details class="ranked"><summary>How 100x ranks them</summary><p>${esc(RANKED_BY)}</p></details>` : ''}${how}<p class="meta">Built ${esc(when(generatedAt.toISOString()))} by 100x.</p></footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
