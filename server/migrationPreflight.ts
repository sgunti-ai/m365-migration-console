import type { GraphHealth } from "./graph";
import type { MigrationJob } from "../drizzle/schema";

export type PreflightStatus = "Passed" | "Needs review" | "Blocked";
export type RemediationSeverity = "Critical" | "High" | "Medium" | "Low";

export type PreflightCheck = {
  code: string;
  category: "Access" | "Identity" | "Scope" | "Dependency" | "Operations";
  title: string;
  status: PreflightStatus;
  severity: RemediationSeverity;
  detail: string;
  recommendation: string;
  retryable: boolean;
};

function parseCheckpoint(job: MigrationJob) {
  if (!job.checkpoint) return {} as Record<string, unknown>;
  try {
    return JSON.parse(job.checkpoint) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function connectivityCheck(health: GraphHealth[]): PreflightCheck {
  const source = health.find((item) => item.tenant === "source");
  const target = health.find((item) => item.tenant === "target");
  if (source?.status === "connected" && target?.status === "connected") return { code: "TENANT_GRAPH_ACCESS", category: "Access", title: "Source and target Graph access", status: "Passed", severity: "Low", detail: "Both tenant connections responded to a Microsoft Graph organization check.", recommendation: "Keep the application permissions and secrets unchanged through cutover.", retryable: true };
  const missing = [source, target].filter((item) => item?.status !== "connected").map((item) => item?.tenant ?? "tenant").join(" and ");
  const unconfigured = [source, target].some((item) => item?.status === "not_configured");
  return { code: "TENANT_GRAPH_ACCESS", category: "Access", title: "Source and target Graph access", status: unconfigured ? "Blocked" : "Needs review", severity: unconfigured ? "Critical" : "High", detail: `${missing || "Tenant"} connection${missing?.includes(" and ") ? "s" : ""} is not healthy enough for a live run.`, recommendation: "Open Settings, configure encrypted tenant credentials, validate both connections, and rerun pre-flight.", retryable: true };
}

function identityCheck(job: MigrationJob): PreflightCheck {
  const mapped = /mapped|discovered|wave|department/i.test(job.scope);
  return mapped
    ? { code: "IDENTITY_MAPPING", category: "Identity", title: "Identity mapping coverage", status: "Passed", severity: "Low", detail: `The selected scope is ${job.scope.toLowerCase()} and is eligible for mapping validation.`, recommendation: "Keep the approved source-to-target mapping snapshot attached to the wave.", retryable: false }
    : { code: "IDENTITY_MAPPING", category: "Identity", title: "Identity mapping coverage", status: "Needs review", severity: "High", detail: "The job scope does not identify an approved mapped population.", recommendation: "Resolve ambiguous identities and attach an approved source-to-target mapping before execution.", retryable: false };
}

function batchCheck(job: MigrationJob): PreflightCheck {
  const controlled = Boolean(job.batchMode) || job.itemsTotal <= 100;
  return controlled
    ? { code: "BATCH_CONTROL", category: "Operations", title: "Batch and change window", status: "Passed", severity: "Low", detail: job.batchMode ? `Controlled batches are enabled at ${job.batchSize ?? "the configured batch size"}.` : "The selected population is small enough for a single controlled run.", recommendation: "Keep an operator-owned change window and pause if throttling or error rates rise.", retryable: false }
    : { code: "BATCH_CONTROL", category: "Operations", title: "Batch and change window", status: "Needs review", severity: "Medium", detail: `${job.itemsTotal} items are configured for one run without batch controls.`, recommendation: "Enable batches, choose a pilot population, and schedule a change window before running at scale.", retryable: false };
}

function workloadCheck(job: MigrationJob): PreflightCheck[] {
  const checkpoint = parseCheckpoint(job);
  if (job.workload === "OneDrive") {
    const hasDrive = typeof checkpoint.driveId === "string" && checkpoint.driveId.length > 0;
    return [hasDrive
      ? { code: "ONEDRIVE_SOURCE_DRIVE", category: "Scope", title: "Source drive reference", status: "Passed", severity: "Low", detail: "A source drive reference is attached to the resumable checkpoint.", recommendation: "Confirm the drive owner and final path scope before cutover.", retryable: false }
      : { code: "ONEDRIVE_SOURCE_DRIVE", category: "Scope", title: "Source drive reference", status: "Needs review", severity: "Medium", detail: "Live OneDrive staging still needs a source drive reference before package submission.", recommendation: "Provide the source drive ID and root item in the live staging step, then rerun pre-flight.", retryable: false },
      { code: "ONEDRIVE_LINKS_PERMISSIONS", category: "Dependency", title: "Links and permissions plan", status: "Needs review", severity: "Medium", detail: "Sharing links, external access, versions, and known folders require workload-specific sampling.", recommendation: "Select representative files and record permission/link validation evidence in the pilot wave.", retryable: false }];
  }
  if (job.workload === "SharePoint") return [{ code: "SHAREPOINT_SITE_INVENTORY", category: "Scope", title: "Site and library inventory", status: /site|library|finance|engineering/i.test(job.scope) ? "Passed" : "Needs review", severity: "High", detail: "Target URLs, owners, libraries, lists, pages, and connected workloads must be inventoried before copy.", recommendation: "Attach the approved site inventory and target topology; exclude orphaned or unsupported sites explicitly.", retryable: false }, { code: "SHAREPOINT_AUTOMATION_DEPENDENCIES", category: "Dependency", title: "Automation and integration dependencies", status: "Needs review", severity: "Medium", detail: "Workflows, Power Platform, apps, web parts, labels, and search connections are not inferred from the job scope.", recommendation: "Assign an owner for each integration and complete an automation smoke test in the target tenant.", retryable: false }];
  if (job.workload === "Exchange") return [{ code: "EXCHANGE_MAILBOX_SCOPE", category: "Scope", title: "Mailbox and archive scope", status: /mailbox|finance|engineering/i.test(job.scope) ? "Passed" : "Needs review", severity: "High", detail: "Mailbox type, archive, holds, delegates, and shared/resource dependencies must be confirmed per user.", recommendation: "Remove or remediate held and unsupported mailboxes, then rerun the same batch validation.", retryable: false }, { code: "EXCHANGE_MAIL_FLOW", category: "Dependency", title: "Mail flow and coexistence", status: "Needs review", severity: "High", detail: "Routing, accepted domains, target addresses, calendar coexistence, and client behavior require an operator test.", recommendation: "Run internal/external mail, calendar, delegate, and mobile-client smoke tests before cutover.", retryable: true }];
  return [{ code: "TEAMS_STRUCTURE_SCOPE", category: "Scope", title: "Teams and channel scope", status: /team|channel|finance|engineering/i.test(job.scope) ? "Passed" : "Needs review", severity: "High", detail: "Teams, channels, owners, members, guests, apps, and associated SharePoint locations must be catalogued.", recommendation: "Approve the team catalog and record out-of-scope channels, apps, and content instead of silently omitting them.", retryable: false }, { code: "TEAMS_WORKLOAD_DEPENDENCIES", category: "Dependency", title: "Teams dependency order", status: "Needs review", severity: "High", detail: "Teams chats and meetings can depend on identity and mailbox readiness; channel files are stored in SharePoint.", recommendation: "Link the Exchange, SharePoint, and identity validation results to this job before cutover.", retryable: false }];
}

export function buildPreflightChecks(job: MigrationJob, health: GraphHealth[]): PreflightCheck[] {
  return [connectivityCheck(health), identityCheck(job), batchCheck(job), ...workloadCheck(job)];
}

export function summarizePreflight(checks: PreflightCheck[]) {
  const blocked = checks.filter((check) => check.status === "Blocked").length;
  const needsReview = checks.filter((check) => check.status === "Needs review").length;
  const passed = checks.filter((check) => check.status === "Passed").length;
  const status: PreflightStatus = blocked > 0 ? "Blocked" : needsReview > 0 ? "Needs review" : "Passed";
  return { status, score: checks.length ? Math.round((passed / checks.length) * 100) : 0, passed, needsReview, blocked };
}
