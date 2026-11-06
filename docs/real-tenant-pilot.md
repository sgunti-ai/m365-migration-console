# Real tenant pilot configuration

The console is tenant-agnostic. Configure source and destination tenants after signing in; no customer tenant is hardcoded into the application.

## Configure from the UI

1. Open **Settings → Tenants**.
2. Add a **Source tenant** connection with a display label, Microsoft Entra tenant ID, app registration client ID, and client secret.
3. Add a **Destination tenant** connection with the same identity fields and the target SharePoint site URL.
4. Save each connection, then select **Validate with Microsoft Graph**.
5. Confirm both connections show `Connected` before running discovery or creating a production migration wave.

Client secrets are sent only over the authenticated HTTPS request, encrypted with AES-256-GCM on the server, and never returned to the browser. The authenticated workspace owner scopes tenant connections and migration records.

## App registrations

Use separate source and destination app registrations where possible. Grant only the application permissions required by the selected workload, then grant tenant admin consent. For OneDrive bulk import, the source app needs permission to enumerate and download the selected content; the destination app needs the SharePoint/Microsoft Graph permissions required by the SharePoint Migration API and progress endpoints.

## Server-side pilot secrets

Configure these as deployment secrets, never in source control or browser environment variables:

- `BOOTSTRAP_ADMIN_PASSWORD`
- `CREDENTIAL_ENCRYPTION_KEY`
- `REDIS_URL`
- `MS_SHAREPOINT_TARGET_SITE_URL`
- `MS_SHAREPOINT_TARGET_WEB_ID`
- `MS_SHAREPOINT_SOURCE_CONTAINER_SAS_URI`
- `MS_SHAREPOINT_MANIFEST_CONTAINER_SAS_URI`
- `MS_SHAREPOINT_QUEUE_REPORT_SAS_URI` (optional)

If tenant connections are stored in Settings, their Graph tenant ID, client ID, and client secret are used for dynamic validation. The SharePoint staging worker additionally requires Azure Blob SAS containers, Redis, and the target SharePoint configuration above.

## Pilot safety checklist

Start with a small representative wave, run pre-flight validation, verify identity mappings and target OneDrive provisioning, and confirm throttling/retry telemetry before increasing concurrency. Keep the source available through the validation and rollback window. Do not paste production secrets into tickets, chat, screenshots, or client-side configuration.
