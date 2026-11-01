# How To Contribute

## Local development

Node and pnpm versions for local development are pinned in `.prototools`. Install [proto](https://moonrepo.dev/proto) and run `proto install` in the repository to get them. CI sets up node itself and does not read `.prototools`.

- `git clone https://github.com/nickschot/ember-mobile-drawer.git`
- `cd ember-mobile-drawer`
- `pnpm install`

### Linting

- `pnpm lint` – runs all linters (eslint, ember-template-lint, prettier, type checking, publint, a check that only the public entry points resolve, and a type check of the packed package from a TypeScript consumer)
- `pnpm lint:fix` – fixes what can be fixed automatically and formats the project

### Running tests

- `pnpm test` – builds the test app and runs the test suite in headless Chrome

There is no watch mode script. For a faster loop, run `pnpm start` and open [http://localhost:5173/tests/](http://localhost:5173/tests/) to run the tests in the browser.

Scenarios for other Ember versions are defined in `.try.mjs` and run in CI.

### Demo app

- `pnpm start`
- Visit the demo app (`demo-app/`) at [http://localhost:5173](http://localhost:5173).
- `pnpm build:demo` – production build of the demo app into `dist-demo/`. Add `--base=/ember-mobile-drawer/` to build it the way it is deployed.

The demo app is the playground. Every push to `main` deploys it to GitHub Pages at <https://nickschot.github.io/ember-mobile-drawer/> (`.github/workflows/pages.yml`); pull requests that touch it only build it.

### Building the addon

- `pnpm build` – builds the addon into `dist/`

## Workflow

Work is tracked in GitHub issues; there is no project board. The planned tickets are issues #17–#32, with a `[TN]` title prefix (for example `[T16] Release v0.1.0`); later issues cover follow-ups. Issues carry a status label (`ready to implement` or `blocked`) and a milestone (`M0 Foundation`, `M1 Core engine`, `M2 Styling` or `M3 Docs & release`). An issue is in progress when it has an open PR that says `Closes #<issue>`.

The project is developed by a set of agents and a human maintainer:

- **PM agent** – plans work, keeps issue labels up to date, assigns issues to implementers, records the maintainer's decisions and merges PRs where the merge rules allow it.
- **Implementer agents** – only pick issues labelled `ready to implement`. Each issue gets its own git worktree and branch (for example `issue-19-process`) and one PR that says `Closes #<issue>`.
- **Reviewer agent** – adversarially reviews every PR against the acceptance criteria of the linked issue, if there is one, and manages the `reviewed` label.
- **Maintainer** – approves every PR that is not `trivial`, and may approve any PR.

The PM may also open small PRs without an issue, such as docs updates. Their body says so instead of `Closes #<issue>`.

### Agent hygiene

- Each agent works in its own git worktree and its own temporary directory (`mktemp -d`), and uses its own browser tab.
- Never write into another agent's worktree or scratch space.

### Pull requests

Use the PR template. Every PR has:

- a `Closes #<issue>` line (or, for a PM-opened PR without an issue, a line saying so),
- a summary and a test summary,
- screenshots for a visible change (see [Visual proof](#visual-proof)), or "n/a: no visible change",
- a classification label, proposed by the author:
  - `trivial`: docs/tooling/config, no runtime behaviour change.
  - `uncertain`: runtime behaviour, covered by tests, but involved judgment calls.
  - `needs-human-review`: public API, gesture/physics feel, a11y, new dependencies, architecture.
- a release-plan label: `breaking`, `enhancement`, `bug`, `documentation` or `internal` (see [RELEASE.md](RELEASE.md)).

The reviewer may raise a PR's classification but never lower it.

### Visual proof

Every PR with a visible change (CSS, component rendering, gestures, the demo app) includes screenshots of the demo app:

- Phone size: 390×844 at device scale factor 2. Use device emulation over the Chrome DevTools Protocol (`Emulation.setDeviceMetricsOverride`); Chrome's `--window-size` can't go below about 500px wide.
- One screenshot for each relevant placement and state, in light and dark mode when colours are involved.
- Commit only the PNGs to the orphan branch `pr-screenshots`, under `pr-<number>/`. Never commit them to `main` or the PR branch.
- Embed them in the PR body with `https://raw.githubusercontent.com/nickschot/ember-mobile-drawer/pr-screenshots/pr-<number>/<file>.png`.

The reviewer checks that the screenshots match the code.

### Review and the `reviewed` label

Everything runs under a single GitHub account, so nobody can formally approve a PR. Each PR gets one adversarial reviewer. Instead of an approval:

- The reviewer posts its verdict as a PR review comment (`gh pr review --comment`).
- On APPROVE it adds the `reviewed` label. On REQUEST CHANGES it removes the label if present.
- The label only counts for the head commit it was given on. Any push after it was added makes it stale; the reviewer removes or re-adds it after re-reviewing.

The `reviewed` label records the adversarial review, not the maintainer's approval.

### Maintainer approval

- The maintainer gives explicit approval to the PM, in the PM's chat session. It is not recorded as a GitHub review.
- When a PR involves design decisions, the PM records the maintainer's decisions on the PR as a comment ("Maintainer decisions (recorded by PM): …").

### Merge rules

The PM merges a PR only when all of these hold:

- the `reviewed` label was added on the current head, after the latest push,
- CI is green,
- for `uncertain` and `needs-human-review`: the maintainer has explicitly approved it. `trivial` PRs don't need this.

The merge is pinned to the reviewed head commit (`gh pr merge --match-head-commit <sha>`), so a later push can't slip in.

The release-plan "Prepare Release" PR is only merged as part of the release ticket (T16, #32), never earlier.
