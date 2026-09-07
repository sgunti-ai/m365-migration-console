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
2. The server enumerates folders and files recursively through Graph.
3. The server stages binary content and generates `Manifest.xml`, `ExportSettings.xml`, `SystemData.xml`, and `UserGroupMap.xml`.
4. The server submits the package to `/_api/site/CreateMigrationJob`.
5. The returned SharePoint job ID and progress token are saved in the persisted migration checkpoint.
6. The BullMQ worker invokes `GetMigrationJobProgress`, advances `NextToken`, updates job progress, emits a WebSocket event, and requeues the next poll until `JobEnd` or `JobError`.

## BullMQ worker

The worker uses the `m365-sharepoint-migration` queue with concurrency 2, a limiter of 20 jobs per second, six exponential-backoff attempts per poll, and a five-second delay between successful polls. It starts with the Express process and is intentionally disabled when `REDIS_URL` is missing. In that state, package submission still works and the job checkpoint is persisted, but progress must be polled manually or after Redis is configured.

## Current limitation

The adapter and worker are implemented and protected behind tRPC. Bulk packaging is currently sequential and should be moved to a bounded-concurrency staging pipeline for large tenants. The Redis/BullMQ worker is required for automatic progress polling in production.

## References

- [SharePoint Migration API overview](https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-api-overview)
- [SharePoint Migration API reference](https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-api-reference)
- [Migration job progress API](https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-job-progress-api-reference)
- [Migration manifest files](https://learn.microsoft.com/en-us/sharepoint/dev/apis/migration-manifest)
