[Chinese](README.md) | [English](README.en.md)

# better-permit-ui

The browser half of `better-permit` (all Host behavior lives there):

- `client.js` — two pieces of UI:
  1. **Approval dialog detail**: command text, risk badge (read-only/write/destructive/system layer/publish...), why this tier is asking,
     an **explanation paragraph** (with a coloured safe / careful / high-risk badge; the text analyses the consequence instead of restating the command),
     and two shortcut buttons: **"Always allow this command in this conversation"** (records the signature in this conversation's allow rules) and
     **"Trust this folder and allow this call (this conversation only)"**. Both approve the current call directly after the write succeeds.
  2. **Settings page "Permissions"**: tier and auto-approval scope table, risk legend, reviewer model, approval wait, approval habits,
     the per-turn auto-approval report, global trusted folders, per-conversation trusted folders,
     this conversation's allow rules (remove one by one / clear), overview by conversation, trust lists from config, recent auto-approvals.
- `index.js` — an empty Host half, only so that this package has an active line in the Loader and its browser bundle is scanned and loaded.

All data is read and written through the main plugin's `/better-permit/approval/*` endpoints; no state is stored here.

## Why it is a separate package

`dsh-client-modules` caches each package's `dsh.client` scan result by "Loader line name + baseUrl" and has no invalidation path
(there is no code that rescans). When the main plugin was installed it had no `dsh.client` declaration yet, so that `null` was cached forever,
and however many times it was reloaded its browser code would never load. The browser half is its own package, so installing it is the first scan
and it takes effect immediately.

## Slots

- `conversation.approval.detail` (single): registered at **priority -1**, shadowing the built-in command preview component
  (which sits at priority 0, the rule being "the lowest priority renders"), so this component draws the command text itself.
- `settings.section` (list): `id: 'better-permit'`, `order: 50`, appears in the Settings navigation with the title "Permissions".

## Notes (pitfalls we hit)

- **Snapshot hooks must receive a selector**: `props.useSessions` / `props.useSessionStatus` have the shape of
  `useSnapshotSelector(selector)` and call `selector(snapshot)` internally. Using them as optional parameters (`props.useSessions()`)
  throws `TypeError: selector is not a function`; React swallows the whole block, so the Settings page looks blank,
  and because the render never commits, the data-fetching `useEffect` never runs at all. The correct form passes a stable selector:
  `const selectAll = (value) => value` (module-level constant), then `props.useSessions(selectAll)`.
- **Never paint a button with the brand token plus white text**: the brand colour is not guaranteed to contrast with
  white, and a missing token renders as a blank white pill. Primary buttons therefore use a raised surface with a
  brand-coloured border and text (`primaryButton`), which reads in both light and dark themes.
- When registering, `inject`'s return value is merged into props (this page uses `inject: () => ({ pick })` to get the directory picker).

## Development

```pwsh
node test/client.smoke.mjs   # 72 checks: module evaluates, both slots register, every panel section renders, both approval detail buttons really send requests
```

The smoke test runs the component for real with a small hooks engine (including fetch stubs for `/panel` and `/detail`),
so running it after a UI change catches render-time exceptions.

After changing `client.js`, reload this package (`plugin_manager set_bundle` off->on) and refresh the page -- client bundles do not hot-reload.
