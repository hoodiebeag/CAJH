# Dependency audit — 2026-08-04

Scope: production dependency vulnerabilities reported by `npm audit`.

## Changes made

- Updated `axios` from `^1.17.0` to `^1.18.0`.
  - Clears the direct axios advisory chain, including prototype-pollution and request-construction issues reported for `<1.18.0`.
- Updated `discord.js` from `^14.26.4` to `^14.27.0`.
  - Pulls patched `@discordjs/rest` and `undici` versions in the Discord stack.
- Refreshed the lockfile for `form-data`.
  - Resolves the transitive `form-data <4.0.6` CRLF-injection advisory through the smallest compatible lockfile update.

## Verification

- `npm.cmd audit --json`: 0 vulnerabilities.
- `npm.cmd test`: pending verifier run after this handoff.

No remaining production advisories were reported by npm audit after these updates.
