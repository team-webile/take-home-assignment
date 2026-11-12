#!/usr/bin/env tsx
/**
 * End-to-end smoke test for the Estimates API.
 *
 * Signs in as a seeded user, then exercises the real HTTP surface:
 *   list -> create (with Idempotency-Key) -> idempotent replay -> get by id
 *   -> lifecycle transitions -> filtered list -> no delete endpoint
 *   -> account boundary enforcement for a second, lower-privileged user
 *
 * Usage:
 *   npm run dev            # in one terminal
 *   npm run test:api       # in another
 *
 * Optional arguments:
 *   --email=<user@test.local>   user to sign in as   (default manager@test.local)
 *   --account=<uuid>            account to operate in (default: first account the user can see)
 *
 * Notes:
 *   - The API deliberately has no delete endpoint, so every run leaves one
 *     test estimate behind. That is the feature working as designed, not a leak.
 *   - The password is the seed password from scripts/create-seed-users.ts.
 */

import { createServerClient } from '@supabase/ssr';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
function loadEnv() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // rely on the ambient environment
  }
}
loadEnv();

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';
const SEED_PASSWORD = 'Test1234!';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
};

const EMAIL = arg('email') || 'manager@test.local';
const LOW_PRIVILEGE_EMAIL = arg('low-privilege-email') || 'contributor@test.local';

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) {
      console.log(`        ${JSON.stringify(detail).slice(0, 400)}`);
    }
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Build the `sb-Kontrora-auth` cookie exactly the way @supabase/ssr writes it
 * for the browser, so the request reaches the app with the same session the
 * real client would send.
 */
async function buildSessionCookie(email: string): Promise<string> {
  const store: Record<string, string> = {};
  const client = createServerClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    cookieOptions: { name: 'sb-Kontrora-auth' },
    cookies: {
      get: (name) => store[name],
      set: (name, value) => {
        store[name] = value;
      },
      remove: (name) => {
        delete store[name];
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  });
  if (error) {
    throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  }

  const base = 'sb-Kontrora-auth';
  if (store[base]) return store[base];

  // @supabase/ssr splits long cookies into `<name>-0`, `<name>-1`, ...
  const chunks = Object.keys(store)
    .filter((key) => key.startsWith(`${base}-`))
    .sort();
  if (chunks.length > 0) {
    return chunks.map((key) => store[key]).join('');
  }

  throw new Error(`Could not build a session cookie for ${email}`);
}

function apiClient(cookie: string) {
  return async function api(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {}
  ) {
    const response = await fetch(`${APP_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `sb-Kontrora-auth=${cookie}`,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, json, text };
  };
}

// ---------------------------------------------------------------------------
// Test run
// ---------------------------------------------------------------------------
async function main() {
  console.log('Kontrora — Estimates API smoke test');
  console.log(`Target: ${APP_URL}`);

  section('Session');
  const cookie = await buildSessionCookie(EMAIL);
  const api = apiClient(cookie);
  console.log(`  signed in as ${EMAIL}`);

  // Pick an account the user can reach.
  const accountsRes = await api('/api/accounts');
  const accounts: any[] = accountsRes.json?.accounts || [];
  const accountId = arg('account') || accounts[0]?.id;
  if (!accountId) {
    console.error('No account available for the signed-in user.');
    process.exit(1);
  }
  console.log(`  using account ${accountId}`);

  const base = `/api/accounts/${accountId}/estimates`;

  section('List');
  const list = await api(base);
  check('GET list returns 200', list.status === 200, list.json);
  check('GET list returns success=true', list.json?.success === true, list.json);
  check('GET list returns a pagination envelope', typeof list.json?.total === 'number', list.json);

  section('Create (draft)');
  const idempotencyKey = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const body = {
    title: 'Smoke test estimate',
    currency: 'USD',
    notes: 'Created by scripts/test-estimates-api.ts',
    lineItems: [
      { description: 'Design sprint', quantityMilli: 1500, unitAmountMinor: 125000, taxRateBasisPoints: 2000 },
      { description: 'Build support', quantityMilli: 10000, unitAmountMinor: 9500, taxRateBasisPoints: 0 },
    ],
  };

  const created = await api(base, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
  check('POST returns 201', created.status === 201, created.json);
  const estimateId = created.json?.estimate?.id;
  check('POST returns an estimate id', typeof estimateId === 'string', created.json);
  check('new estimate is a draft', created.json?.estimate?.status === 'draft', created.json?.estimate);
  check(
    'subtotal is the sum of line amounts',
    created.json?.estimate?.subtotal_minor === 125000 * 1.5 + 9500 * 10,
    created.json?.estimate
  );
  check(
    'tax is charged per line at its own rate',
    created.json?.estimate?.tax_minor === Math.round((125000 * 1.5 * 2000) / 10000),
    created.json?.estimate
  );
  check(
    'total is subtotal plus tax',
    created.json?.estimate?.total_minor ===
      created.json?.estimate?.subtotal_minor + created.json?.estimate?.tax_minor,
    created.json?.estimate
  );

  section('Idempotency');
  const replay = await api(base, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
  check('replaying the same key returns 200', replay.status === 200, replay.json);
  check('replay is flagged as a replay', replay.json?.idempotentReplay === true, replay.json);
  check('replay returns the original estimate', replay.json?.estimate?.id === estimateId, replay.json);
  const afterReplay = await api(base);
  check(
    'replay did not create a second estimate',
    (afterReplay.json?.total ?? 0) === (list.json?.total ?? 0) + 1,
    { before: list.json?.total, after: afterReplay.json?.total }
  );

  section('Get by id');
  const one = await api(`${base}/${estimateId}`);
  check('GET by id returns 200', one.status === 200, one.json);
  check('estimate carries its line items', (one.json?.estimate?.line_items?.length ?? 0) === 2, one.json);
  check(
    'estimate carries its status history',
    (one.json?.estimate?.status_history?.length ?? 0) >= 1,
    one.json?.estimate?.status_history
  );

  section('Lifecycle');
  const send = await api(`${base}/${estimateId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'sent' }),
  });
  check('draft -> sent returns 200', send.status === 200, send.json);
  check('status is now sent', send.json?.estimate?.status === 'sent', send.json?.estimate);

  const invalid = await api(`${base}/${estimateId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'sent' }),
  });
  check('sent -> sent is rejected with 409', invalid.status === 409, invalid.json);
  check('rejection reports the allowed transitions', Array.isArray(invalid.json?.allowed), invalid.json);

  const accept = await api(`${base}/${estimateId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'accepted', note: 'Accepted by the smoke test' }),
  });
  check('sent -> accepted returns 200', accept.status === 200, accept.json);
  check('status is now accepted', accept.json?.estimate?.status === 'accepted', accept.json?.estimate);

  const afterAccept = await api(`${base}/${estimateId}`);
  const history: any[] = afterAccept.json?.estimate?.status_history ?? [];
  const toStatuses = history.map((h) => h.to_status);
  check(
    'history recorded every transition',
    toStatuses.join(',') === 'draft,sent,accepted',
    toStatuses
  );
  check(
    'a rejected transition is not written to the history',
    toStatuses.filter((s) => s === 'sent').length === 1,
    toStatuses
  );
  check(
    'history is append only and never rewritten',
    history.every((h) => h.from_status !== undefined && h.created_at),
    history
  );

  section('Filtering');
  const filtered = await api(`${base}?status=accepted`);
  check('filtered list returns 200', filtered.status === 200, filtered.json);
  check(
    'filtered list only contains accepted estimates',
    (filtered.json?.estimates || []).every((e: any) => e.status === 'accepted'),
    filtered.json?.estimates?.map((e: any) => e.status)
  );
  check(
    'the accepted estimate is in the filtered list',
    (filtered.json?.estimates || []).some((e: any) => e.id === estimateId),
    filtered.json?.estimates
  );

  section('No hard deletes');
  const del = await api(`${base}/${estimateId}`, { method: 'DELETE' });
  check('DELETE is not implemented', del.status === 405 || del.status === 404, { status: del.status });

  section('Account boundary');
  const lowCookie = await buildSessionCookie(LOW_PRIVILEGE_EMAIL);
  const lowApi = apiClient(lowCookie);
  const forbidden = await lowApi(base);
  check(
    'a user without access to the account is refused',
    forbidden.status === 403,
    { status: forbidden.status, body: forbidden.json }
  );

  const otherAccountId = accounts.find((a: any) => a.id !== accountId)?.id;
  if (otherAccountId) {
    const other = await lowApi(`/api/accounts/${otherAccountId}/estimates`);
    check(
      'the same user is refused on a second account too',
      other.status === 403,
      { status: other.status, body: other.json }
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nSmoke test aborted:', error instanceof Error ? error.message : error);
  process.exit(1);
});
