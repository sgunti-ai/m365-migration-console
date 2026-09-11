# SharePoint and OneDrive Migration: Product-Grade Improvement Plan

**Author:** Manus AI  
**Prepared:** 11 September 2026  
**Scope:** Microsoft 365 tenant-to-tenant SharePoint and OneDrive migration

## Executive conclusion

The current tool has a useful technical foundation: it can enumerate OneDrive content through Microsoft Graph, generate a SharePoint Migration API package, upload content and manifests to Azure Blob Storage, submit a migration job, poll progress through BullMQ, and surface updates through WebSockets. It is not yet product-grade because the operator workflow is still package-centric rather than migration-program-centric.

The most important improvement is to build a **migration control plane** around the existing adapter. The control plane should model discovery, assessment, identity mapping, wave planning, incremental passes, cutover readiness, item-level validation, remediation, and audit evidence as first-class objects. This is the common thread in ShareGate’s documented workflow: prepare and assess first, plan waves, execute with incremental or concurrent runs, and validate against an item-level report afterward [1] [2] [3].

The recommended implementation sequence is:

1. **P0:** make the existing pipeline reliable and observable at item level;
2. **P0:** add preflight assessment and a human-reviewable readiness gate;
3. **P0:** add identity mapping and wave/batch orchestration;
4. **P1:** add incremental migration and cutover runbooks;
5. **P1:** add post-migration validation, permissions evidence, and remediation queues;
6. **P2:** add advanced scale, policy, and governance features.

## What the reference products teach us

ShareGate presents migration as a sequence rather than a single copy action. Its documented guide separates **Prepare**, **Learn**, **Plan**, and **Validate** phases [1]. Its product overview describes scanning for structure, ownership, activity, permissions, stale content, and risky configurations before migration; batching the work; supporting incremental and concurrent runs; retrying throttled requests; and retaining reports after migration [2]. Its OneDrive guidance emphasizes pre-checks, granular source-to-target mapping, permission handling, and a post-migration Permissions Matrix Report [3].

The most valuable product lesson is therefore not a particular visual layout. It is the conversion of migration complexity into a sequence of explicit decisions with visible readiness criteria.

| Reference capability | Evidence from reference material | Required product behavior in this tool |
|---|---|---|
| Preparation before execution | ShareGate separates preparation, learning, planning, and validation [1]. | A migration cannot start until the operator reviews unresolved readiness findings or explicitly overrides them with an audited reason. |
| Pre-migration assessment | ShareGate reports structure, ownership, activity, permissions, stale content, and risky configuration issues [2]. | Scan selected drives and produce findings with severity, affected object, recommended action, and resolvability. |
| Mapping and controlled waves | ShareGate supports granular mapping and batching by organizational structure [2] [3]. | Store source identity, target identity, source drive, target drive, wave, priority, owner, and approval state as durable records. |
| Incremental migration | Incremental runs copy new or changed content and reduce the cutover window; they are not full synchronization and do not delete destination content [4]. | Provide explicit Full, Incremental, and Final Cutover run types with clear deletion semantics and change-freeze controls. |
| Item-level reporting | ShareGate reports Success, Started, Error, Warning, and Skipped states; details can be opened and reports exported [5]. | Persist normalized item outcomes, raw provider events, error codes, correlation IDs, retryability, and remediation actions. |
| Post-migration verification | ShareGate recommends validating against migration reports and using permissions matrix reports [3] [5]. | Add content, metadata, version, ownership, and permission verification with a signed validation summary. |
| Real-time operations | Microsoft returns queued, started, progress, error, and end events; progress is tokenized and idempotent [6]. | Show an event timeline, last provider checkpoint, stale-poll warning, estimated progress confidence, and explicit terminal state. |
| Throttle-aware execution | Microsoft requires honoring `Retry-After`, reducing concurrency, avoiding spikes, and decorating traffic with application identity [7]. | Centralize retry policy, expose throttle state, apply per-tenant concurrency budgets, and send an identifying user agent. |

## Current implementation gap analysis

The current adapter in `server/sharepointMigration.ts` is a solid proof of concept, but it exposes several risks at production scale.

| Area | Current state | Product-grade gap | Priority |
|---|---|---|---|
| Source enumeration | Recursive breadth-first enumeration with a fixed `$top=200`. | No delta token, checkpointed enumeration, cancellation, resumability, or per-drive throttling. | P0 |
| Content staging | Downloads and uploads files sequentially. | A single failed file can interrupt the package; no bounded concurrency, checksum, resume, quarantine, or staging manifest of actual uploads. | P0 |
| Package sizing | All selected content is placed into one logical package. | Microsoft recommends packages under 250 MB or 250 items for best performance and limits individual files to 15 GB [8]. The tool needs deterministic package partitioning. | P0 |
| Manifest fidelity | Basic folder and file entries are generated. | No version history, metadata, authorship, timestamps, permissions, mapping, long-path, invalid-character, or conflict policy representation. | P0 |
| Migration submission | `CreateMigrationJob` is called against a configured site. | No provider capability check, destination freeze gate, configuration validation, or package preflight before submission. | P0 |
| Progress processing | Events are parsed and a next token is returned. | Event fields are not normalized into item-level records; terminal event semantics, expired jobs, and provider correlation IDs need durable handling. | P0 |
| Retry and throttling | SharePoint 429/503 is surfaced as an error containing `retry-after`; BullMQ performs polling retries. | The request layer does not yet centrally honor `Retry-After`, classify retryable errors, or adapt concurrency. | P0 |
| Identity mapping | The UI has discovery mock data, but the SharePoint package flow does not consume durable mappings. | Users, groups, owners, and authors need source-to-target mapping with unresolved and ambiguous states. | P0 |
| Incremental runs | The product concept exists in documentation, but the current package flow has no source watermark or run mode. | Add source change tracking, run lineage, cutover state, and explicit non-deletion semantics. | P1 |
| Validation | Status and activity surfaces exist. | No automated destination comparison, permissions evidence, or user-facing validation report. | P1 |
| Audit | Migration job events are persisted. | Audit must include operator decisions, overrides, credential validation, package hashes, run lineage, and exportable evidence. | P1 |
| Tenant configuration | Tenant credentials can be encrypted and Graph-validated. | SharePoint site, web, storage, permissions, and capacity checks need a preflight result attached to each run. | P0 |

## Target operator experience

### 1. Create a migration project

The operator creates a named project and selects source and destination tenant connections. The project should display tenant organization names, connection age, permission scope, last validation, and any tenant-level warnings. The project is separate from an individual run so that discovery, mappings, waves, and reports remain available across multiple attempts.

### 2. Discover and assess

The operator selects users, drives, or a source population. Discovery runs as a resumable background task. The output is a readiness board with counts for eligible, warning, blocked, skipped, and not-yet-scanned items.

Each finding should answer four questions: **what is affected, why it matters, whether the system can fix it, and what the operator should do next**. Examples include unsupported names, excessive path length, inaccessible source items, missing target users, orphaned ownership, unsupported permissions, very large files, and files that exceed package recommendations.

### 3. Map identities and destinations

Mapping should support CSV import, rule-based matching, manual overrides, and confidence states. A mapping is not ready merely because an email address matches. It should record the source object ID, target object ID, match method, confidence, reviewer, and last validation time.

The operator should be able to preview the effect of a mapping rule before applying it. Conflicts must be represented explicitly instead of being silently overwritten.

### 4. Plan waves

A wave is a durable unit of work containing a population, package policy, concurrency policy, schedule, owner, change-freeze window, and cutover plan. The UI should show dependencies, for example identity mapping before content migration, and should prevent a wave from entering execution while required dependencies are unresolved.

The first wave should be a small pilot. A pilot should have a stricter validation policy and should produce measured throughput, error classes, throttling rate, and package sizing data for later waves.

### 5. Execute with real-time operations

The monitoring view should distinguish at least five layers:

1. **Project state:** overall readiness and wave completion.
2. **Run state:** queued, staging, submitted, provider-processing, validating, completed, completed-with-warnings, failed, paused, or cancelled.
3. **Provider state:** the latest SharePoint event and next-token checkpoint.
4. **Throughput state:** files, bytes, packages, and effective rate over time.
5. **Exception state:** retryable, blocked, skipped, and operator-action-required items.

A real-time feed should show event time, run, package, event type, correlation ID, raw provider message, normalized interpretation, and action. A “last updated” badge should become stale when no poll has advanced the checkpoint within the expected interval.

### 6. Validate and remediate

A completed provider job is not the same as a validated migration. The system should run a validation pass that compares the source inventory and target inventory using stable object keys, normalized paths, file size, hashes where available, version counts, modified timestamps, ownership, and permissions.

Every failed or warning item should have a remediation state: **new, acknowledged, retry scheduled, retrying, resolved, waived, or permanently blocked**. The operator should be able to retry only the affected items or package rather than replaying the whole wave.

### 7. Cut over and close the project

The final cutover flow should require a declared change freeze, a final incremental run, business validation, and an approval. The closeout report should include source and target counts, unresolved exceptions, waivers, permission verification, provider correlation IDs, timestamps, and the operator who approved closure.

## Prioritized roadmap

### P0: Reliability and operational truth

| Initiative | User value | Main implementation work | Acceptance criteria |
|---|---|---|---|
| Resumable discovery and staging | Operators can recover from worker restarts or transient failures. | Add discovery and staging checkpoints, idempotency keys, package manifests, and durable per-item states. | Restarting a worker never duplicates an upload or loses the next source page. |
| Package partitioning | Large migrations avoid oversized or slow packages. | Partition by configurable item and byte thresholds; isolate files above the recommended threshold; record package lineage. | Every package reports item count, byte count, hash, upload completion, and submission status. |
| Central throttle controller | Performance becomes predictable and tenant-safe. | Implement a shared request wrapper honoring `Retry-After`; classify 429/503; reduce concurrency on repeated throttles; emit throttle metrics. | A test server returning 429 with `Retry-After` causes delayed retry rather than immediate retry storm. |
| Normalized event and item ledger | Operators can answer what happened to every item. | Parse provider events into typed records and link them to source item, package, run, correlation ID, and raw payload. | Every terminal run has counts for success, warning, error, skipped, and unresolved items. |
| Tenant and SharePoint preflight | Bad configuration is caught before content staging. | Validate Graph token, SharePoint audience token, site/web, storage SAS, app permissions, HTTPS, and target readiness. | The Start button is blocked with actionable findings when a required preflight check fails. |

### P1: Migration program management

| Initiative | User value | Main implementation work | Acceptance criteria |
|---|---|---|---|
| Identity and permissions mapping | Access survives the move with reviewable decisions. | Add mapping tables, confidence scoring, group/member mapping, owner mapping, and permissions transformation rules. | A wave cannot pass readiness with unresolved required identities unless an audited override exists. |
| Wave planner and pilot mode | Large migrations become controllable and measurable. | Add project, wave, population, schedule, dependency, approval, and pilot entities. | A pilot can be cloned into later waves with measured defaults and a separate approval. |
| Incremental and final cutover runs | Downtime and user disruption are reduced. | Add run modes, source watermark, change-freeze state, lineage, and explicit non-deletion behavior. | An incremental run copies only new/changed content and clearly reports that source deletions are not applied. |
| Validation and permissions evidence | Completion is provable, not inferred from provider status. | Add target inventory, comparison jobs, permissions matrix, owner checks, version checks, and exports. | Closeout report identifies verified, mismatched, unavailable, and waived items. |
| Remediation workbench | Operators fix exceptions without replaying successful work. | Add remediation recipes, retry-safe classification, bulk actions, and audit trail. | Retrying a selected error set creates a new child run and preserves the parent run evidence. |

### P2: Advanced scale and governance

| Initiative | User value | Main implementation work | Acceptance criteria |
|---|---|---|---|
| Adaptive multi-tenant scheduling | The service can run many waves without cross-tenant interference. | Per-tenant queues, fair scheduling, concurrency budgets, and capacity-aware dispatch. | One throttled tenant does not stall unrelated tenant projects. |
| Advanced version and metadata fidelity | Higher confidence for regulated migrations. | Version enumeration, authorship mapping, taxonomy/term mapping, labels, timestamps, and fidelity policies. | The operator can choose fidelity versus speed and sees the resulting trade-off before execution. |
| Governance and retention | Migration evidence survives audits. | Immutable event storage, export bundles, retention policies, and role-scoped access. | An auditor can reconstruct who approved, ran, retried, waived, and closed each wave. |
| Service health and SLOs | Enterprise operators know whether the service itself is healthy. | Worker health, queue latency, provider latency, throttle rate, error budget, and alerting. | Dashboard shows stale workers, delayed polls, queue backlog, and provider failure rates in real time. |

## Real-time architecture proposal

The current WebSocket layer should become a projection of durable state rather than the source of truth. The recommended flow is:

```text
Graph / SharePoint API
        |
        v
Provider adapter -> Request policy -> Event normalizer
        |                                  |
        v                                  v
Item ledger + run checkpoints       Audit event store
        |                                  |
        +--------------> WebSocket projector -> Dashboard
```

The provider adapter should write a durable event before publishing a WebSocket message. The WebSocket payload should include `projectId`, `waveId`, `runId`, `packageId`, `itemId`, `eventType`, `status`, `progress`, `correlationId`, `occurredAt`, and `sequence`. Clients should reconcile by sequence and refetch if they detect a gap.

Polling should be token-based. Microsoft documents that `GetMigrationJobProgress` returns event sequences and a `NextToken`; repeating a completed request with the same token is idempotent [6]. The worker should persist the token transactionally with the normalized events. Microsoft recommends polling at approximately one-minute intervals for long-running jobs and honoring `Retry-After` on 429 and 503 responses [6] [7]. A five-second fixed polling delay is therefore too aggressive as a universal production default; it should be adaptive and provider-aware.

## Security and permission checklist

The tool should validate and display the following before execution:

| Control | Expected behavior |
|---|---|
| Authentication mode | Use app-only authentication for background migration services, as recommended by Microsoft [9]. |
| Secret handling | Keep tenant secrets encrypted at rest and never include them in browser responses, logs, reports, or WebSocket events. |
| Permission scope | Show the exact Graph and SharePoint application permissions granted to each source and destination app. |
| Consent state | Detect missing admin consent and provide a remediation instruction rather than a generic token error. |
| Storage transport | Require HTTPS SAS URIs and validate expiration before package submission. Microsoft enforces HTTPS for SharePoint-provided containers [10]. |
| Storage isolation | Keep content and manifest packages in separate containers; the Migration API documentation requires this separation for the package flow [8] [10]. |
| Traffic identity | Add a product-specific `User-Agent` and application identity to SharePoint requests, as recommended by Microsoft [7]. |
| Least privilege | Separate discovery, staging, destination import, and reporting permissions where operationally possible. |
| Tenant isolation | Enforce owner and role checks on projects, connections, runs, reports, and validation artifacts. |
| Audit integrity | Record operator, timestamp, tenant, action, result, correlation ID, and override reason for every sensitive action. |

## Testing strategy

Production readiness requires more than unit tests. The test pyramid should include deterministic unit tests for manifest generation, package partitioning, path normalization, identity matching, throttle classification, retry delay, token checkpointing, and validation comparison. Contract tests should exercise representative Graph and SharePoint response envelopes, including 429, 503, expired job, malformed event, `JobError`, and `JobEnd` payloads. Integration tests should run against a disposable storage emulator or mocked SAS endpoint and verify idempotent staging. End-to-end tests should execute a pilot project from connection validation through closeout report. Load tests should measure queue latency, memory usage during large enumeration, concurrent package staging, and WebSocket event fan-out.

The system should also maintain golden fixtures for provider events. Microsoft’s progress API returns JSON strings inside the `Logs.results` collection, including file-level errors and aggregate `JobEnd` statistics [6]. Those fixtures should be replayed to verify that the UI and reports remain compatible when Microsoft adds fields.

## Important caveats

ShareGate’s marketing and help content describes product behavior from the vendor’s perspective. It is useful for workflow and UX benchmarking, but it is not a complete technical specification. The YouTube pages reviewed here confirm official walkthrough topics, such as connecting environments and preparing through reports, but the extracted pages did not expose full transcripts. Video claims should therefore be used as workflow references rather than as authoritative API evidence [11] [12].

Microsoft’s Migration API is asynchronous and best-effort. Microsoft does not guarantee a service-level agreement for processing performance [9]. The product should display estimates as estimates and should expose queue delay, throttle delay, and provider processing time separately.

Microsoft documents a 15 GB per-file import limit and recommends packages below 250 MB or 250 items for best performance [8]. These are not substitutes for a comprehensive tenant-specific capacity model. The tool should use them as default guardrails and allow policy-controlled overrides with warnings.

The Migration API does not delete destination content during an incremental migration. ShareGate’s own incremental guidance also distinguishes incremental migration from full synchronization and states that source deletions are not automatically reflected at the destination [4]. The product must make this behavior prominent to avoid accidental data-retention assumptions.

## References

[1]: https://help.sharegate.com/en/articles/10236123-migration-guide-intro "ShareGate Migration guide introduction"
[2]: https://sharegate.com/microsoft-migration "ShareGate Microsoft 365 migration product overview"
[3]: https://sharegate.com/blog/how-to-migrate-files-to-onedrive-for-business "ShareGate OneDrive for Business migration guide"
[4]: https://sharegate.com/glossary/incremental-migration "ShareGate incremental migration glossary"
[5]: https://help.sharegate.com/en/articles/10236238-migration-report-overview "ShareGate migration report overview"
[6]: https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-job-progress-api-reference "Microsoft SharePoint GetMigrationJobProgress API"
[7]: https://learn.microsoft.com/en-us/sharepoint/dev/general-development/how-to-avoid-getting-throttled-or-blocked-in-sharepoint-online "Microsoft guidance for avoiding SharePoint Online throttling"
[8]: https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-content-package "Microsoft guidance for preparing Migration API content packages"
[9]: https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-api-overview "Microsoft SharePoint Migration API introduction"
[10]: https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-azure "Microsoft Azure containers and queues for the SharePoint Migration API"
[11]: https://www.youtube.com/watch?v=9KE_WbwZtLE "How to Understand ShareGate Migration Processes"
[12]: https://www.youtube.com/watch?v=Q3dxXXSRt6Q "How to Prepare for Migration with ShareGate Migrate"
