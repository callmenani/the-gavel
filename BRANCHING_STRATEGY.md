# TheGavel — Branching Strategy

This document is the single source of truth for how work moves through the
TheGavel repository. It is written for humans **and** for AI agents that operate
this repo. If a step below conflicts with an ad-hoc instruction, follow the
branch model first and raise the conflict in the PR instead of deviating
silently.

---

## 1. The model in one picture

```
                         (production / stable)
   main      ●──────────────●────────────────●───────────►  tags: v1.4.0, v1.5.0
              \            / \              /
               \          /   \            /
   develop      ●───●───●      ●───●──────●─────────────►  (QA / integration)
                 \   \  /        \   \   /
                  \   \/          \   \ /
   release/<dev>   ●───●            ●───●────────────────►  (one per developer)
                    \                 \
   <issue-slug>      ●───●             ●───●─────────────►  (short-lived)
```

| Branch               | Role                          | Deploys to        | Who writes to it                     |
| -------------------- | ----------------------------- | ----------------- | ------------------------------------ |
| `main`               | Master / production line      | Production        | Release manager only (merge from `develop`) |
| `develop`            | QA / shared integration line  | QA / staging      | Merges from `release/*` only         |
| `release/<developer>`| A developer's long-lived lane | Preview (optional)| That developer (self-service)        |
| `<issue-number>-<slug>` | One issue, bug, or enhancement | –             | The developer who owns it            |
| `hotfix/<slug>`      | Emergency production fix      | Production        | Release manager + on-call developer  |

**Rules of thumb**

- `main` is never edited directly. Not by a human, not by an agent.
- `develop` is the only branch that may merge into `main`.
- A `release/*` branch is the only branch that may merge into `develop`.
- Issue branches are the only branches that may merge into a `release/*` branch.
- Nothing is force-pushed after it has been pushed once. No exceptions.

Because the repo has two remotes, every reference below uses `origin` — the
canonical repo (`callmenani/the-gavel`). The `mine` remote is a personal mirror
and is never used for PRs.

```bash
# The two remotes in this working copy:
#   origin  https://github.com/callmenani/the-gavel.git   <- canonical, push here
#   mine    ssh://git@github.com/BobbyOleti/the-gavel.git <- personal mirror, ignore for PRs
git fetch origin --prune
```

---

## 2. Naming conventions

### 2.1 Release branches — one per developer

```
release/<first-name>            release/bobby
release/<handle>                release/vardhan
```

- Created **once** per developer, from `develop`, and kept alive for the whole
  project. Do not delete it when a feature ships.
- The name identifies the owner. An agent must never push to a release branch it
  does not own.
- If a release branch already exists, reuse it. Do not create a second one with
  a `-2` suffix.

### 2.2 Issue branches — one per issue / bug / enhancement

```
<issue-number>-<short-kebab-slug>
```

Examples that already exist in this repo:

```
10-recall-should-only-pull-players-from-the-unsold-list
12-live-public-rooms-are-not-visible-to-users
4-restore-the-players-bid-and-team-after-returning-from-a-sale
```

- Always start with the GitHub issue number when one exists. If there is no
  issue, open one first — the number is what links the branch, the PR, and the
  issue together.
- Lowercase ASCII, hyphens only, no slashes inside the slug, ≤ 50 characters
  after the number.
- Prefixes such as `feat/`, `fix/`, `chore/` are **not** used for issue branches.
  The issue itself carries the type via labels.

### 2.3 Hotfix branches

```
hotfix/<short-kebab-slug>
```

Branched from `main`, not from `develop`. See §6.

---

## 3. Commit messages

The history in this repo follows a light Conventional Commits style. Match it:

```
feat: add dedicated auction manager role for live rooms
fix: block recall of already-sold players
build: allow esbuild postinstall scripts under npm 11
docs: document branching strategy
test: cover paused-lot recall permissions
chore: bump firebase to 12.11.0
```

- Subject line ≤ 72 characters, imperative mood, no trailing period.
- One logical change per commit. Do not mix a refactor with a behaviour change.
- If a commit closes an issue, put `Closes #<n>` in the commit body or PR body.
- Agents: never add `Co-Authored-By` or any attribution trailer unless the user
  explicitly asks for it. Never commit `.env`, credentials, or `scripts/`.

---

## 4. The daily workflow (issue → QA)

This is the path 95% of work takes.

### Step 1 — Start from the latest `develop`

```bash
git fetch origin --prune
git switch develop
git pull --ff-only origin develop
```

Never branch from a stale local `develop`, and never branch from `main`.

### Step 2 — Get onto your release branch and sync it

```bash
git switch release/<you>            # or: git switch -c release/<you> origin/develop
git merge origin/develop            # bring in everyone else's work before you start
git push origin release/<you>
```

Do this **every time** you pick up new work. A release branch that is behind
`develop` produces the merge conflicts that QA later has to untangle.

### Step 3 — Cut the issue branch

```bash
git switch -c <issue-number>-<slug> release/<you>
```

The issue branch is short-lived: it lives for days, not weeks.

### Step 4 — Work, verify, commit

Before opening a PR, all three must pass locally:

```bash
npm run lint
npm test
npm run build
```

`npm test` runs the `node --test` suite in `tests/` and `src/lib`. A PR that
does not build does not get reviewed. If a test fails for a reason unrelated to
your change, say so explicitly in the PR — do not disable the test.

Commit in small, reviewable pieces:

```bash
git add -A
git commit -m "fix: block recall of already-sold players"
git push -u origin <issue-number>-<slug>
```

### Step 5 — PR into your own release branch

Open the PR with head `<issue-number>-<slug>` → base `release/<you>`.

- Title: same format as the commit subject.
- Body: what changed, why, how it was verified, and `Closes #<n>`.
- Keep it small. If the diff has more than ~400 changed lines, split it.

Use **Squash and merge** here. The release branch should read as one commit per
issue.

### Step 6 — Promote your release branch to `develop`

When one or more issues are finished and QA-able:

```bash
git switch release/<you>
git merge origin/develop        # re-sync one last time; resolve conflicts here
git push origin release/<you>
```

Then open a PR: `release/<you>` → `develop`.

Use **Create a merge commit** (not squash) for this PR. The individual issue
commits must survive into `develop` so QA can bisect and revert one issue at a
time.

The owner of `develop` reviews and merges. After the merge, `develop` is the
only branch QA tests.

### Step 7 — Reset for the next issue

```bash
git switch develop
git pull --ff-only origin develop
git switch release/<you>
git merge origin/develop
git branch -d <issue-number>-<slug>
git push origin --delete <issue-number>-<slug>
```

Delete the issue branch after it lands. A local branch that is fully merged into
your release branch is safe to delete.

---

## 5. The promotion path (QA → production)

`develop` → `main` is the release gate, and it happens on a cadence, not per
feature.

1. QA signs off on `develop`.
2. Release manager opens PR `develop` → `main`.
3. PR body lists every issue included since the last tag.
4. Use **Create a merge commit**. Never squash or rebase `develop` into `main` —
   doing so rewrites shared history and breaks every release branch's merge base.
5. Tag `main` immediately after merge:

```bash
git switch main
git pull --ff-only origin main
git tag -a v1.5.0 -m "v1.5.0"
git push origin v1.5.0
```

6. Back-merge `main` into `develop` so the branches never drift:

```bash
git switch develop
git merge origin/main
git push origin develop
```

Only the release manager merges into `main`. Agents and feature developers stop
at `develop`.

---

## 6. Hotfixes

A hotfix is for a defect that cannot wait for the next `develop` release.

```bash
git fetch origin --prune
git switch -c hotfix/<slug> origin/main
# ...fix, test...
npm run lint && npm test && npm run build

# PR: hotfix/<slug> -> main  (squash merge)
# Then, after it is merged and tagged:

git fetch origin --prune
git switch develop
git merge origin/main            # carry the fix forward
git push origin develop
```

Then every active release branch picks it up with its next
`git merge origin/develop`.

A hotfix PR into `main` is a **squash merge**, because `main` should not gain
the issue-by-issue history of a long-lived branch.

---

## 7. Keeping branches healthy

| Situation                        | Action                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| Release branch behind `develop`  | `git merge origin/develop` on the release branch, then push    |
| Issue branch behind its release  | Merge the release branch **into** the issue branch (do not rebase) |
| Merge conflict                   | Resolve on the branch being merged *from*, never on `main`/`develop` |
| Branch abandoned                 | Delete it locally and on `origin`                              |
| Wrong base (branched off `main`)| Recreate the issue branch from `release/<you>`; do not rebase a pushed branch |

**Never rebase a branch that has been pushed.** Rebasing shared branches forces a
rewrite and takes every other developer's branch out of sync. Merge instead.

**Never force-push** `main`, `develop`, `release/*`, or any branch someone else
may have pulled. A corrected commit is a new commit.

---

## 8. Agent operating contract

An agent working in this repo must treat the following as hard constraints.

### Allowed

- `git fetch origin --prune`
- Create branches from the correct parent (`release/<dev>` for issue work,
  `origin/develop` for a new release branch, `origin/main` for a hotfix)
- Commit and push to an issue branch or hotfix branch it created
- Merge `origin/develop` down into a release branch it owns
- Open PRs with the bases defined in §4 and §5
- Delete an issue branch it created once it is merged

### Requires explicit human instruction

- Pushing to `develop`
- Pushing to `main`
- Force-pushing anything
- Deleting a `release/*` branch
- Creating or moving a tag
- Changing branch protection settings
- Merging any PR

### Never

- Commit to `main` or `develop` directly
- Rebase or force-push a pushed branch
- Amend a commit that is already pushed
- Delete or reset another developer's branch
- Commit `.env`, `.env.*`, `scripts/`, credentials, or build output
- Mark a PR as ready when `npm run lint`, `npm test`, or `npm run build` fails

### Deterministic checklist for any issue-based task

1. `git fetch origin --prune`
2. Identify the owning developer → `release/<name>`. If unknown, **ask**; do not
   guess between developers.
3. `git switch release/<name> && git merge origin/develop && git push origin release/<name>`
4. `git switch -c <issue-number>-<slug> release/<name>`
5. Implement, then run `npm run lint && npm test && npm run build`
6. Commit with a `type: subject` message, push the issue branch
7. Open PR: `<issue-number>-<slug>` → `release/<name>`, body contains
   `Closes #<n>` and the verification commands that passed
8. Stop. Do not merge, do not touch `develop` or `main` without being told.

---

## 9. Branch protection (recommended setup)

These are not yet enforced by `.github/workflows/` — the only workflow in the
repo is the manually triggered fantasy-points update. Set these in
**Settings → Branches** on `origin`:

| Branch    | Require PR | Required approvals | Required status checks        | Force push | Deletion |
| --------- | ---------- | ------------------ | ----------------------------- | ---------- | -------- |
| `main`    | yes        | 1                  | `lint`, `test`, `build`       | blocked    | blocked  |
| `develop` | yes        | 1                  | `lint`, `test`, `build`       | blocked    | blocked  |
| `release/*` | yes      | 0 (self-merge OK)  | `lint`, `test`, `build`       | blocked    | allowed  |

Add the CI gate before relying on it — a protection rule naming a check that
does not exist will block every merge. Suggested workflow trigger: `pull_request`
on `main`, `develop`, and `release/**`.

---

## 10. Quick reference

```bash
# Start work
git fetch origin --prune
git switch release/<you> && git merge origin/develop
git switch -c <issue-number>-<slug> release/<you>

# Verify before PR
npm run lint && npm test && npm run build

# Ship to your release branch
git push -u origin <issue-number>-<slug>
# PR: <issue-number>-<slug>  ->  release/<you>     [squash]

# Ship to QA
git switch release/<you> && git merge origin/develop && git push
# PR: release/<you>          ->  develop           [merge commit]

# Ship to production (release manager only)
# PR: develop                ->  main              [merge commit]  -> tag vX.Y.Z
# then: git switch develop && git merge origin/main && git push
```
