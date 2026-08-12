# Uganda review backlog recovery rollout

Marker: `uganda-master-intake-recovery-20260811`

## Safety contract

The current staging candidate exposes read-only recount and proposal endpoints only. It has no bulk apply route. It does not update a listing, change status, or publish inventory. Rejected/deleted/non-review statuses are protected, student rows are excluded from automation, and district-only rows default to `hold` until Arthur explicitly chooses `release` for human review.

## Staging gate

1. Deploy this branch to makaug staging.
2. Use King → Review backlog recovery lab → Recount real queue. Record bucket totals and overlap groups, plus agent-listing diagnostics.
3. Load 50 proposals for each of missing price, missing location, junk title and category ambiguous. District-only policy remains Hold. Student output is inspection-only.
4. Dave audits at least 95% accuracy for price/location/title and applies higher scrutiny to category proposals.
5. Only after Dave passes the sample may a separate, backup-gated proposal persistence operation be designed and run on a fresh staging snapshot.
6. Recovered rows always return to individual normal moderation. No bulk auto-republish.

## Agent listings

The recount endpoint reports: linked total, linked approved, linked not live, agent-labelled rows missing an `agent_id`, orphaned agent links, links to non-approved agent profiles, and healthy live agent listings. This is diagnosis-only. Root-cause and exact live count must be taken from the staging/production-connected response before any restoration fix is authorised.

## WhatsApp

No real message is sent by this engineering build. The card formatter regression suite is run, but the requested end-to-end send to `0760 112587` remains an Arthur-coordinated operational check to avoid unsolicited delivery.
