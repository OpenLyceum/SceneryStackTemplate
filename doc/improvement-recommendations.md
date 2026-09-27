# Improvement Recommendations — SceneryStack Template

Non-test recommendations for `SceneryStackTemplate/`, grouped by impact. Each item
references the concrete file(s) involved so an editor (human or agent) can act
without re-exploration.

Items 1, 5, 6, 10, 11, 12, 13 and 15 are done (template hardening, 2026-08-11; `release`
now runs `npm test`, 2026-09-27) and have been removed; numbering is kept so older
references still resolve.

## Correctness / hardening

### 2. `engines.node: ">=24"` allows local drift past Node 24

Baton's `check-node-version.sh` enforces Node 24 in CI, but a developer on
Node 25 passes `engines` and fails in CI anyway. Tighten to `">=24 <25"` and:

- Add a root `.nvmrc` containing `24`.
- Add a root `.npmrc` with `engine-strict=true`.

…so installs fail fast locally instead of in CI.

### 3. Reusable workflows pinned to `@main`

`.github/workflows/ci.yml` and `deploy.yml` reference
`OpenLyceum/Baton/.github/workflows/*@main`. Every sim using this template is
exposed to a compromised Baton commit. Pin to a SHA (or a `@v1` tag) for the
template — it's the one repo forks will copy. At minimum, document the trade-off
in `AGENTS.md`.

### 4. `rename-sim.ts` replacement table is order-fragile

`scripts/rename-sim.ts` `REPLACEMENTS` relies on "longest first" with overlapping
prefixes (`Sim` → `SimColors` → `SimConstants`). It works today only because the
bare token `Sim` is not in the list, but adding it (a common request) would
silently corrupt every `SimColors`/`SimConstants` occurrence. Either:

- Add a comment enforcing the invariant at the top of `REPLACEMENTS`, or
- Switch class-token replacements to `\b`-bounded regex matches.

## DX / API surface

### 7. `StringManager` getter return types are inconsistent

`src/i18n/StringManager.ts`:

- `getTitleStringProperty()` is explicitly typed `ReadOnlyProperty<string>`.
- `getA11yStrings()` and `getPreferences()` return inferred JSON types.

Renaming a locale key today silently renames the public API exposed to views
with no compile error at the call site. Add explicit return types (or run the
JSON through a `satisfies` shape) so a key rename surfaces as a type error.

### 8. No dispose-pattern reference in `SimScreenView`

`src/sim-screen/view/SimScreenView.ts` is billed (in `AGENTS.md`) as the
"canonical accessibility reference," and its header comment instructs forks to
turn `currentDetailsContent` into a live `DerivedProperty` — with no example of
unlinking it. Ship a commented `public override dispose()` stub demonstrating
`DerivedProperty` / `Multilink` cleanup. Forks copy what they see.

### 9. `.npmrc` is absent

Fleet consistency would benefit from a root `.npmrc`:

- `engine-strict=true` (pairs with #2),
- `fund=false`,
- and a decision on `save-exact=` (pick one and propagate via Baton).

## Docs / polish

### 14. `SimKeyboardHelpContent` ships only `BasicActionsKeyboardHelpSection`

`src/sim-screen/view/SimKeyboardHelpContent.ts` constructs
`TwoColumnKeyboardHelpContent([basic], [])`. Since this is the a11y reference,
pre-stub a second column (slider help or a hotkeys section) commented out, so
forks see the pattern instead of inventing it.

## Suggested first batch

The highest-value, lowest-risk subset to apply first:

- **#2** — engines + `.nvmrc` + `.npmrc`
- **#7** — explicit `StringManager` return types
