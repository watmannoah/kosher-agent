/**
 * Drive one turn against a running dev server and pretty-print the trace.
 *
 * This is the "test via curl before any UI" step, with the SSE frames decoded
 * into something readable. It talks to the HTTP route rather than importing the
 * pipeline, so what it exercises is exactly what the browser will exercise.
 *
 *   npm run dev                      # in one terminal
 *   node scripts/trace.mjs "is Emek Dairy whole milk certified?"
 *
 * Options:
 *   --url <base>    default http://localhost:3000
 *   --json          dump raw events instead of the formatted trace
 */

const args = process.argv.slice(2);
let base = 'http://localhost:3000';
let raw = false;
const words = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url') base = args[++i];
  else if (args[i] === '--json') raw = true;
  else words.push(args[i]);
}

const text = words.join(' ') || 'Is Emek Dairy whole milk under your hashgacha?';

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const ms = (n) => (n === null || n === undefined ? '  —  ' : `${String(Math.round(n)).padStart(5)}ms`);

console.log(`\n${C.bold('CALLER')}  ${text}\n`);

const started = Date.now();
let response;
try {
  response = await fetch(`${base}/api/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, callId: `trace_${Date.now().toString(36)}`, turnId: 1 }),
  });
} catch (err) {
  console.error(C.red(`Could not reach ${base}. Is \`npm run dev\` running?`));
  console.error(C.dim(String(err.cause?.code ?? err.message)));
  process.exit(1);
}

if (!response.ok) {
  console.error(C.red(`HTTP ${response.status}`));
  console.error(await response.text());
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let streamed = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';

  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;

    let e;
    try {
      e = JSON.parse(line.slice(6));
    } catch {
      continue;
    }

    if (raw) {
      console.log(JSON.stringify(e));
      continue;
    }

    switch (e.t) {
      case 'normalised':
        if (e.substitutions.length) {
          console.log(`${C.cyan('NORMALISE')} ${ms(e.durationMs)}`);
          for (const s of e.substitutions) {
            console.log(
              `  ${C.dim(s.from)} ${C.dim('→')} ${C.bold(s.to)}  ` +
                C.dim(`${s.kind}/${s.method} ${s.confidence} — ${s.gloss}`),
            );
          }
        } else {
          console.log(`${C.cyan('NORMALISE')} ${ms(e.durationMs)} ${C.dim('no substitutions')}`);
        }
        break;

      case 'guardrail':
        console.log(
          `${C.yellow('GUARDRAIL')}         ${C.bold(e.hit.id)} ${C.dim(`(${e.stage}, ${e.hit.action})`)} ` +
            C.dim(`matched "${e.hit.matched}"`),
        );
        break;

      case 'triage':
        console.log(
          `${C.blue('TRIAGE')}    ${ms(e.durationMs)} ${e.model}  ` +
            C.dim(`in=${e.inputTokens} out=${e.outputTokens} $${e.costUsd.toFixed(6)}`),
        );
        console.log(
          `  intent=${C.bold(e.intent)} shailah=${e.isShailah ? C.red('true') : 'false'} ` +
            `other_agency=${e.asksOtherAgency} urgency=${e.urgency}`,
        );
        if (Object.keys(e.entities).length) {
          console.log(`  entities ${C.dim(JSON.stringify(e.entities))}`);
        }
        break;

      case 'plan':
        console.log(
          `${C.blue('ROUTE')}     ${C.bold(e.label)} on ${e.model} ` +
            C.dim(`— ${e.toolCount} tools: ${e.toolNames.join(', ') || 'none'}`),
        );
        console.log(`  speak=${C.bold(e.speakMode)} ${C.dim(e.verifyReason)}`);
        break;

      case 'tool_call':
        console.log(`${C.cyan('TOOL →')}    ${C.bold(e.name)} ${C.dim(JSON.stringify(e.input))}`);
        break;

      case 'tool_result': {
        const tag = e.ok ? C.green('ok') : C.red(e.error);
        console.log(`${C.cyan('TOOL ←')}    ${ms(e.durationMs)} ${e.name} ${tag}`);
        const d = e.result.ok ? e.result.data : e.result.data;
        if (d && typeof d === 'object') {
          const status = d.status ?? d.openState ?? d.availability ?? null;
          if (status) console.log(`  status=${C.bold(String(status))}`);
          if (d.meaning) console.log(`  ${C.dim(String(d.meaning).slice(0, 160))}`);
          if (Array.isArray(d.activeAlerts) && d.activeAlerts.length) {
            console.log(`  ${C.red(`ALERT: ${d.activeAlerts[0].headline}`)}`);
          }
        }
        if (!e.result.ok) console.log(`  ${C.dim(e.result.message.slice(0, 200))}`);
        break;
      }

      case 'first_token':
        console.log(`${C.blue('FIRST TOK')} ${ms(e.elapsedMs)}`);
        break;

      case 'text':
        streamed += e.delta;
        break;

      case 'draft':
        console.log(`${C.bold(`DRAFT ${e.attempt}`)}   ${e.text}`);
        break;

      case 'verifier':
        console.log(
          `${e.verdict === 'pass' ? C.green('VERIFY ✓') : C.red('VERIFY ✗')}  ${ms(e.durationMs)} ` +
            `${e.model} ${C.dim(`$${e.costUsd.toFixed(6)}`)}`,
        );
        console.log(`  ${e.ground ? C.red(`ground ${e.ground}: `) : ''}${C.dim(e.reason)}`);
        break;

      case 'blocked_draft':
        console.log(`${C.red('BLOCKED')}   by ${e.by}, attempt ${e.attempt}`);
        console.log(`  ${C.dim('rejected draft:')} ${C.red(e.text)}`);
        break;

      case 'retry':
        console.log(`${C.yellow('RETRY')}     attempt ${e.attempt} — ${C.dim(e.reason)}`);
        break;

      case 'final':
        console.log(`\n${C.bold('AGENT')}   ${e.fallback ? C.yellow('[safe deflection] ') : ''}${e.text}\n`);
        break;

      case 'metrics':
        console.log(C.bold('LATENCY'));
        console.log(`  normalise            ${ms(e.normaliseMs)}`);
        console.log(`  triage               ${ms(e.triageMs)}`);
        console.log(`  specialist 1st token ${ms(e.specialistFirstTokenMs)}`);
        console.log(`  tools (sum)          ${ms(e.toolMs)}`);
        console.log(`  verifier             ${ms(e.verifierMs)}`);
        console.log(`  ${C.bold('turn total')}           ${C.bold(ms(e.turnTotalMs))}`);
        console.log(
          `${C.bold('COST')}    turn $${e.turnCostUsd.toFixed(6)}  ` +
            C.dim(`in=${e.inputTokens} out=${e.outputTokens} by_agent=${JSON.stringify(e.costByAgent)}`),
        );
        break;

      case 'error':
        console.log(`${C.red('ERROR')}     ${e.message} ${C.dim(`retryable=${e.retryable}`)}`);
        break;

      case 'degraded':
        console.log(`${C.yellow('DEGRADED')}  ${e.reason}`);
        break;
    }
  }
}

if (streamed && !raw) {
  console.log(C.dim(`(streamed ${streamed.length} chars of text incrementally)`));
}
console.log(C.dim(`\nwall clock ${Date.now() - started}ms\n`));
