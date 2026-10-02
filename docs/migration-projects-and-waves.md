# Migration projects and waves

The migration console models a migration as a durable **project** containing ordered **waves**. This separates planning from individual provider jobs and provides a stable place for readiness findings, identity mappings, approvals, validation results, and cutover evidence.

## Lifecycle

Projects progress through:

`Assessment → Mapping → Planning → Pilot → Migration → Validation → Cutover → Completed`

A project starts in `Assessment` with `Draft` status. `migration.projects.advancePhase` advances one phase at a time and marks the project `Active` until it reaches `Completed`.

Waves have their own phase and execution state. A newly created wave is `Planned`, has `Pending` approval, and defaults to `Full` run mode with `Standard` validation. The first wave is assigned to `Pilot` so operators can measure throughput, errors, package sizing, and throttling before scaling later waves.

A wave must be explicitly approved before it can become `Ready` or `Running`. Completion is allowed only from `Running` or `Needs review`.

## Tables

| Table | Purpose |
|---|---|
| `migration_projects` | Project identity, tenant connection references, phase, lifecycle status, and readiness score. |
| `migration_waves` | Ordered execution units with run mode, progress, validation policy, approval state, schedule, and change-freeze time. |
| `migration_wave_populations` | Source and target drive/user/path population assignments and scan/migration state. |
| `migration_wave_dependencies` | Completion, approval, or mapping dependencies between waves in the same project. |
| `migration_jobs` | Existing provider jobs optionally link to `projectId`, `waveId`, and a structured `phase`. |

## Protected procedures

- `migration.projects.list`
- `migration.projects.create`
- `migration.projects.advancePhase`
- `migration.waves.list`
- `migration.waves.create`
- `migration.waves.approve`
- `migration.waves.transition`
- `migration.waves.populations`
- `migration.waves.addDependency`
- `migration.jobs.create` with optional `projectId`, `waveId`, and `phase`

All project and wave reads verify the authenticated owner. Dependencies are restricted to waves within the same project. The UI is available under **Migration planning** and supports project creation, phase advancement, wave creation, explicit approval, and controlled status transitions.

## Next extensions

Add durable readiness findings, identity mapping rows, and an approval record capturing approver, decision time, evidence, and override reason. Populate wave populations from resumable Graph discovery rather than manual values.
