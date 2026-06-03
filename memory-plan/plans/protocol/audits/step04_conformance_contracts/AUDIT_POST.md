# AUDIT_POST — step 2.1 · Conformance + step contracts

## §1 Promised vs landed

| Promised (AUDIT_PRE §6) | Actual | Landed |
|---|---|---|
| PROTOCOL.md +§10 +§11, §3 touches | §10 surface table + §11 four-field contract; Phase 1/5/9 rows now cite Needs/Verify/Feeds | yes |
| INVENTORY.template contract format | atomicity tightened ×3; example note block = four fields; lint requirement stated | yes |
| TICK_PROMPT.template Phase 1/5/9 enforcement | Needs pre-screen → BLOCK; Verify by modality, visual→BLOCK as External action; Feeds landing in AUDIT_POST | yes |
| protocol INVENTORY bookkeeping + historical label | Block 2 written in its own contract format; Block 1 evidence labeled historical | yes |
| resync all silos | repair copy refreshed; --check rc=0 | yes |

## §2 Greppable deltas

- `grep -l '^## 10\. Surface conformance' plans/*/PROTOCOL.md` → 4.
- `grep -c '\*\*Needs:\*\*' canonical/templates/INVENTORY.template.md` → 1; same grep on TICK_PROMPT.template Phase 1 line hits.
- `sync-canonical.sh --check` → "all plan copies up to date", rc=0.

## §4 Findings

- [POSITIVE] §10's functional bars are copied from live-verified behavior (Block 1 evidence),
  not aspiration — every bar names something the viewer/engine actually reads.
- [POSITIVE] Grandfathering decision encoded in the spec (closed pre-contract rows → WARN):
  prevents permanent red on legacy/redesign/repair without diluting the rule for open work.

## §6 Carry-forwards to 2.2

- Lint must grade exactly the §10 table (six surfaces, same order, same bars) — the spec is the
  checklist; don't invent extra checks the spec doesn't state.
- Contract detection: an open row `| B | X.Y | vX.Y | [ ] |` must have a matching
  `> **X.Y — Goal:**` line; the other three fields may wrap lines — grep per field anchor.

## Feeds landing (Phase 9)

§10/§11 live in every silo's PROTOCOL.md (consumer: 2.2's lint encodes them; consumer: every
future plan reads them at bootstrap). Templates carry the contract (consumer: every
`new-plan.sh` run from now on).
