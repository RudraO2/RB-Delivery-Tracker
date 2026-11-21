// One private request on stdin, one response on stdout. No listening server,
// command-line parcel numbers, or logs containing customer information.
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

// Free sources asked when the carrier's own site gives no history (USPS and others block
// automated checks). They receive only the tracking number and postcode, never a name or address.
export const FALLBACK_PROVIDERS = ['UPU', 'ParcelsApp', 'Ship24'];

const STAGES = new Set(['pending', 'registered', 'accepted', 'in_transit', 'out_for_delivery', 'delivered', 'customs', 'failed_attempt', 'ready_for_pickup', 'returned', 'exception']);
const KINDS = new Set(['not_found', 'indeterminate', 'challenge', 'rate_limited', 'maintenance', 'schema', 'input_required', 'invalid_input', 'transport', 'budget']);
const ERRORS = {
  not_found: 'Tracking number not found yet.',
  indeterminate: 'The tracking source did not return a usable result.',
  challenge: 'The carrier blocked the automatic check.',
  rate_limited: 'The carrier is limiting requests. Try again later.',
  maintenance: 'The tracking source is temporarily unavailable.',
  schema: 'The tracking source returned an unexpected response.',
  input_required: 'The carrier needs additional information, such as a postcode.',
  invalid_input: 'The tracking number or carrier could not be used.',
  transport: 'Could not connect to the tracking source.',
  budget: 'The tracking check timed out.',
};

const text = (v, max = 1000) => typeof v === 'string' ? v.slice(0, max) : '';
const stage = value => STAGES.has(value) ? value : 'unknown';

export function browserPath(env = process.env, fileExists = existsSync) {
  const candidates = [
    [env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'],
  ];
  // Always Windows paths: the installed app only runs on Windows, and tests run on any OS.
  return candidates.filter(x => x[0]).map(x => win32.join(...x)).find(fileExists);
}

export async function lookup(input, createTracker) {
  const number = typeof input?.number === 'string' ? input.number.trim().replace(/[\s.-]/g, '') : '';
  const carrier = typeof input?.carrier === 'string' ? input.carrier.trim().toLowerCase() : '';
  const postcode = typeof input?.postcode === 'string' ? input.postcode.trim() : '';
  if (!/^[a-zA-Z0-9]{5,80}$/.test(number) || (carrier && !/^[a-z0-9-]{1,80}$/.test(carrier)) || postcode.length > 40) {
    return { ok: false, kind: 'invalid_input', error: ERRORS.invalid_input, retry_after_ms: null };
  }
  try {
    const tracker = createTracker({ chromiumPath: browserPath(), providers: FALLBACK_PROVIDERS, userAgent: 'RBTracker/1.0' });
    const answer = await tracker.track({ number, ...(carrier ? { carrier } : {}), ...(postcode ? { postcode } : {}) }, { budgetMs: 75_000 });
    const result = answer?.result ?? {};
    const events = Array.isArray(result.events) ? result.events.slice(0, 200).map(e => ({
      // instant has a known timezone; retain unknown local time separately.
      time: text(e?.instant, 80) || null,
      local_time: text(e?.local_time, 80) || null,
      description: text(e?.description),
      location: text(e?.location),
      stage: stage(e?.stage),
    })) : [];
    const current = stage(result.current_stage ?? result.status);
    if (!events.length && current === 'unknown') throw { hint: { kind: 'indeterminate' } };
    // Some carriers omit the summary delivery date but provide a dated delivery scan.
    // Keep the carrier's original local clock rather than assigning it a timezone.
    const deliveredScans = events.filter(e => e.stage === 'delivered').map(e => e.time || e.local_time).filter(value => value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a));
    const deliveredAt = text(result.delivered_at, 80) || deliveredScans[0] || null;
    return { ok: true, stage: current, events, source: text(answer.source, 100), carrier: text(answer.carrier, 100), delivered_at: deliveredAt, last_update: text(result.last_update, 80) || null };
  } catch (error) {
    const candidate = error?.hint?.kind ?? error?.kind;
    const kind = KINDS.has(candidate) ? candidate : 'transport';
    const retry = error?.hint?.retryAfterMs;
    return { ok: false, kind, error: ERRORS[kind], retry_after_ms: Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86_400_000) : null };
  }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 8192) throw new Error('input too large');
  }
  const request = JSON.parse(input);
  // Prevent accidental diagnostic logs from corrupting the private JSON protocol.
  console.log = console.info = console.warn = console.error = () => {};
  const { createTracker } = await import('universal-parcel-scraper/node');
  const result = await lookup(request, createTracker);
  process.stdout.write(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => process.stdout.write(JSON.stringify({ ok: false, kind: 'transport', error: 'The tracking engine could not start.', retry_after_ms: null })));
}
