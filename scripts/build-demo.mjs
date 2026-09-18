/**
 * Build demo.html — a single self-contained file that works from disk with no
 * network and no server.
 *
 *   npm run build:demo
 *
 * The reason this is generated rather than hand-written: the term normaliser in
 * it is the REAL normaliser, bundled from src/ by esbuild, running against the
 * real dictionary and the real product data. A hand-written copy would be a
 * second implementation that drifts from the first, and a demonstration of a
 * component that is no longer the component is worse than no demonstration.
 *
 * Everything else — the agent roster, tool grants, guardrail patterns, eval
 * cases, the deliberate data traps — is read from config/ and data/ at build
 * time, so this file cannot describe a system different from the one deployed.
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

const config = read('config/agent.config.json');
const evals = read('config/evals.json');
const products = read('data/products.json');
const establishments = read('data/establishments.json');
const alerts = read('data/alerts.json');
const recorded = read('data/recorded-sessions.json');

// --- Bundle the real normaliser -------------------------------------------

const bundled = await build({
  stdin: {
    contents: `
      import { normalise } from './src/lib/normalise/index';
      globalThis.KehillaNormalise = normalise;
    `,
    resolveDir: new URL('.', root).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  write: false,
  minify: true,
  // The data JSONs are imported by the brand index, so they get inlined too.
  loader: { '.json': 'json' },
  tsconfigRaw: {
    compilerOptions: {
      paths: {
        '@data/*': ['./data/*'],
        '@config/*': ['./config/*'],
        '@/*': ['./src/*'],
      },
      baseUrl: '.',
    },
  },
});

const normaliserJs = bundled.outputFiles[0].text;

// --- Derived facts, computed rather than asserted -------------------------

const agentRoster = Object.entries(config.agents)
  .filter(([k]) => !k.startsWith('$'))
  .map(([key, a]) => ({ key, label: a.label, tools: a.tools ?? [] }));

const totalTools = new Set(agentRoster.flatMap((a) => a.tools)).size;

const traps = {
  notPesach: products.products.filter((p) => p.certified && p.pesach === 'not_certified').length,
  pDesignation: products.products.filter((p) => p.pesach === 'certified_with_p_designation').length,
  notCertified: products.products.filter((p) => !p.certified).length,
  withAlerts: products.products.filter((p) => p.alerts.length > 0).length,
  expired: establishments.establishments.filter(
    (e) => e.certifiedUntil && new Date(e.certifiedUntil) < new Date(),
  ).length,
};

const guardrailList = Object.entries(config.guardrails)
  .filter(([k]) => !k.startsWith('$'))
  .map(([, g]) => ({
    id: g.id,
    label: g.label,
    action: g.action,
    patternCount: (g.patterns ?? []).length,
  }));

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Template --------------------------------------------------------------

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kehilla Hotline — offline reference</title>
<style>
  :root{
    --ink:#0a0c0e; --panel:#12161a; --raised:#1a1f25; --hair:#262d35; --hair2:#38424d;
    --bone:#e6e9ec; --muted:#8b96a2; --faint:#5c6673;
    --live:#4ade80; --warn:#fbbf24; --danger:#f87171; --info:#60a5fa;
    --mono: ui-monospace,"SF Mono",SFMono-Regular,Menlo,Monaco,Consolas,monospace;
    --sans: ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ink);color:var(--bone);font-family:var(--sans);line-height:1.55}
  .wrap{max-width:1040px;margin:0 auto;padding:0 20px}
  header{padding:32px 0 8px}
  .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint)}
  h1{font-size:18px;font-weight:500;margin:8px 0 0;max-width:46em}
  section{border-top:1px solid var(--hair);padding:30px 0}
  h2{font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:.14em;margin:0}
  .idx{font-family:var(--mono);font-size:11px;color:var(--faint);margin-right:12px}
  .blurb{color:var(--muted);font-size:14px;max-width:62em;margin:8px 0 0}
  .panel{border:1px solid var(--hair);background:var(--panel);padding:14px;margin-top:18px}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
  .notice{border:1px solid rgba(251,191,36,.3);background:rgba(251,191,36,.05);color:var(--warn);
          padding:10px 12px;font-family:var(--mono);font-size:11px}
  input[type=text]{width:100%;padding:12px;background:var(--panel);border:1px solid var(--hair);
          color:var(--bone);font-size:16px;font-family:var(--sans)}
  input[type=text]:focus{outline:none;border-color:var(--hair2)}
  button{background:var(--raised);border:1px solid var(--hair2);color:var(--bone);
          padding:7px 11px;font-size:12px;cursor:pointer;font-family:var(--sans)}
  button:hover{border-color:var(--live);color:var(--live)}
  .grid2{display:grid;gap:14px;grid-template-columns:1fr}
  @media(min-width:760px){.grid2{grid-template-columns:1fr 1fr}}
  mark{background:rgba(251,191,36,.2);color:var(--warn);text-decoration:underline dotted}
  .pill{display:inline-block;font-family:var(--mono);font-size:10px;text-transform:uppercase;
         letter-spacing:.08em;border:1px solid var(--hair2);color:var(--muted);padding:1px 6px;margin:0 4px 4px 0}
  .pill.live{border-color:rgba(74,222,128,.5);color:var(--live)}
  .pill.warn{border-color:rgba(251,191,36,.4);color:var(--warn)}
  .pill.danger{border-color:rgba(248,113,113,.4);color:var(--danger)}
  pre{font-family:var(--mono);font-size:10.5px;line-height:1.5;color:var(--muted);
       overflow-x:auto;margin:0}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;
      color:var(--faint);text-align:left;padding:7px 10px;border-bottom:1px solid var(--hair)}
  td{padding:7px 10px;border-bottom:1px solid var(--hair);color:var(--muted);vertical-align:top}
  td.k{color:var(--bone);font-family:var(--mono);font-size:11px}
  .sub{font-family:var(--mono);font-size:11px;color:var(--muted);padding:5px 0;
        border-bottom:1px solid var(--hair)}
  .sub b{color:var(--bone);font-weight:400}
  .sub .from{color:var(--warn)}
  footer{border-top:1px solid var(--hair);padding:28px 0 44px;color:var(--faint);font-size:11px;
          font-family:var(--mono)}
  .ex{margin:0 6px 6px 0;font-family:var(--mono);font-size:10.5px}
  details summary{cursor:pointer;font-family:var(--mono);font-size:11px;color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">

<header>
  <p class="kicker">Kehilla Kosher Certification — consumer hotline</p>
  <h1>Offline reference. The live system is a hosted multi-agent voice agent; this file
  documents it and runs the one component that needs no server.</h1>
</header>

<section>
  <p><span class="idx">00</span><h2 style="display:inline">Synthetic data</h2></p>
  <div class="notice" style="margin-top:14px">
    Kehilla Kosher Certification is a fictional agency. Every product, brand, establishment,
    symbol, alert and status below is synthetic demonstration data. This is not a kosher
    certification reference and must not be relied on for any purpose. No real certifying
    body's name, symbol or trade dress is represented.
  </div>
  <p class="blurb">This file is generated from the same <code>config/</code> and
  <code>data/</code> the deployed system reads, so it cannot describe a different system.
  The normaliser below is the real module, bundled from source — not a re-implementation.</p>
</section>

<section>
  <p><span class="idx">01</span><h2 style="display:inline">Term normalisation — live, offline</h2></p>
  <p class="blurb">Hebrew and Yiddish terminology destroys off-the-shelf speech recognition:
  it has no kashrus vocabulary, so it reaches for the nearest English it knows. This layer sits
  between the transcript and the models. It runs entirely in your browser, so it works here with
  no network at all. Type anything, or try one of these.</p>

  <div class="panel">
    <div style="margin-bottom:10px">
      ${[
        'is the milk hig one holov yisroel',
        'do they have a heck share for par eve',
        'i got a shy la about pas yisroel',
        'is name on bakery challah yoshen',
        'is it mash giach temeedee there',
        'hash gotcha for the flay shig',
      ]
        .map((e) => `<button class="ex" data-ex="${esc(e)}">${esc(e)}</button>`)
        .join('')}
    </div>
    <input type="text" id="normIn" placeholder="Type mangled kashrus terminology…">
    <div class="grid2" style="margin-top:14px">
      <div>
        <p class="kicker">Raw — what STT produced</p>
        <p id="normRaw" style="font-size:14px;margin:6px 0 0;color:var(--muted)">—</p>
      </div>
      <div>
        <p class="kicker">Normalised — what the models receive</p>
        <p id="normOut" style="font-size:14px;margin:6px 0 0">—</p>
      </div>
    </div>
    <div id="normSubs" style="margin-top:14px"></div>
    <p class="mono" id="normTime" style="font-size:10px;color:var(--faint);margin:10px 0 0"></p>
  </div>
</section>

<section>
  <p><span class="idx">02</span><h2 style="display:inline">Architecture</h2></p>
  <p class="blurb">Triage on a cheap model routes each turn to a specialist holding only the
  tools it needs. A separate verifier audits the drafted reply against the raw tool results and
  blocks it if a claim is not supported. The shailah router fires from any state and hard-stops
  the pipeline.</p>
  <div class="panel"><pre>${esc(`                    ┌──────────────┐
   caller  ─────▶   │   TRIAGE     │  ${config.models.triage.id} — forced tool call
                    │ classify +   │  intent, urgency, shailah detection
                    │    route     │
                    └──────┬───────┘
                           │
     ┌─────────────┬───────┴────────┬──────────────┐
     ▼             ▼                ▼              ▼
┌─────────┐  ┌───────────┐   ┌───────────┐  ┌───────────┐
│ PRODUCT │  │ESTABLISH- │   │  SALES    │  │ COMPLAINT │   ${config.models.specialist.id}
│ STATUS  │  │  MENT     │   │  INTAKE   │  │  INTAKE   │   scoped tools
└────┬────┘  └─────┬─────┘   └─────┬─────┘  └─────┬─────┘
     └─────────────┴───────┬───────┴──────────────┘
                           ▼
                  ┌─────────────────┐
                  │    VERIFIER     │  ${config.models.verifier.id}
                  │ claim ↔ tool    │  audits against RAW tool results
                  │ result match    │  BLOCKS on mismatch, retries once
                  └────────┬────────┘
                           ▼
                        caller

   ┌──────────────────────────────────────────────┐
   │ SHAILAH ROUTER — fires from any state,       │
   │ hard-stops the pipeline, routes to the Rav   │
   └──────────────────────────────────────────────┘`)}</pre></div>

  <div class="panel">
    <p class="kicker">Tools held per agent — enforced in code, not by instruction</p>
    <table style="margin-top:10px">
      <tr><th>Agent</th><th>Tools</th><th>Which</th></tr>
      ${agentRoster
        .map(
          (a) => `<tr><td class="k">${esc(a.label)}</td>
            <td class="mono" style="white-space:nowrap">${a.tools.length} of ${totalTools}</td>
            <td class="mono" style="font-size:10px">${esc(a.tools.join(' · ') || 'none — it routes, it does not act')}</td></tr>`,
        )
        .join('')}
    </table>
  </div>

  <div class="panel">
    <p class="kicker">Guardrails — every firing surfaces in the live UI</p>
    <table style="margin-top:10px">
      <tr><th>Guardrail</th><th>Action</th><th>Patterns</th></tr>
      ${guardrailList
        .map(
          (g) => `<tr><td class="k">${esc(g.label)}</td>
            <td><span class="pill ${g.action === 'block' ? 'danger' : 'warn'}">${esc(g.action)}</span></td>
            <td class="mono">${g.patternCount || '—'}</td></tr>`,
        )
        .join('')}
    </table>
  </div>
</section>

<section>
  <p><span class="idx">03</span><h2 style="display:inline">The eval suite</h2></p>
  <p class="blurb">${evals.cases.length} cases, run against the same pipeline the browser drives —
  there is no eval-only code path. Each is scored by deterministic assertions read from the real
  event stream <em>and</em> an LLM judge that must return ${evals.judge.passThreshold} or better.
  Both must agree. In the live system these run on demand with a server timestamp.</p>
  <div class="panel">
    ${evals.cases
      .map(
        (c) => `<details style="padding:7px 0;border-bottom:1px solid var(--hair)">
          <summary>${esc(c.title)}</summary>
          <div style="padding:8px 0 4px 14px">
            <p style="font-size:12px;color:var(--muted);margin:0 0 6px">${esc(c.why)}</p>
            <p class="mono" style="font-size:11px;color:var(--bone);margin:0 0 6px">
              caller: &ldquo;${esc(c.turns.map((t) => t.text).join(' '))}&rdquo;</p>
            <p class="mono" style="font-size:10px;color:var(--faint);margin:0">
              asserts: ${esc(
                Object.entries(c.assert)
                  .map(([k, v]) => `${k}=${Array.isArray(v) ? JSON.stringify(v) : v}`)
                  .join('  ·  '),
              )}</p>
          </div>
        </details>`,
      )
      .join('')}
  </div>
</section>

<section>
  <p><span class="idx">04</span><h2 style="display:inline">The data, and its deliberate traps</h2></p>
  <p class="blurb">The dataset is built to make the hard cases fire on genuine misses rather than
  staged ones. ${products.products.length} products, ${establishments.establishments.length}
  establishments, ${alerts.alerts.length} active alerts.</p>
  <div class="panel">
    <table>
      <tr><th>Trap</th><th>Count</th><th>Why it is there</th></tr>
      <tr><td class="k">Certified year-round, NOT for Pesach</td><td class="mono">${traps.notPesach}</td>
        <td>The majority, which is the real-world ratio. Conflating the two is the hotline's whole spring.</td></tr>
      <tr><td class="k">Pesach only with the P designation</td><td class="mono">${traps.pDesignation}</td>
        <td>The same product with and without a P are different certifications.</td></tr>
      <tr><td class="k">We do not certify it</td><td class="mono">${traps.notCertified}</td>
        <td>Must produce &ldquo;we do not certify it&rdquo;, never &ldquo;it is not kosher&rdquo;.</td></tr>
      <tr><td class="k">Under an active alert</td><td class="mono">${traps.withAlerts}</td>
        <td>Recall, mislabelling and revocation — all must surface unprompted.</td></tr>
      <tr><td class="k">Establishment certification expired</td><td class="mono">${traps.expired}</td>
        <td>Expiry is computed against today, so it cannot drift into reading as current.</td></tr>
      <tr><td class="k">Confusable brand pairs</td><td class="mono">2</td>
        <td>Arbel Foods / Arbeli Brands and Shibolet Mills / Shibolim Grain Co. force a clarifying
        question instead of a guess.</td></tr>
      <tr><td class="k">Absent from the database entirely</td><td class="mono">${config.demo.absentExamples.length}</td>
        <td>${esc(config.demo.absentExamples.map((a) => `${a.brand} ${a.name}`).join(', '))} — so the
        absence path fires on a real gap.</td></tr>
    </table>
  </div>
</section>

<section>
  <p><span class="idx">05</span><h2 style="display:inline">Adversarial cases</h2></p>
  <p class="blurb">In the live system each of these is a button that fires a real request and
  shows what the guardrails did, including the blocked draft in full.</p>
  <div class="panel">
    <table>
      <tr><th>Attack</th><th>Expected behaviour</th></tr>
      ${config.demo.attacks
        .map(
          (a) => `<tr>
            <td class="k" style="min-width:12em">&ldquo;${esc(a.text)}&rdquo;</td>
            <td>${esc(a.expect)}<br><span class="pill warn">${esc(a.guardrail)}</span></td></tr>`,
        )
        .join('')}
    </table>
  </div>
</section>

<section>
  <p><span class="idx">06</span><h2 style="display:inline">Recorded calls</h2></p>
  ${
    recorded.sessions.length === 0
      ? `<p class="blurb">Not captured yet. These are populated by running the four scenarios
         against a live deployment and committing the real traces, so a replay is a real run
         rather than a mock-up. This file will not show invented transcripts in place of a
         capture.</p>`
      : `<p class="blurb">Captured ${esc(recorded.capturedAt)} from ${esc(recorded.capturedFrom)}.
         Real traces; the live page replays them at their original pacing.</p>
         <div class="panel">${recorded.sessions
           .map((s) => {
             const final = s.events.filter((e) => e.t === 'final').map((e) => e.text);
             const caller = s.events.filter((e) => e.t === 'normalised').map((e) => e.raw);
             return `<details style="padding:7px 0;border-bottom:1px solid var(--hair)">
               <summary>${esc(s.title)} — ${esc(s.subtitle)}</summary>
               <div style="padding:8px 0 4px 14px">
                 <p style="font-size:12px;color:var(--muted);margin:0 0 8px">${esc(s.why)}</p>
                 ${caller
                   .map(
                     (c, i) => `<p class="kicker">Caller</p>
                       <p style="font-size:13px;margin:4px 0 8px">${esc(c)}</p>
                       <p class="kicker">Agent</p>
                       <p style="font-size:13px;margin:4px 0 12px;color:var(--bone)">${esc(final[i] ?? '')}</p>`,
                   )
                   .join('')}
                 ${s.annotations
                   .map(
                     (a) =>
                       `<p class="mono" style="font-size:10.5px;color:var(--live);border-left:2px solid rgba(74,222,128,.5);padding-left:8px;margin:4px 0">${esc(a.text)}</p>`,
                   )
                   .join('')}
               </div></details>`;
           })
           .join('')}</div>`
  }
</section>

<footer>
  <p style="color:var(--warn)">Fictional agency. Synthetic demonstration data throughout. Not a
  kosher certification reference.</p>
  <p>Halachic questions are never answered by this system — they are routed to a Rav, which is the
  correct handling for a shailah.</p>
  <p>Generated from source on ${new Date().toISOString().slice(0, 10)}. The normaliser running on
  this page is the deployed module, bundled by esbuild — not a re-implementation.</p>
</footer>

</div>

<script>${normaliserJs}</script>
<script>
(function(){
  var input = document.getElementById('normIn');
  var raw = document.getElementById('normRaw');
  var out = document.getElementById('normOut');
  var subs = document.getElementById('normSubs');
  var time = document.getElementById('normTime');

  var TONE = { term:'', variant:'live', brand:'warn' };

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function highlight(text, substitutions){
    if(!substitutions.length) return esc(text);
    var sorted = substitutions.slice().sort(function(a,b){return a.start-b.start;});
    var html = '', cursor = 0;
    sorted.forEach(function(s){
      if(s.start > cursor) html += esc(text.slice(cursor, s.start));
      html += '<mark title="' + esc(s.method + ' match, confidence ' + s.confidence) + '">'
            + esc(text.slice(s.start, s.end)) + '</mark>';
      cursor = s.end;
    });
    if(cursor < text.length) html += esc(text.slice(cursor));
    return html;
  }

  function render(){
    var text = input.value;
    if(!text.trim()){
      raw.textContent = '—'; out.textContent = '—';
      subs.innerHTML = ''; time.textContent = '';
      return;
    }
    // The real normaliser, bundled from src/lib/normalise.
    var r = globalThis.KehillaNormalise(text);
    raw.innerHTML = highlight(r.raw, r.substitutions);
    out.textContent = r.normalised;
    subs.innerHTML = r.substitutions.length
      ? r.substitutions.map(function(s){
          return '<div class="sub"><span class="from">' + esc(s.from) + '</span> → <b>'
            + esc(s.to) + '</b> <span class="pill ' + (TONE[s.kind]||'') + '">' + esc(s.kind)
            + '</span> <span style="color:var(--faint)">' + esc(s.method) + ' · ' + s.confidence
            + '</span><br><span style="color:var(--muted)">' + esc(s.gloss) + '</span></div>';
        }).join('')
      : '<p class="mono" style="font-size:11px;color:var(--faint)">No substitutions — nothing needed changing.</p>';
    time.textContent = r.substitutions.length + ' substitution(s) in ' + r.durationMs.toFixed(2) + 'ms';
  }

  input.addEventListener('input', render);
  Array.prototype.forEach.call(document.querySelectorAll('[data-ex]'), function(b){
    b.addEventListener('click', function(){ input.value = b.getAttribute('data-ex'); render(); });
  });
})();
</script>
</body>
</html>
`;

writeFileSync(new URL('demo.html', root), html);
console.log(
  `Wrote demo.html (${(html.length / 1024).toFixed(0)}K, normaliser bundle ${(normaliserJs.length / 1024).toFixed(0)}K)`,
);
console.log(
  recorded.sessions.length === 0
    ? 'Recorded-calls section shows its "not captured yet" state — run npm run capture to populate.'
    : `Embedded ${recorded.sessions.length} captured sessions.`,
);
