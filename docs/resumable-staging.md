# Resumable OneDrive staging

The SharePoint Migration API stage-and-submit flow now uses bounded-concurrency, resumable staging for OneDrive files.

## Pipeline behavior

1. Enumerate the source drive and persist the migration job as `Running` with a staging phase.
2. Assign a stable package ID for the staging attempt.
3. Upload files with bounded concurrency. The default is four workers; callers can lower or raise the value through the staging function contract, but the implementation always enforces at least one worker.
4. Retry each download/upload operation with exponential backoff. The default is three attempts.
5. After every successful file, persist a checkpoint and emit a `sharepoint.staging.progress` event. The checkpoint contains the package ID, completed item IDs, staged count, total file count, and update timestamp.
6. If any file fails after retries, fail the job with the checkpoint preserved. A later stage-and-submit attempt skips completed item IDs and resumes the same package.
7. Once all files are staged, regenerate the required XML manifests using the stable package ID, submit the SharePoint Migration API job, and replace the staging checkpoint with the provider checkpoint used by the polling worker.

Folders are represented in the manifest and do not require a binary upload. The job progress surface reports staged files and an ETA such as `Staging 184/242 files`; progress is capped below submission completion until the provider job is accepted.

## Checkpoint shape

```json
{
  "provider": "SharePoint Migration API",
  "driveId": "source-drive-id",
  "rootItemId": "root",
  "staging": {
    "packageId": "stable-package-id",
    "completedItemIds": ["item-1", "item-2"],
    "stagedFiles": 184,
    "totalFiles": 242,
    "updatedAt": "2026-10-18T00:00:00.000Z"
  }
}
```

## Operational guidance

- Keep Redis configured for automatic post-submission polling; staging checkpoints persist in the migration job database even when Redis is unavailable.
- Do not increase concurrency blindly. Microsoft Graph and Azure Blob throttling should be observed before changing the default.
- Treat a failed staging run as resumable rather than deleting the source package. The next attempt uses the same package ID and only uploads missing items.
- Use the live Migration Jobs progress panel and Audit log events to confirm the checkpoint advanced before retrying a failed job.
