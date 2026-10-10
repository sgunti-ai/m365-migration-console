# OneDrive Accounts migration strategy

## Recommended operating model

Porterline should use a hybrid model: Quest-style discovery, identity matching, project waves, readiness gates, and progress reporting; combined with ShareGate-style content-only OneDrive copies, CSV/scripted bulk execution, incremental passes, and operator-readable reports.

### 1. Assess and reduce scope

Inventory source users, OneDrive provisioning state, file counts, versions, sharing, permissions, path risks, licenses, and exceptions. Remove stale or redundant content before packaging. Microsoft identifies source scanning and scope reduction as the first performance step because the amount of content directly affects project size and duration. [1]

### 2. Provision targets and approve mappings

Provision each destination OneDrive before the content move. Store a source UPN/object ID to target UPN/object ID mapping and require an explicit approval state before a user enters a migration wave. ShareGate documents that the destination OneDrive must exist first and that OneDrive URLs are user-bound and can change after a UPN change. [2]

### 3. Pilot, then controlled waves

Run a representative pilot across data sizes, sharing models, departments, and regional tenants. Use the pilot to tune concurrency, path handling, permissions, and validation sampling. Create waves from approved mappings, not from an unreviewed bulk user list. Quest describes its product around discovery, analysis, migration projects, and progress reporting. [3]

### 4. Full copy, delta, freeze, final delta

Run a full content-only copy first. Repeat incremental deltas to reduce the final cutover window. Schedule the final delta during a regional off-peak window, announce a short source freeze, switch users to the target, and keep the source read-only for the rollback window. ShareGate recommends content-only copying for OneDrive and supports incremental and bulk migration patterns. [2] [4]

### 5. Validate and close out

Compare source and target counts, file sizes, versions, permissions, sharing links, and representative file samples. Capture exceptions as actionable remediation items. Mark a wave complete only when its validation evidence and rollback window are complete.

## Performance guardrails

- Prefer evening and weekend regional windows because Microsoft applies tighter background-app throttling during weekday daytime hours. Throttling cannot be disabled. [1]
- Package approximately 250 files per transfer and keep packages between 100 MB and 250 MB where practical. [1]
- Avoid over-queuing. Microsoft recommends no more than 5,000 migration jobs or requests in the queue. [1]
- Use adaptive concurrency and exponential backoff for 429 responses rather than forcing throughput through throttling.
- Keep staging and manifest storage geographically close to Microsoft 365 where possible. [1]

## Product comparison translated into Porterline capabilities

| Capability | Quest On Demand pattern | ShareGate pattern | Porterline implementation target |
| --- | --- | --- | --- |
| Discovery | Analyze tenant structure and migration risks | Inventory and plan before copy | Graph discovery plus readiness findings |
| Identity | Account migration and matching workflow | CSV or scripted source/target mapping | Durable mapping records with approval gates |
| Execution | Project and wave management | Content-only, bulk, incremental, scripted execution | Waves, resumable jobs, full/delta/cutover modes |
| Operations | In-depth progress reporting | Migration reports with warnings and errors | Live status, percentage completion, events, and remediation |
| Scale control | Managed project execution | PowerShell for many OneDrives | Bounded concurrency, backoff, queue limits, and worker checkpoints |
| Safety | Analysis before migration | Provision destination and validate reports | Pilot gates, freeze window, evidence, and rollback hold |

## Live job monitor

The Migration Jobs section shows all ongoing OneDrive jobs, an overall completion percentage, individual percentage bars, item counts, ETA, throughput, status, and whether the job is checkpoint-safe and resumable. It is fed by persisted migration job progress and worker events when live credentials and Redis are configured; otherwise it falls back to the console's sample jobs.

## References

[1]: https://learn.microsoft.com/en-us/sharepointmigration/sharepoint-online-and-onedrive-migration-speed "Microsoft general migration performance guidance"
[2]: https://help.sharegate.com/en/articles/10236220-copy-onedrive-for-business-overview "ShareGate Copy OneDrive for Business Overview"
[3]: https://support.quest.com/technical-documents/on-demand-migration/current/user-guide "Quest On Demand Migration User Guide"
[4]: https://sharegate.com/blog/how-to-migrate-onedrive-from-one-tenant-to-another "ShareGate How to migrate OneDrive from one tenant to another"
