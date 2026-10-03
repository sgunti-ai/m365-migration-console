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

## Dependency visualization and cutover runbooks

The planning page now exposes a dependency map for every wave in the selected project. Operators can select a wave to highlight its upstream and downstream gates, review each dependency type (`Completion`, `Approval`, or `Mapping`), and add a same-project dependency without leaving the planning surface. Completion dependencies are evaluated against the upstream wave status before a runbook can be marked `Ready`.

Each project lazily receives one durable cutover runbook with six default gates:

1. Confirm wave approval and dependencies.
2. Announce the source change freeze.
3. Run the final delta and preflight checks.
4. Switch users to the target OneDrive.
5. Validate access, permissions, and sampling.
6. Hold the rollback decision window.

Every step has an owner role, category, status, and optional evidence reference. Operators can schedule the cutover window, record the change-freeze time, move steps through `Pending → In progress → Completed`, and mark the runbook ready only after completion dependencies are clear. Runbook state and evidence are persisted in `migration_runbooks` and `migration_runbook_steps`.
