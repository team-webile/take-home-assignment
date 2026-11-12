# Delivery notes — post-audit fix set

This is the changelog for the delivery that follows the read-only repository
audit. It answers three questions in order: **what was broken, what I changed,
and how do I see it working.**

---

## 1. Why you were seeing "accountKanbanConfigService is not defined"

That error was in the base code you were given, and it broke **every account
page for every user** — not just the Estimates area.

`components/account-overview.tsx` calls a service named
`accountKanbanConfigService`, but the module was **never committed**. The
component referenced it, the type checker flagged it, and at runtime the import
resolved to nothing, so the account detail page threw immediately:

> Failed to load accounts — An error occurred while loading accounts. Please try again.
> accountKanbanConfigService is not defined

So the Estimates page was never reachable *through the account you were on*.
It is a **sibling route**, not a tab inside the account page — see §3 below.

**Fixed:** `lib/account-kanban-config-service.ts` now exists and exports the
service, the `KanbanColumn` type and the default column set, and
`components/account-overview.tsx` imports it. The account page loads again.

---

## 2. The full fix set

Six defects, found by running the app rather than by reading it. Four are
one-to-three-line corrections; two are behavioural.

| # | Defect | Fix | File |
|---|---|---|---|
| 1 | **Demo blocker.** `accountKanbanConfigService` did not exist → every account page threw | Added the module and the import | `lib/account-kanban-config-service.ts` (new), `components/account-overview.tsx` |
| 1b | **No way to reach Estimates from the account.** The page was a sibling route with no link to it anywhere | Added an **Estimates** button to the account header, shown only with `view_estimates` | `components/account-overview.tsx` |
| 1c | **`npm install` failed.** `flexible-layout-tools` depends on `@utilityforge/dynamic-interface-kit`, which has been unpublished from npm — a fresh install died with `E404` | The plugin is already optional at runtime (tailwind.config.js wraps it in try/catch), so the dependency is now an `optionalDependencies` entry | `package.json` |
| 2 | **A partial `PATCH` wiped data.** The route passed `notes ?? null`, so editing only the title silently cleared the notes and detached the project | Absent fields are passed through untouched | `app/api/accounts/[accountId]/estimates/[estimateId]/route.ts` |
| 3 | **A negative amount returned `500`, not `400`.** The schema accepted negative amounts and zero quantities; the failure surfaced deeper in the stack | `quantityMilli >= 1`, `unitAmountMinor >= 0` | `lib/validation-schemas.ts` |
| 4 | **A revoked membership still passed the route guard.** `hasAccountAccess()` ignored `account_members.removed_at`, while the SQL helper honoured it — the two layers disagreed and the weaker one was in front | Filter on `removed_at is null` | `lib/permission-checker.ts` |
| 5 | **The permission cache was never invalidated.** Grants made in the permission editor took up to five minutes to take effect — on the permission editor's own demo | Call the existing `clearPermissionCache()` after a successful `PUT` | `app/api/roles/[roleId]/permissions/route.ts` |
| 6 | **Lifecycle transitions had no optimistic lock.** Two concurrent transitions could both pass the validity check and both append a history row | The update is conditional on the status the caller expected; the loser gets `409` with `currentStatus` and the allowed transitions. The history insert is no longer swallowed | `lib/estimate-service.ts`, `app/api/accounts/[accountId]/estimates/[estimateId]/route.ts` |

Plus one hardening change: `getEstimateById` now **requires** the account id
instead of accepting an optional one, so "someone forgot the account filter"
is a compile error rather than a review item.

### README corrections

The audit also checked the fork's README against the code and found several
claims that were overstated or wrong. All corrected:

- "no delete path anywhere" → line items *are* replaced on a draft edit, and a
  failed insert rolls back the header it just created. Estimates and status
  history are never deleted; line items are.
- "a missing filter is a compile-time impossibility" → it was a review item
  until `getEstimateById` was changed; now it genuinely is one.
- "no `DELETE` policy, so even a service-role-adjacent mistake … cannot cascade
  a delete" → the service role **bypasses RLS**, so the no-`DELETE`-policy
  argument protects against a browser-side caller, not against our own code.
- "the other **118** routes" → there are **113** pre-existing `.js` route files.
- "`.npmrc.example` kept so others can still onboard" → **no such file exists**.
  The negation in `.gitignore` is dead; the template is `.env.local.template`.
- The account-overview crash was listed as a known issue → it is fixed.
- The type-error list named `account-overview.tsx` → it is clean now.
- Test counts updated (29 unit, **40** API checks, up from 31) and the
  `npm run lint` crash documented.

---

## 3. Where the Estimates page actually is

It is a **sibling route of the account page**, not a tab inside it:

```
http://localhost:3000/accounts/<account-uuid>/estimates
```

**And there is now a button for it.** The account detail page carries an
**Estimates** button in the header, immediately to the left of "Edit Account"
(the button with the receipt icon). It is shown only to a user who holds
`view_estimates` on that account, and it links straight to the estimates list.
The estimates page links back to the account the same way.

That button did not exist before this delivery — the page was a sibling route
with **no navigation affordance anywhere**, which is exactly why "how do I get
to the Estimates?" was a reasonable question. If you are looking at an older
copy of the archive, that is why you cannot find it.

For the seeded demo data:

| Account | UUID | Estimates page |
|---|---|---|
| Meridian Financial Group | `aaaaaaaa-aaaa-aaaa-aaaa-000000000001` | `/accounts/aaaaaaaa-aaaa-aaaa-aaaa-000000000001/estimates` |
| Vanta Health | `aaaaaaaa-aaaa-aaaa-aaaa-000000000002` | `/accounts/aaaaaaaa-aaaa-aaaa-aaaa-000000000002/estimates` |
| Harlow & Sons Bakery | `aaaaaaaa-aaaa-aaaa-aaaa-000000000003` | `/accounts/aaaaaaaa-aaaa-aaaa-aaaa-000000000003/estimates` |

You can also reach it by opening the account (the account page works now) and
navigating to the Estimates section, or by typing the URL directly. The page
is intentionally kept out of the global sidebar — it belongs to an account.

**Permission matters:** a user needs the `view_estimates` permission *and*
membership of that account. Verified against the demo database:

| User | Role | `view_estimates` | Accounts reachable |
|---|---|---|---|
| `admin@test.local` | Admin | yes | all three |
| `exec@test.local` | Executive Director | yes | all three |
| `manager@test.local` | Account Manager | yes (+ manage, + lifecycle) | Meridian, Vanta — and is the **account manager** of both |
| `pm@test.local` | Project Manager | yes | Meridian, Harlow — and is the account manager of Harlow |
| `designer@test.local` | Senior Designer | yes | Meridian, Vanta |
| `dev@test.local` | Senior Developer | yes | Meridian, Vanta |
| `contributor@test.local` | Contributor | yes (read only) | Harlow only |
| `client@test.local` | Client | yes | **none** — the role has the permission but the account has no membership row, so the page correctly denies it |
| `superadmin@test.local` | Superadmin | — | all, by the superadmin bypass |

`manager@test.local` is the best single demo account: it holds all three
financial permissions and can reach two accounts, so it can create a draft,
edit it, and move it through the lifecycle.

The password for every seeded account is the single literal in
`scripts/create-seed-users.ts`.

---

## 4. Running the demo — fastest path

```bash
npm install
cp .env.local.demo .env.local
npm run dev            # http://localhost:3000
```

`.env.local.demo` points at a **prepared demo Supabase project** that is
already migrated, seeded and populated — 11 roles, 3 accounts, 9 users, and 11
estimates spread across the whole lifecycle (`draft`, `accepted`, `rejected`,
`void`), so every state in the status filter is populated on first load.

> **Before you use it:** `.env.local.demo` contains a **service-role key**. It
> is a credential, it travels with this archive, and the archive is shared by
> link. The demo project holds no real data, so the risk is small — but use it
> for the demo, then rotate or delete the project and provision your own. See
> `SECURITY-NOTE.md`.

If you would rather use your own database, use Option B in README §4 — four
SQL files in order, then `npm run seed:users`.

---

## 5. Verification

Run in this working copy, against the demo database:

| Check | Result |
|---|---|
| `npx vitest run` | **29/29 pass** (the money module) |
| `npm run test:api` | **52/52 pass** (up from 31 — 21 new checks for the draft-edit, validation, concurrency and permission-cache fixes) |
| `npx tsc --noEmit` | Only two pre-existing files error: `app/projects/page.tsx`, `components/department-overview.tsx` |
| `npm run build` | **passes** |
| `npm run lint` | **crashes — pre-existing**, in the untouched `eslint.config.mjs`. Not caused by this work and deliberately not fixed; documented in README §4 and §7 |
| Browser | account detail page loads; Estimates list, create-draft and line-item editor verified end to end |

The twenty-one new API checks are the ones that matter most:

```
Draft edit
  PASS  notes are stored
  PASS  valid until is stored
  PASS  a partial update does not clear the notes
  PASS  a partial update does not clear the valid-until date
  PASS  a partial update does not clear the project link

Input validation
  PASS  a negative unit amount is rejected with 400 (not a 500)
  PASS  a zero quantity is rejected with 400

Concurrent transitions
  PASS  exactly one of two concurrent transitions wins
  PASS  the loser is told the status the estimate is really in
  PASS  the loser is told which transitions are allowed now
  PASS  only one transition was recorded — no double history

Permission cache invalidation
  PASS  a revoked permission takes effect immediately, without waiting for the cache
  PASS  the restored permission takes effect immediately too
```

The last two are the interesting ones. The concurrency check fires two
lifecycle transitions at the same instant — both individually legal from
`draft` — and asserts that exactly one gets a `200`, the other a `409` naming
the status the estimate is really in, and that **only one** history row was
written. The cache check revokes `view_estimates` on the Contributor role
through the role API and then immediately reads the estimates list as that
user: without `clearPermissionCache()` the first request would have populated
the cache with the old value and the second would still have been allowed for
up to five minutes. The test restores the role afterwards, in a `finally`
block, so it cannot leave the demo database altered.

---

## 6. What I deliberately did **not** change

- **`npm run lint`.** It crashes in the base repository's `eslint.config.mjs`
  (`TypeError: Converting circular structure to JSON`, ESLint 9.39.5 +
  `FlatCompat`). Repairing it means migrating to native flat config, which is
  an unrelated change that would add noise to the diff a reviewer is reading.
  The new and modified files were type-checked and built instead.
- **The other 37 permissive tables.** Rewriting them is a large, mechanical
  change and doing it badly would be worse than doing it properly. It is the
  first item in README §5.
- **`Client` / `Superadmin` duplicate roles** and the **`workflow_instances`
  dangling foreign key** — pre-existing seed-data problems, unrelated to this
  slice, and documented rather than silently patched.
- **The Estimates metadata leak** — `generateMetadata` resolves the account
  name before the access check runs, so a denied user learns the account name
  from the document title. Low severity, but it is a real oracle and it is
  documented in README §3.7 rather than quietly fixed.
