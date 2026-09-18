/**
 * Verify that each configured model id exists and accepts the request shape we
 * build for its tier.
 *
 * Worth having as a standing script rather than a one-off: the two tiers reject
 * different parameters (Sonnet 5 rejects `temperature`, Haiku 4.5 rejects
 * `output_config.effort`), both with a 400 rather than a degradation. Swapping
 * a model id in config can therefore produce an invalid request that only
 * shows up mid-call. This catches it in two seconds.
 *
 *   node scripts/check-models.mjs
 */

import { readFileSync } from 'node:fs';

// Minimal .env.local loader — this runs outside Next, which would normally do it.
function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // Absent file is fine; the key may come from the real environment.
  }
}
loadEnv(new URL('../.env.local', import.meta.url).pathname);

const config = JSON.parse(
  readFileSync(new URL('../config/agent.config.json', import.meta.url), 'utf8'),
);

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set. Put it in .env.local.');
  process.exit(1);
}

/** Build the same body shape src/lib/agents/client.ts builds for a tier. */
function bodyFor(tier) {
  const m = config.models[tier];
  const body = {
    model: m.id,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  };
  if (m.supportsTemperature && typeof m.temperature === 'number') body.temperature = m.temperature;
  if (m.supportsEffort) {
    if (m.effort) body.output_config = { effort: m.effort };
    if (m.thinking === 'disabled') body.thinking = { type: 'disabled' };
  }
  return body;
}

let failed = false;

// Keys beginning with $ are documentation, not model tiers.
const tiers = Object.keys(config.models).filter((k) => !k.startsWith('$'));

for (const tier of tiers) {
  const body = bodyFor(tier);
  const shape = Object.keys(body)
    .filter((k) => k !== 'messages')
    .map((k) => (typeof body[k] === 'object' ? `${k}=${JSON.stringify(body[k])}` : `${k}=${body[k]}`))
    .join(' ');

  const started = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - started;
  const json = await res.json();

  if (!res.ok) {
    failed = true;
    console.log(`FAIL  ${tier.padEnd(10)} ${config.models[tier].id}`);
    console.log(`      ${res.status} ${json?.error?.type}: ${json?.error?.message}`);
    console.log(`      sent: ${shape}`);
  } else {
    const text = (json.content ?? []).find((b) => b.type === 'text')?.text?.trim() ?? '';
    console.log(
      `ok    ${tier.padEnd(10)} ${config.models[tier].id.padEnd(22)} ${String(elapsed).padStart(5)}ms  ` +
        `in=${json.usage?.input_tokens} out=${json.usage?.output_tokens}  "${text}"`,
    );
    console.log(`      sent: ${shape}`);
  }
}

process.exit(failed ? 1 : 0);
