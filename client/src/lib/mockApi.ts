export type MigrationStatus = "Running" | "Paused" | "Completed" | "Needs review" | "Queued" | "Failed" | "Cancelled";

export type MigrationJob = {
  id: string;
  name: string;
  workload: string;
  owner: string;
  status: MigrationStatus;
  progress: number;
  items: string;
  started: string;
  throughput: string;
  errors: number;
  eta: string;
  checkpoint?: Record<string, unknown> | null;
  batchMode?: boolean;
  batchSize?: string | null;
  schedule?: string | null;
  scheduledAt?: string | null;
};

export const overviewStats = [
  { label: "Users discovered", value: "2,418", detail: "+184 this week", tone: "cyan" },
  { label: "Items migrated", value: "1.28M", detail: "84.6% of scope", tone: "blue" },
  { label: "Data transferred", value: "8.42 TB", detail: "+620 GB today", tone: "violet" },
  { label: "Active jobs", value: "12", detail: "3 need attention", tone: "amber" },
] as const;

export const migrationJobs: MigrationJob[] = [
  { id: "JOB-2408", name: "Finance pilot wave", workload: "OneDrive", owner: "S. Patel", status: "Running", progress: 76, items: "184 / 242 users", started: "Today, 08:42", throughput: "118 GB/hr", errors: 4, eta: "~1h 26m" },
  { id: "JOB-2407", name: "Engineering wave 01", workload: "OneDrive + SharePoint", owner: "J. Martin", status: "Running", progress: 42, items: "322 / 764 users", started: "Today, 06:10", throughput: "92 GB/hr", errors: 12, eta: "~5h 10m" },
  { id: "JOB-2405", name: "Acquired users · EU", workload: "OneDrive", owner: "L. Chen", status: "Needs review", progress: 91, items: "612 / 672 users", started: "Yesterday, 20:18", throughput: "—", errors: 31, eta: "Paused" },
  { id: "JOB-2398", name: "Legal hold migration", workload: "Exchange", owner: "M. Ross", status: "Completed", progress: 100, items: "98 / 98 users", started: "Aug 27, 14:00", throughput: "—", errors: 0, eta: "Complete" },
  { id: "JOB-2397", name: "APAC department", workload: "OneDrive", owner: "A. Singh", status: "Completed", progress: 100, items: "412 / 412 users", started: "Aug 26, 10:24", throughput: "—", errors: 2, eta: "Complete" },
];

export const activity = [
  { type: "success", title: "Finance pilot wave resumed", detail: "Migration JOB-2408 · 2 minutes ago" },
  { type: "warning", title: "12 users need mapping review", detail: "Engineering wave 01 · 18 minutes ago" },
  { type: "info", title: "Discovery scan completed", detail: "2,418 source users found · 44 minutes ago" },
  { type: "error", title: "3 throttling events detected", detail: "Acquired users · EU · 1 hour ago" },
];

export const discoveryUsers = [
  { initials: "AR", name: "Alicia Rodriguez", email: "alicia.rodriguez@northwind.com", source: "Northwind Global", target: "alicia.rodriguez@contoso.com", workload: "OneDrive · Mailbox", status: "Mapped", risk: "Low" },
  { initials: "JM", name: "Jordan Miller", email: "jordan.miller@northwind.com", source: "Northwind Global", target: "jordan.miller@contoso.com", workload: "OneDrive", status: "Mapped", risk: "Low" },
  { initials: "KN", name: "Kaitlyn Nguyen", email: "kaitlyn.nguyen@northwind.com", source: "Northwind EU", target: "—", workload: "OneDrive · Teams", status: "Needs mapping", risk: "Medium" },
  { initials: "OM", name: "Owen McCarthy", email: "owen.mccarthy@northwind.com", source: "Northwind Global", target: "owen.mccarthy@contoso.com", workload: "OneDrive · SharePoint", status: "Mapped", risk: "Low" },
  { initials: "RD", name: "Renee Dubois", email: "renee.dubois@northwind.com", source: "Northwind EU", target: "renee.dubois@contoso.com", workload: "OneDrive", status: "Conflict", risk: "High" },
  { initials: "TS", name: "Tomas Silva", email: "tomas.silva@northwind.com", source: "Northwind LATAM", target: "—", workload: "OneDrive", status: "Excluded", risk: "Low" },
];

export const errorRows = [
  { code: "OD-403", message: "Target user does not have an active OneDrive license", entity: "renee.dubois@contoso.com", job: "JOB-2405", severity: "High", lastSeen: "8 min ago", action: "Assign license" },
  { code: "OD-429", message: "Microsoft Graph throttling limit reached", entity: "JOB-2407 / batch 08", job: "JOB-2407", severity: "Medium", lastSeen: "18 min ago", action: "Retry with backoff" },
  { code: "MAP-102", message: "Multiple target matches returned for source identity", entity: "kaitlyn.nguyen@northwind.com", job: "Discovery", severity: "Medium", lastSeen: "26 min ago", action: "Review mapping" },
  { code: "OD-404", message: "Source personal site could not be resolved", entity: "tomas.silva@northwind.com", job: "JOB-2407", severity: "Low", lastSeen: "41 min ago", action: "Retry discovery" },
];

export const auditEvents = [
  { time: "09:42:18", actor: "S. Patel", action: "Resumed migration job", scope: "JOB-2408", result: "Success", ip: "10.24.8.14" },
  { time: "09:18:03", actor: "System", action: "Completed discovery scan", scope: "All tenants", result: "Success", ip: "—" },
  { time: "08:57:44", actor: "J. Martin", action: "Updated mapping rule", scope: "Engineering wave 01", result: "Success", ip: "10.24.9.21" },
  { time: "08:31:10", actor: "L. Chen", action: "Exported error report", scope: "JOB-2405", result: "Success", ip: "10.24.7.18" },
  { time: "08:12:56", actor: "System", action: "Failed license validation", scope: "12 accounts", result: "Warning", ip: "—" },
];

export const throughputData = [
  { time: "06:00", migrated: 18, discovered: 64 }, { time: "08:00", migrated: 31, discovered: 98 }, { time: "10:00", migrated: 45, discovered: 72 }, { time: "12:00", migrated: 58, discovered: 124 }, { time: "14:00", migrated: 72, discovered: 110 }, { time: "16:00", migrated: 86, discovered: 142 }, { time: "18:00", migrated: 93, discovered: 88 },
];

export const statusBreakdown = [
  { name: "Completed", value: 71, color: "#54c8cf" }, { name: "In progress", value: 18, color: "#4f9af2" }, { name: "Needs review", value: 7, color: "#f4be58" }, { name: "Failed", value: 4, color: "#fa6973" },
];

export async function mockGetOverview() {
  await new Promise((resolve) => setTimeout(resolve, 280));
  return { refreshedAt: new Date().toISOString(), activeJobs: Math.floor(12 + Math.random() * 2), stats: overviewStats };
}

export async function mockCreateJob(payload: { name: string; scope: string; concurrency: string }) {
  await new Promise((resolve) => setTimeout(resolve, 650));
  return { id: `JOB-${Math.floor(2410 + Math.random() * 80)}`, ...payload, status: "Queued" as MigrationStatus };
}
