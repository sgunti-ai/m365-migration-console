# SharePoint Migration API bulk import

The OneDrive bulk-import adapter follows Microsoft’s package-based SharePoint Migration API flow. It enumerates a source drive tree through Microsoft Graph, uploads binary files to an Azure Blob source container, uploads XML migration manifests to a separate manifest container, submits `CreateMigrationJob` to the target SharePoint site, and polls `GetMigrationJobProgress` with the returned `NextToken`.

## Required server secrets

Configure these values as server-side project secrets. Do not expose them to the browser:

| Variable | Purpose |
|---|---|
| `MS_GRAPH_SOURCE_TENANT_ID` | Source Microsoft Entra tenant ID |
| `MS_GRAPH_SOURCE_CLIENT_ID` | Source app registration client ID |
| `MS_GRAPH_SOURCE_CLIENT_SECRET` | Source app registration client secret |
| `MS_GRAPH_TARGET_TENANT_ID` | Target Microsoft Entra tenant ID |
| `MS_GRAPH_TARGET_CLIENT_ID` | Target app registration client ID |
| `MS_GRAPH_TARGET_CLIENT_SECRET` | Target app registration client secret |
| `MS_SHAREPOINT_TARGET_SITE_URL` | Target SharePoint site URL, such as `https://contoso.sharepoint.com/sites/migration` |
| `MS_SHAREPOINT_TARGET_WEB_ID` | Target SharePoint web GUID |
| `MS_SHAREPOINT_SOURCE_CONTAINER_SAS_URI` | SAS URI for the Azure Blob container holding content files |
| `MS_SHAREPOINT_MANIFEST_CONTAINER_SAS_URI` | SAS URI for a separate Azure Blob container holding manifests and logs |
| `MS_SHAREPOINT_QUEUE_REPORT_SAS_URI` | Optional Azure Queue SAS URI for job reports |
| `REDIS_URL` | Redis connection URL for BullMQ, such as `rediss://:password@host:6380` |

The SharePoint API access token is requested for the target SharePoint origin rather than the Microsoft Graph audience. Graph tokens are used for source OneDrive enumeration and downloads.

## Required permissions and setup

Use application-based authentication for background migration services. Grant the source app the least-privileged Microsoft Graph permissions required to enumerate and download the selected OneDrive content. Grant the target app the SharePoint/Microsoft Graph application permissions required by the tenant’s migration policy, including at least the permissions required by `GetMigrationJobProgress`. Admin consent is required.

The source and manifest containers must be separate. The Migration API needs read access to the source container and read/list/write access to the manifest container. SAS tokens must be HTTPS, valid before submission, and long enough for the SharePoint import queue to finish.

## Runtime flow

1. The authenticated operator creates a OneDrive job and provides a source drive ID and root item ID.
2. The API validates Redis availability, persists the job as queued, and enqueues a staging job; no recursive enumeration or blob transfer runs inside the HTTP request.
3. A dedicated BullMQ staging worker enumerates folders and files recursively through Graph, stages binary content with bounded concurrency, and persists a resumable checkpoint after each successful file.
4. The staging worker generates `Manifest.xml`, `ExportSettings.xml`, `SystemData.xml`, and `UserGroupMap.xml`, then submits the package to `/_api/site/CreateMigrationJob`.
5. The returned SharePoint job ID and progress token replace the staging checkpoint in the persisted migration record.
6. The BullMQ polling worker invokes `GetMigrationJobProgress`, advances `NextToken`, updates job progress, emits a WebSocket event, and requeues the next poll until `JobEnd` or `JobError`.

## BullMQ worker

The workers use `m365-sharepoint-migration` for provider polling and `m365-sharepoint-staging` for package preparation. Polling runs with concurrency 2, a limiter of 20 jobs per second, six exponential-backoff attempts per poll, and a five-second delay between successful polls. Staging runs with one package worker, three exponential-backoff attempts, and bounded file concurrency inside the resumable staging function. Both workers start with the Express process and are disabled when `REDIS_URL` is missing. In that state, the API rejects stage-and-submit requests with a clear prerequisite error rather than starting a long-running HTTP operation.

## Worker telemetry

The protected `migration.worker.telemetry` procedure samples both queues and is displayed at the top of Migration Jobs. It reports waiting, active, delayed, completed, and failed counts; staged bytes and rolling MB/hour throughput; retry count and retry rate; and throttling events detected from 429, 503, or rate-limit errors. Queue counts are Redis-backed. Counters are process-local and reset when the worker restarts, so durable reporting should be added through centralized metrics before production SLO reporting.

The UI marks the worker healthy until three throttling events or a 10% failed-job rate is reached. It then shows an amber attention banner; ten throttling events or a 25% failed-job rate escalates the banner to critical. These are operator guardrails, not hard execution blocks: review provider retry-after guidance and failed-job remediation before increasing concurrency.

## Operational note

The adapter and workers are implemented and protected behind tRPC. Configure Redis before starting a pilot; otherwise background staging and automatic progress polling remain unavailable. Staging checkpoints are retained in the migration job record, so a retried BullMQ attempt skips files already uploaded under the same package ID.

## References

- [SharePoint Migration API overview](https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-api-overview)
- [SharePoint Migration API reference](https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-api-reference)
- [Migration job progress API](https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-job-progress-api-reference)
- [Migration manifest files](https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-manifest)
