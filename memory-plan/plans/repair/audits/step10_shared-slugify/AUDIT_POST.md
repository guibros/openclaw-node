# AUDIT_POST — Step 2.2: One slugify behavior for writers + UI route (R7)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `mission-control/src/app/api/memory-content/route.ts` | ✓ | Mirror made byte-equivalent to `slugifyName` (cap dropped, identical replace-chain); comment binds it to the parity test. Deployed to runtime via file copy (the established model); Next hot-reloaded. |
| `test/slugify-parity.test.mjs` (new) | ✓ | Extracts the route's function from source and executes it against `slugifyName` over a 10-case hostile battery (>60 chars, unicode, slashes, separator runs); plus a no-`.slice(` regression lock. |

## Proof-gate substitution (per AUDIT_PRE)
"Single imported definition" was verified impossible across the file-copy deploy boundary (different relative depths repo vs runtime); substituted with byte-equivalence + source-parity test — same strength, same pattern as the wiring manifest. Documented here and in the INVENTORY DONE note.

## Verification (Phase 5)

- **Tests:** parity 3/3.
- **Runtime:** seeded an 89-char-slug entity, wrote its note via the real writer (`generateConceptNotes`, client:null, maxConcepts:1), queried the live API → `prose present: True` with the full body (pre-fix: 60-char-truncated filename lookup → null → "No concept note written yet"). Seed entity + note removed after capture.
- One mid-verification stumble, honestly logged: first curl used `?name=` (wrong param — the contract is `?entity=`); re-read the route, retried, landed.

## Carry-forwards
- The parity test also defends 2.4/2.6: the link checker and coverage report will resolve names → files through `slugifyName`; the UI is now guaranteed to agree.
