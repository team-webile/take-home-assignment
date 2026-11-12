# Security note — read this before you run anything

This archive is a work-in-progress fork of the Kontrora PSA base repository,
delivered for the Staff Engineer assignment. It contains **three separate
credential exposures** — one inherited from the base repository, two created
during this work. None of them is printed here; each is described by **where it
lives** so you can go and revoke it yourself.

---

## 1. A live npm registry token in the base repository — **revoke it**

**Where:** the upstream repository's `.npmrc`, in the **initial commit**.
**Status in this fork:** the file was removed from **every commit in this
fork's history** (the base commit was rewritten with `git filter-branch`, which
is why its hash differs from upstream — that is the only reason the history
looks different).

```gitignore
//registry.npmjs.org/:_authToken=<redacted>
```

**What you should do:** if the assignment repository was ever public, the token
was publicly readable and must be treated as compromised. Revoke it on the npm
account that owns it:

```bash
npm token revoke <token>
```

**Also note:** the archive you received **contains no `.npmrc`**. The file was
excluded when the archive was built.

---

## 2. The demo service-role key in `.env.local.demo` — **rotate or delete**

**Where:** `.env.local.demo`, in the root of this archive.
**What it is:** the service-role key for the throwaway Supabase project
`mdwdgefngumfmociujfl` that was provisioned for this demo.

**Why it is here:** the Estimates feature reads and writes through the
service-role client (see README §2.3), and
`lib/estimate-service.ts` throws `Database connection not available` if
`SUPABASE_SERVICE_ROLE_KEY` is missing. Without it the Estimates UI cannot
create or edit anything, and a reviewer cannot see the feature work. The
alternative was asking every reviewer to stand up their own Supabase project
and run four SQL files before they could see anything.

**The honest risk statement:** this is a credential, it travels with an
"anyone with the link" archive, and it grants unrestricted access to that
project. The project contains **no real data** — it holds the schema, three
accounts, nine seeded users and eleven test estimates — and it exists only for
this demo. The blast radius is therefore small.

**What you should do:** use it for the demo, then delete the project (or rotate
the key) once you have provisioned your own. Never point a service-role key at a
database that holds real customer data without a secrets manager behind it.

**It is deliberately not committed to the repository.** `.env.local.demo` is
gitignored; it exists only in this archive.

---

## 3. Personal access tokens pasted into the working chat — **revoke them**

During setup, a **GitHub personal access token** and a **Supabase personal
access token** were pasted into the working session so the fork could be pushed
and the demo database provisioned. They were never written into any file in
this repository, and they are not in any commit.

They were, however, pasted into a chat transcript, so treat them as exposed:

- **GitHub PAT** — revoke under *Settings → Developer settings → Personal
  access tokens → Tokens classic*. The token that was used is prefixed `ghp_`;
  it should be deleted rather than reused.
- **Supabase PAT** — revoke under *Account preferences → Personal Access
  Tokens*. It was only used to create and configure the demo project.

---

## 4. What was deliberately *not* fixed

The base repository's `.gitignore` carries a `!.npmrc.example` negation, but
**no `.npmrc.example` file exists**. The negation is inherited from upstream
and is dead. The onboarding template in this project is `.env.local.template`,
not `.npmrc.example`.

---

## 5. Known weaknesses in the base schema that are *not* credential leaks

These are documented in full in README §3.7 and §7, and are listed here only so
nothing in this note is mistaken for a complete security review:

- The other 37 tables still carry permissive `"to public using (true)` policies.
  The `anon` revoke in `supabase/security-hardening.sql` closes the anonymous
  hole, but any authenticated user can still read those tables directly through
  PostgREST.
- Components outside the Estimates feature still query the database directly
  from the browser.
- `Client` and `Superadmin` roles exist twice with different UUIDs, and the
  `workflow_instances` seed has a dangling foreign key.
