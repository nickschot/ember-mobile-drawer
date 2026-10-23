# How To Contribute

## Local development

Node and pnpm versions for local development are pinned in `.prototools`. Install [proto](https://moonrepo.dev/proto) and run `proto install` in the repository to get them. CI sets up node itself and does not read `.prototools`.

- `git clone https://github.com/nickschot/ember-mobile-drawer.git`
- `cd ember-mobile-drawer`
- `pnpm install`

### Linting

- `pnpm lint` – runs all linters (eslint, ember-template-lint, prettier, type checking, publint)
- `pnpm lint:fix` – fixes what can be fixed automatically and formats the project

### Running tests

- `pnpm test` – builds the test app and runs the test suite in headless Chrome

There is no watch mode script. For a faster loop, run `pnpm start` and open [http://localhost:4200/tests/](http://localhost:4200/tests/) to run the tests in the browser.

Scenarios for other Ember versions are defined in `.try.mjs` and run in CI.

### Demo app

- `pnpm start`
- Visit the demo app (`demo-app/`) at [http://localhost:4200](http://localhost:4200).

### Building the addon

- `pnpm build` – builds the addon into `dist/`

## Workflow

Work is tracked in GitHub issues; there is no project board. Issues carry a status label (`ready to implement` or `blocked`) and a milestone. An issue is in progress when it has an open PR that says `Closes #<issue>`.

The project is developed by a set of agents and a human maintainer:

- **PM agent** – plans work, keeps issue labels up to date, assigns issues to implementers and merges PRs where the merge rules allow it.
- **Implementer agents** – only pick issues labelled `ready to implement`. Each issue gets its own git worktree and branch (for example `issue-19-process`) and one PR that says `Closes #<issue>`.
- **Reviewer agent** – adversarially reviews every PR against the acceptance criteria of the linked issue and manages the `reviewed` label.
- **Maintainer** – approves every PR that is not `trivial`, and may approve any PR.

### Pull requests

Use the PR template. Every PR has:

- a `Closes #<issue>` line,
- a summary and a test summary,
- a classification label, proposed by the author:
  - `trivial`: docs/tooling/config, no runtime behaviour change.
  - `uncertain`: runtime behaviour, covered by tests, but involved judgment calls.
  - `needs-human-review`: public API, gesture/physics feel, a11y, new dependencies, architecture.
- a release-plan label: `breaking`, `enhancement`, `bug`, `documentation` or `internal` (see [RELEASE.md](RELEASE.md)).

The reviewer may raise a PR's classification but never lower it.

### Review and the `reviewed` label

Everything runs under a single GitHub account, so nobody can formally approve a PR. Instead:

- The reviewer posts its verdict as a PR review comment (`gh pr review --comment`).
- On APPROVE it adds the `reviewed` label. On REQUEST CHANGES it removes the label if present.
- The label only counts for the head commit it was given on. Any push after it was added makes it stale; the reviewer removes or re-adds it after re-reviewing.

### Merge rules

- `trivial`: the PM merges once the PR has the `reviewed` label (added after the latest push) and CI is green.
- `uncertain` and `needs-human-review`: need the maintainer's explicit approval before merging, with or without `reviewed`.
