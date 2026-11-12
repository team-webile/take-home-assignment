# Kontrora — Estimates (Revenue & Billing)

A Staff Engineer assignment slice shipped end-to-end on the Kontrora PSA platform:
**account-scoped Estimates with line items, a real lifecycle, financial-grade RBAC,
and a UI under account context.**

Everything below was built, applied to a live Supabase project, and verified in a
browser. Where something is a deliberate trade-off rather than a finished thing, it
says so.

---

## 1. What shipped

| # | Brief | Delivered |
|---|-------|-----------|
| 1 | Schema: estimates + line items, account-bound, minor units, optional project link | `supabase/estimates.sql` — `estimates`, `estimate_line_items`, `estimate_status_history` |
| 2 | Lifecycle `draft → sent → accepted \| rejected`; no hard deletes | `lib/estimate-service.ts` — validated transition map, append-only status history, no delete path anywhere |
| 3 | RBAC for financial data; account boundaries on every route | `VIEW_ESTIMATES` / `MANAGE_ESTIMATES` / `MANAGE_ESTIMATE_LIFECYCLE` in `lib/permissions.ts`; every estimates route resolves the account from the path and filters on it unconditionally |
| 4 | API: server-side list/filter, create with `Idempotency-Key`, get by id | `app/api/accounts/[accountId]/estimates/route.ts` and `.../[estimateId]/route.ts` |
| 5 | UI under account context: list, create draft, line-item editor | `components/estimates/*` and `app/accounts/[accountId]/estimates/page.tsx` |

Also included, because the brief's points 3–5 are unreachable without them:
a repair of six blocking defects in the base repository (§4), and a working
permission editor so the new financial permissions are grantable from the UI
rather than only by SQL.

---

## 2. Architecture decisions

### 2.1 Money is integer minor units, everywhere

There is no float anywhere in the money path. Amounts are stored as `bigint`
minor units (cents for USD/EUR/GBP, yen for JPY, fils for BHD/KWD — the exponent
table lives in `lib/money.ts`), quantities are stored as `integer` thousandths,
and tax rates are `integer` basis points.

`lib/money.ts` is the **single source of truth** for every conversion, and it is
the only place that converts between major units and minor units:

- `parseMinor("1,234.56", "USD") → 123456` — string-based, so no float rounding.
- `parseMinor("10.005", "USD") → null` — it **refuses** to silently drop precision
  the currency cannot represent. Truncating money silently is worse than
  rejecting it, so the UI surfaces an error instead.
- `parseMinor("1234.00", "JPY") → 1234` — trailing zeros are fine for a
  zero-decimal currency.

The platform had no working money precedent to copy: the only monetary column in
the schema is `escrows.amount_per_milestone`, and the one component that
displayed it (`components/project-escrow.tsx`) is never rendered. Rather than
invent a second convention, `lib/money.ts` is now the one place the rules live.

**Tax is charged per line at that line's own rate**, then summed. A mixed-rate
estimate therefore comes out right, and the classic bug of taxing an
already-taxed subtotal is structurally impossible.

*Why not a decimal type or a money library?* Postgres `numeric` would work, but
the API has to serialise amounts over JSON, where `numeric` becomes a string and
every consumer has to re-parse it. Integer minor units are the smallest honest
representation: one type, no ambiguity, no rounding until the very last step.

### 2.2 The account comes from the route, never from the query string

Every estimates query applies `.eq('account_id', accountId)` **unconditionally**,
where `accountId` comes from the path segment. There is no code path where a
caller-supplied parameter can widen the result set — a missing filter is a
compile-time impossibility, not a review item.

`listEstimates`, `getEstimateById`, `updateEstimateDraft` and `transitionEstimate`
all take the account as a required argument and filter on it in the query itself.
Permission checks happen in the route (`lib/server-guards.ts`) *before* the
service is called; the service is the second layer, not the first.

### 2.3 Server-side only data access for Estimates

The Estimates feature reads and writes through the **service-role client on the
server**. The browser never talks to PostgREST for financial data.

This is deliberate and it is a departure from the rest of the codebase. The
existing client-side pattern (components call `createClientSupabase()` and query
PostgREST directly with the anon publishable key) is exactly how the base
schema's permissive policies let the anon key read everything. Estimates do not
use that path, so the new tables do not need the platform's blanket
`"to public using (true)"` policies to be safe.

### 2.4 The lifecycle is self-contained

An estimate carries its own `status` column and its own append-only
`estimate_status_history` table. It does **not** reuse the platform's workflow
engine.

The workflow engine is template-bound: `workflow_templates` → `workflow_nodes` →
`workflow_instances` → `workflow_active_steps`, with the entity attached to a
node. Modelling an estimate's lifecycle through it would mean inventing a
workflow template per estimate type, and the engine's own seed data is already
broken (`workflow_instances` has a dangling foreign key). A five-state lifecycle
with three permissions does not need a general-purpose workflow engine, and
reusing it would have coupled a revenue feature to a subsystem that does not
currently work.

Allowed transitions:

```
draft  → sent | void
sent   → accepted | rejected | void
accepted / rejected / void  → (terminal)
```

**There is no transition back to `draft`.** Once an estimate has been sent, its
content is frozen. Reverting a sent estimate to an editable draft would silently
change what the client agreed to. The only way to change a priced estimate is to
void it and raise a new one — which leaves the original in the record.

An invalid transition returns `409` with the list of transitions that *would*
have been allowed, so a client can recover without guessing.

### 2.5 No hard deletes — enforced at three levels

The brief asks for no hard deletes. That is enforced structurally, not by
convention:

1. **No route.** `app/api/accounts/[accountId]/estimates/[estimateId]/route.ts`
   exports `GET` and `PATCH`. There is no `DELETE` handler, so `DELETE` returns
   `405`.
2. **No policy.** The three new tables have RLS enabled with `SELECT` / `INSERT`
   / `UPDATE` policies scoped to `authenticated` and to the caller's account.
   **There is deliberately no `DELETE` policy**, so even a service-role-adjacent
   mistake that bypasses the app cannot cascade a delete through the API.
3. **No affordance.** The UI renders no delete control. A draft can be voided; a
   voided estimate stays visible with its full history.

Status history is append-only in the same way: the only write path appends a
row, and there is no update or delete on that table.

### 2.6 Idempotency on create

`POST /api/accounts/[accountId]/estimates` accepts an `Idempotency-Key` header.
The key is stored in a `unique (account_id, idempotency_key)` constraint.

- First request → `201` with the created estimate.
- Repeat with the same key → `200` with **the original estimate** and
  `idempotentReplay: true`. No duplicate is created.

The constraint does the work; the service catches `23505` and looks the original
up. A double-clicked button, a client retry after a timeout, or two tabs racing
all produce exactly one estimate.

The client generates the key **once per drafting session** and reuses it for
every retry of that submission (`components/estimates/estimate-create-dialog.tsx`),
and only issues a new key for the next estimate. If the key were regenerated per
attempt, the idempotency would protect nothing.

The `Idempotency-Key` is scoped per account, not globally — the same key can
legitimately be used for estimates on two different accounts.

### 2.7 Financial permissions are three permissions, not one

| Permission | Grants | Deliberately excluded |
|---|---|---|
| `view_estimates` | Read estimates and line items for accounts you can reach | No "view all estimates" override exists |
| `manage_estimates` | Create and edit draft estimates | Cannot send an estimate |
| `manage_estimate_lifecycle` | Move an estimate through its lifecycle | Cannot edit its price |

Splitting *pricing* from *commercial commitment* matters: the person who
prepares a quote should not be the person who commits the company to it. A
single `manage_estimates` permission would conflate the two.

**There is deliberately no org-wide override** for any of the three. Financial
data is never "all accounts" by default — the same way `MANAGE_ACCOUNTS` and
`MANAGE_PROJECTS` have no blanket override. The estimate permissions are
*base* permissions: they are always evaluated in the context of an account the
caller can already reach, which is the context match in
`lib/permission-checker.ts`.

They live in their own `Financial` category in the permission UI, separate from
`Account Management` and `Project Management`.

### 2.8 Estimates live at `/accounts/[accountId]/estimates`

A dedicated account-scoped route, not a tab on the account overview.
`components/account-overview.tsx` has no tab structure to extend, and the
breadcrumb already resolves `/accounts/<uuid>` to the account name, so the page
gets correct navigation for free. `noSidebarPages` keeps it out of the global
sidebar — it is reached through the account, which is where it belongs.

### 2.9 The new API routes are TypeScript; the old ones are not

Every pre-existing file under `app/api/**` is a `.js` CommonJS file with
`exports.GET = GET` at the bottom. Those are **build artefacts**, not a
convention — they are compiled output that was committed. The new Estimates
routes (and the new role-permissions route) are ordinary TypeScript App Router
handlers.

This is an intentional inconsistency, and I would rather have one new `.ts`
route than extend a `.js` artefact that looks like it is hand-written source.
Converting the other 118 routes is a separate, mechanical change (§5).

### 2.10 The permission editor was orphaned and is now wired

`components/admin/permission-manager.tsx` existed but was imported by nothing —
so the new financial permissions could only be granted by editing SQL. It is now
reachable from `/admin/roles` via a **Permissions** button on every role row,
backed by a new TypeScript route `app/api/roles/[roleId]/permissions/route.ts`
(`GET` reads the full permission map, `PUT` replaces it).

Two details worth calling out:

- The stored shape is `roles.permissions` JSONB, which only ever holds **granted**
  permissions (`{"view_estimates": true}`). The API returns a *complete* map
  (every known permission → `true`/`false`) so the UI can distinguish "not
  granted" from "not represented", and writes back only the grants.
- System roles are rejected with `400`. Their permissions are part of the
  platform contract, not a runtime-administrator's choice. The UI shows the
  existing "System Role Protection" panel instead.

---

## 3. Security & tenancy review

### 3.1 The tenancy model

Tenancy for Estimates is enforced in **three independent layers**. Any one of
them failing would still not leak another account's data:

| Layer | Mechanism | Failure mode it prevents |
|---|---|---|
| Route | `requireAuthAndPermission(perm, { accountId }, request)` → context match against `account_members` / `accounts.account_manager_id` | A user without membership reaching a foreign account id |
| Query | `.eq('account_id', accountId)` baked into every query in `lib/estimate-service.ts` | A missing filter widening a result set |
| Row level security | `has_account_access(account_id)` helper, `SECURITY DEFINER`, used by every policy on the new tables | Direct PostgREST access that bypasses the app layer |

`has_account_access()` excludes revoked memberships: `account_members.removed_at`
must be `null` for the membership to grant access. It also recognises the
account manager (`accounts.account_manager_id = auth.uid()`) and superadmins.

The helper is `SECURITY DEFINER` on purpose — reading `account_members` through
the table's own (permissive) policies would recurse.

### 3.2 The `anon` key can no longer read anything

`supabase/security-hardening.sql` revokes `all` on every table, sequence,
function and routine in the `public` schema from `anon`, and sets the same
default privileges for anything created later. Verified live: `has_table_privilege('anon', …)`
is now **false** for `estimates`, `accounts` and `user_profiles`.

This was the highest-impact change in the fork. In the base schema, policies are
written as `"to public using (true)"`, and the browser ships the **anon
publishable key** to every visitor — so the anon role could read every table in
the database, including anything financial, without a session.

### 3.3 The new tables have real RLS

Every policy on `estimates`, `estimate_line_items` and `estimate_status_history`
is `TO authenticated` and scoped to the caller's account:

```sql
create policy "estimates_select_scoped" on public.estimates
  for select to authenticated
  using (public.has_account_access(account_id));
```

Line items and status history are reached through
`can_access_estimate(estimate_id)`, so they inherit the same boundary. There is
no `DELETE` policy on any of the three.

### 3.4 What I found and fixed in the base repository

The brief's points 3 and 5 ("enforce account boundaries on every route", "UI
under account context") are unreachable on the base repo as shipped. Six
blocking defects were found by running the app, not by reading it:

1. **Ambiguous PostgREST embed** (`lib/account-service.ts`) — `user_profiles(*)`
   was ambiguous because FKs run in both directions, so PostgREST returned HTTP
   300 and **every account page 404'd for every user**. Fixed with an explicit
   FK hint: `user_profiles!accounts_account_manager_id_fkey(*)`.
2. **33 broken API route files** — 78 call sites imported a function that
   `lib/supabase-server.ts` did not export. Added a single
   `getUserFromRequest(request)` export; all 33 files work again.
3. **10 files used `apiFetch` without importing it** — 4 dashboard widgets, the
   invitation dialog, the department-delete dialog, the task-creation dialog,
   the unified projects section, `app/setup/page.tsx`, `lib/auth.ts`.
4. **`components/loading-overlay.tsx` called `setState` during render** — React
   threw, the overlay never resolved, and the UI froze behind a permanent
   spinner. Deferred the state updates out of the render phase, deleted the
   `beforeunload → startLoading` handler, added an unconditional fallback
   timeout so the overlay can never stick, and replaced the per-render
   `searchParams` object with a stable string dependency.
5. **Schema/code drift** — `roles.display_order` and `tasks.display_order` were
   written by the code but missing from `supabase/schema.sql`; the `accounts.status`
   and `tasks.status` CHECK constraints did not match the values the application
   validates; `supabase/seed-roles.sql` was not re-runnable. All reconciled.
6. **`/api/accounts` had no tenancy filter** — it returned every account in the
   organisation to any authenticated user. Now scoped by membership and managed
   accounts, honouring `removed_at`. This was a real data leak and it is fixed.

Also added: `lib/debug-logger.ts` is a **no-op stub** — every `logger.error(...)`
in the codebase discards its argument, which is why a 500 in the estimates API
initially produced no diagnostic output at all. The new routes log with
`console.error` so a failure is actually visible in the server log.

### 3.5 Verified account boundary

The API test suite signs in as a Contributor who is a member of one account and
asserts that requests for **two other accounts** are refused with `403`:

```
Account boundary
  PASS  a user without access to the account is refused
  PASS  the same user is refused on a second account too
```

### 3.6 Known remaining risks (not fixed in this fork)

These are real and I am not claiming otherwise:

- **The other 37 tables still have `"to public using (true)` policies.** The
  `anon` revoke stops anonymous reads, but any authenticated user can still read
  every row of every other table through PostgREST directly. The Estimates
  tables are the only ones with genuine per-tenant RLS. Rewriting the other 37
  tables is §5's first item — it is a large, mechanical change and doing it
  badly would be worse than doing it properly.
- **The client-side PostgREST pattern remains elsewhere.** Components outside
  this feature still query the database directly from the browser. The
  estimates UI does not (see §2.3), but the platform does.
- **`Client` and `Superadmin` roles exist twice**, with different UUIDs —
  `schema.sql` inserts them and `seed-roles.sql` inserts them again with
  different ids. Cosmetic for now (both rows exist, both are valid), but a
  role-assignment bug waiting to happen.
- **`components/account-overview.tsx` references `accountKanbanConfigService`,
  which does not exist.** The account overview page throws at runtime
  ("Failed to load accounts") for every user. It is pre-existing and outside the
  estimates slice; `npx tsc --noEmit` reports it, and the estimates page does
  not depend on it.
- **The `workflow_instances` seed has a dangling foreign key.** Pre-existing;
  unrelated to this slice.

---

## 4. Running the tests

```bash
npm install

# 1. Unit tests — the money module. No database, no server.
npx vitest run                 # 29 tests

# 2. API smoke test — needs a running app and a seeded database.
npm run dev                    # in one terminal
npm run test:api               # in another  -> 31 checks
```

`npm run test:api` is an end-to-end HTTP test against a live dev server: it
signs in, creates a draft, replays the same `Idempotency-Key` to prove no
duplicate is created, walks the lifecycle `draft → sent → accepted`, asserts
that an invalid transition is rejected with `409`, filters the list by status,
asserts that `DELETE` is not implemented, and asserts that a user without
access to the account is refused for two different accounts.

Current status: **29/29 unit tests pass, 31/31 API checks pass.**

### Setting up the database

```bash
cp .env.local.template .env.local   # fill in URL + keys
```

Then, in the Supabase SQL editor, in this order:

```sql
-- 1. base schema
\i supabase/schema.sql

-- 2. roles (re-runnable)
\i supabase/seed-roles.sql

-- 3. the Estimates slice
\i supabase/estimates.sql

-- 4. close the anon hole
\i supabase/security-hardening.sql
```

Then seed the demo users:

```bash
npm run seed:users
```

`supabase/estimates.sql` and `supabase/seed-roles.sql` are both written to be
re-runnable (`create table if not exists`, `on conflict do update`), so they can
be re-applied safely during development.

> **Note:** `supabase/security-hardening.sql` revokes `anon` from the whole
> `public` schema. If any part of the app still relies on anonymous PostgREST
> access, that part will stop working — that is the point, but it is why this
> runs as a separate, explicit step.

### Type checking

```bash
npx tsc --noEmit
```

The Estimates code is clean. The repository has pre-existing type errors in
`components/account-overview.tsx`, `components/department-overview.tsx`,
`app/projects/page.tsx` and `lib/hooks/use-data.ts` — these predate this work
and are listed in §3.6.

---

## 5. What I would ship next

**In order of how much they reduce risk:**

1. **Finish the RLS migration for the remaining 37 tables.** Replace every
   `"to public using (true)"` with account-scoped policies, per table, and add a
   CI check that fails when a new table ships without a tenant-scoped policy.
   Until this is done, "enforce account boundaries on every route" is true of
   *my* routes and not of the platform. This is the single biggest open item.

2. **Move all data access server-side.** The client-side PostgREST pattern is
   the root cause of most of the tenancy risk. Estimates already do this
   (§2.3); the rest of the platform should follow, route by route, as the
   components are touched.

3. **Stripe.** Accept the deposit on an accepted estimate. Concretely:
   - a `payment_intents` table keyed to `estimate_id`;
   - a Stripe webhook (`checkout.session.completed`, `invoice.paid`) that is
     **idempotent on the Stripe event id** — the same trap I already had to
     handle for estimates, and the one place a money bug would really hurt;
   - the estimate's status becomes a *derived* view over estimate + payments
     rather than a second source of truth.

4. **Reconciliation.** A nightly job that compares our `total_minor` against the
   sum of its line items, recomputes from the stored line items rather than
   trusting the stored totals, and raises an alert on any drift. The invariant
   `total_minor = subtotal_minor + tax_minor` should be enforced by a database
   constraint, not only by the service layer.

5. **Versioned estimates.** Today, editing a draft replaces it in place. The
   moment a client has seen a number, we want an immutable revision history —
   `estimate_revisions` with a `revision` number, and the accepted revision
   pinned on the estimate. The `estimate_status_history` table is already the
   right shape for this.

6. **Real tax.** The current tax rate is a per-line basis-point figure entered
   by hand. A tax engine (or a `tax_rates` table keyed by jurisdiction) would
   make "tax charged per line at that line's own rate" automatic rather than
   typed.

7. **PDF generation and a client-facing view.** An immutable, branded PDF of the
   *sent* revision, plus a read-only client portal view that shows a client
   exactly what they were sent. The client role already holds `view_estimates`.

8. **Audit trail beyond status.** An append-only log of *who changed what and
   when* on line items, not just who moved the status. `estimate_status_history`
   covers the lifecycle; the line-item edits are not yet audited.

---

## 6. File map

**New — the Estimates slice**

```
supabase/estimates.sql                                    tables, indexes, RLS, helpers
supabase/security-hardening.sql                           revoke anon across public
lib/money.ts                                              the money module (single source of truth)
lib/estimate-service.ts                                   account-scoped data access + lifecycle
app/api/accounts/[accountId]/estimates/route.ts           GET list/filter, POST create (idempotent)
app/api/accounts/[accountId]/estimates/[estimateId]/route.ts   GET by id, PATCH edit|transition
app/accounts/[accountId]/estimates/page.tsx               account-scoped page (server-side access check)
components/estimates/estimate-types.ts                    shared client-side shapes
components/estimates/estimate-list.tsx                    list, filters, detail, lifecycle actions
components/estimates/estimate-create-dialog.tsx           create draft + idempotency key
components/estimates/estimate-line-item-editor.tsx        line-item editor with live totals
components/estimates/estimate-status-badge.tsx            status badge
app/api/roles/[roleId]/permissions/route.ts               GET/PUT a role's permission map
scripts/test-estimates-api.ts                             end-to-end API smoke test
tests/money.test.ts                                       unit tests for the money module
vitest.config.ts                                          vitest configuration
```

**Modified**

```
lib/permissions.ts            + 3 financial permissions, + Financial category
lib/validation-schemas.ts     + estimate create/update/transition/query schemas
lib/supabase-server.ts        + getUserFromRequest (fixes 33 routes)
lib/account-service.ts        ambiguous embed fix
app/api/accounts/route.js     tenancy filter (was leaking every account)
app/admin/roles/page.tsx      wires in the permission manager
components/loading-overlay.tsx render-phase setState fix
supabase/schema.sql           display_order columns, status CHECK constraints
supabase/seed-roles.sql       re-runnable, grants the estimate permissions
scripts/create-seed-users.ts  project status values
```

---

## 7. Known issues in this fork

- The account overview page (`/accounts/[accountId]`) throws at runtime because
  `accountKanbanConfigService` does not exist. Pre-existing; the Estimates page
  is independent of it and works.
- `Client` and `Superadmin` roles are duplicated with different UUIDs across
  `schema.sql` and `seed-roles.sql`.
- `workflow_instances` has a dangling foreign key in the seed data.
- The base repository has pre-existing `tsc` errors in `account-overview.tsx`,
  `department-overview.tsx`, `projects/page.tsx` and `hooks/use-data.ts`.
