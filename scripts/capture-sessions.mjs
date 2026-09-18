/**
 * Capture the four demonstration sessions from a running deployment.
 *
 *   node scripts/capture-sessions.mjs --url https://your-app.vercel.app --passcode xxx
 *
 * Writes data/recorded-sessions.json. The recorded-calls panel reads that file
 * and replays it, so what a visitor watches is a real trace from a real run
 * against real models — labelled with the timestamp it was captured, and with
 * the annotations derived from the events that actually occurred rather than
 * written by hand to flatter the system.
 *
 * Playback is browser speech synthesis over the captured transcript, not
 * recorded audio. The panel says so.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
let base = 'http://localhost:3000';
let passcode = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url') base = args[++i].replace(/\/$/, '');
  else if (args[i] === '--passcode') passcode = args[++i];
}

if (!passcode) {
  // Fall back to .env.local so a local capture needs no arguments.
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    passcode = /^DEMO_PASSCODE=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
  } catch {
    /* no local env; --passcode may still be unnecessary if no gate is set */
  }
}

/** The four calls from BRIEF 7.6. */
const SCENARIOS = [
  {
    id: 'is-this-certified',
    title: 'Is this certified',
    subtitle: 'The clean happy path',
    why: 'Status is never stated before the lookup returns it, and the answer carries the detail a caller actually needs.',
    turns: ['Hi, is Emek Dairy whole milk under your hashgacha?'],
  },
  {
    id: 'not-in-our-database',
    title: 'Not in our database',
    subtitle: 'The credibility call',
    why: 'Absence from our records means we do not certify it — not that it is not kosher. This is the distinction that separates a system that understands the domain from one that does not.',
    turns: ['Is Tzofim Honey Wafers kosher?'],
  },
  {
    id: 'thats-a-shailah',
    title: "That's a shailah",
    subtitle: 'Heavy Yiddish, and a question the hotline must not answer',
    why: 'The terminology is mangled the way speech recognition actually mangles it, and the question is one no hotline may answer. Normalisation earns its place and the shailah router hard-stops the pipeline.',
    turns: ['i got a shy la — i stirred a milk hig pot with a flay shig spoon, can i still use it'],
  },
  {
    id: 'want-to-get-certified',
    title: 'I want to get certified',
    subtitle: 'Sales scoping and routing',
    why: 'Pricing is a lead, not a quote. The caller pushes for one number and does not get it.',
    turns: [
      'I run a snack food plant, one facility, about eight products. What exactly will certification cost me? Just give me a number for my boss.',
    ],
  },
];

/**
 * Annotations derived from the event stream.
 *
 * Keyed to events that actually fired, so an annotation cannot claim something
 * the run did not do. Each carries the index of the event it attaches to, which
 * is what lets the player pop it at the right moment during replay.
 */
function deriveAnnotations(events) {
  const notes = [];
  let sawToolResult = false;

  events.forEach((event, index) => {
    switch (event.t) {
      case 'normalised':
        if (event.substitutions.length > 0) {
          notes.push({
            index,
            text: `← ${event.substitutions.length} term${event.substitutions.length === 1 ? '' : 's'} recovered before any model saw the text: ${event.substitutions.map((s) => `${s.from} → ${s.to}`).join(', ')}`,
          });
        }
        break;

      case 'triage':
        if (event.isShailah) {
          notes.push({
            index,
            text: '← triage flagged this as a shailah, which hard-stops the normal pipeline from any state',
          });
        }
        break;

      case 'plan':
        notes.push({
          index,
          text: `← routed to ${event.label} on ${event.model}, holding ${event.toolCount} of the 10 tools — not all of them`,
        });
        if (event.speakMode === 'after_verify') {
          notes.push({
            index,
            text: '← this turn can carry a certification claim, so the audio is held until the verifier clears it',
          });
        }
        break;

      case 'tool_result': {
        sawToolResult = true;
        const data = event.result?.ok ? event.result.data : event.result?.data;
        const status = data?.status ?? null;
        if (status === 'not_in_database' || status === 'not_certified_by_us') {
          notes.push({
            index,
            text: '← the lookup says we do not certify it. That is not a statement about its kashrus, and the tool result says so explicitly',
          });
        } else if (status) {
          notes.push({ index, text: `← lookup returned status = ${status}` });
        }
        if (Array.isArray(data?.activeAlerts) && data.activeAlerts.length > 0) {
          notes.push({ index, text: '← an active alert came back and must be raised unprompted' });
        }
        break;
      }

      case 'first_token':
        if (sawToolResult) {
          notes.push({
            index,
            text: '← no status was stated until the lookup had returned',
          });
        }
        break;

      case 'blocked_draft':
        notes.push({
          index,
          text: `← the ${event.by} blocked the first draft before the caller heard it: ${event.reason}`,
        });
        break;

      case 'verifier':
        notes.push({
          index,
          text:
            event.verdict === 'pass'
              ? '← verifier checked every claim against the raw tool results and passed it'
              : `← verifier blocked on ground ${event.ground}`,
        });
        break;

      case 'guardrail':
        notes.push({ index, text: `← guardrail fired: ${event.hit.label}` });
        break;

      case 'metrics':
        notes.push({
          index,
          text: `← ${Math.round(event.turnTotalMs)}ms end to end, $${event.turnCostUsd.toFixed(5)} for the turn`,
        });
        break;
    }
  });

  return notes;
}

async function authenticate() {
  if (!passcode) return '';
  const res = await fetch(`${base}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  if (!res.ok) {
    console.error(`Passcode rejected (${res.status}). Pass --passcode.`);
    process.exit(1);
  }
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function runTurn(text, cookie, callId, turnId, history) {
  const res = await fetch(`${base}/api/turn`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ text, callId, turnId, history }),
  });

  if (!res.ok) {
    throw new Error(`/api/turn returned ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  // Arrival time relative to the request, so replay is faithful to the real
  // pacing rather than a fixed cadence that would make a slow turn look fast.
  const started = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        events.push({ atMs: Date.now() - started, ...JSON.parse(line.slice(6)) });
      } catch {
        /* skip a malformed frame rather than abandoning the capture */
      }
    }
  }

  return events;
}

const cookie = await authenticate();
console.log(`Capturing against ${base}\n`);

const sessions = [];

for (const scenario of SCENARIOS) {
  console.log(`  ${scenario.title}…`);
  const callId = `rec_${scenario.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  const allEvents = [];
  const history = [];

  for (const [i, text] of scenario.turns.entries()) {
    const events = await runTurn(text, cookie, callId, i + 1, history);
    allEvents.push(...events);

    const final = events.find((e) => e.t === 'final');
    if (final) {
      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: final.text });
      console.log(`    → ${final.text.slice(0, 100)}${final.text.length > 100 ? '…' : ''}`);
    }
  }

  sessions.push({
    ...scenario,
    capturedAt: new Date().toISOString(),
    events: allEvents,
    annotations: deriveAnnotations(allEvents),
  });
}

const output = {
  _notice:
    'Real traces captured from a real run against real models. Playback in the browser uses ' +
    'speech synthesis over the captured transcript — it is not recorded audio. Annotations are ' +
    'derived from the events that actually fired.',
  capturedAt: new Date().toISOString(),
  capturedFrom: base,
  sessions,
};

const target = new URL('../data/recorded-sessions.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);

console.log(`\nWrote ${sessions.length} sessions to data/recorded-sessions.json`);
console.log('Commit it, and the recorded-calls panel will play them.');
