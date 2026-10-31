# Release Process

Releases in this repo are mostly automated using [release-plan](https://github.com/embroider-build/release-plan/). Once you label all your PRs correctly (see below) you will have an automatically generated PR that updates your CHANGELOG.md file and a `.release-plan.json` that is used to prepare the release once the PR is merged.

## Preparation

Since the majority of the actual release process is automated, the remaining tasks before releasing are:

- correctly labeling **all** pull requests that have been merged since the last release
- updating pull request titles so they make sense to our users

Some great information on why this is important can be found at [keepachangelog.com](https://keepachangelog.com/en/1.1.0/), but the overall
guiding principle here is that changelogs are for humans, not machines.

When reviewing merged PR's the labels to be used are:

- breaking - Used when the PR is considered a breaking change.
- enhancement - Used when the PR adds a new feature or enhancement.
- bug - Used when the PR fixes a bug included in a previous release.
- documentation - Used when the PR adds or updates documentation.
- internal - Internal changes or things that don't fit in any other category.

**Note:** `release-plan` requires that **all** PRs are labeled. If a PR doesn't fit in a category it's fine to label it as `internal`

## Release

Once the prep work is completed, the actual release is straight forward: you just need to merge the open [Plan Release](https://github.com/nickschot/ember-mobile-drawer/pulls?q=is%3Apr+is%3Aopen+%22Prepare+Release%22+in%3Atitle) PR

The Prepare Release PR is only merged as part of the release ticket (T16, #32), never earlier.

## One-time maintainer setup

1. **Initial tag (done).** release-plan needs at least one git tag to compute the changelog. An initial `v0.0.0` tag exists on the initial commit.
2. **Allow Actions to create pull requests (done).** In the repository, go to Settings → Actions → General and enable "Allow GitHub Actions to create and approve pull requests". Without it the Plan Release workflow fails when it tries to open the release PR.
3. **First publish.** The package does not exist on npm yet, so trusted publishing cannot be set up in advance. The maintainer publishes the first release once, manually with their own npm credentials.
4. **npm trusted publishing.** After the first publish, add a trusted publisher for the package on npmjs.com: GitHub Actions, owner `nickschot`, repository `ember-mobile-drawer`, workflow `publish.yml`, no environment. Later releases are then published by `publish.yml` via OIDC, without an npm token.

Note that release-plan does not plan a release until every PR merged since the last release has a release-plan label (`breaking`, `enhancement`, `bug`, `documentation` or `internal`).
