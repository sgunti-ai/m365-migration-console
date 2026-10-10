import { Activity, ArrowRight, CheckCircle2, Cloud, Gauge, Layers3, ShieldCheck, TimerReset, Users, AlertTriangle } from "lucide-react";
import type { MigrationJob } from "@/lib/mockApi";
import { completionPercent, overallCompletion } from "./oneDriveStrategyMetrics";

type StrategyJob = MigrationJob & { itemsDone?: number; itemsTotal?: number; throughputGbHr?: number | null };

type Props = {
  jobs: StrategyJob[];
  onNewJob: () => void;
};

const strategySteps = [
  { number: "01", title: "Assess and reduce scope", detail: "Inventory users, files, versions, sharing, licenses, and source exceptions. Exclude stale or redundant content before packaging.", icon: Layers3 },
  { number: "02", title: "Provision and map", detail: "Provision every destination OneDrive, then approve one source-to-target identity mapping before it enters a wave.", icon: Users },
  { number: "03", title: "Pilot, then wave", detail: "Run a representative pilot, fix permission and path issues, and roll out controlled waves with resumable checkpoints.", icon: Gauge },
  { number: "04", title: "Pre-stage and cut over", detail: "Run a full copy first, repeat incremental deltas, announce a short freeze, then execute the final delta and switch users.", icon: TimerReset },
  { number: "05", title: "Validate and close", detail: "Compare counts, permissions, versions, sharing, and sample files. Keep the source read-only through the rollback window.", icon: ShieldCheck },
];

function jobItems(job: StrategyJob) {
  if (typeof job.itemsDone === "number" && typeof job.itemsTotal === "number") return `${job.itemsDone.toLocaleString()} / ${job.itemsTotal.toLocaleString()} items`;
  return job.items || "Item count pending";
}

export function OneDriveStrategy({ jobs, onNewJob }: Props) {
  const oneDriveJobs = jobs.filter((job) => job.workload.toLowerCase().includes("onedrive"));
  const ongoing = oneDriveJobs.filter((job) => !["Completed", "Cancelled"].includes(job.status));
  const overall = overallCompletion(ongoing);
  const attention = ongoing.filter((job) => ["Needs review", "Failed", "Paused"].includes(job.status)).length;

  return <div className="space-y-5">
    <section className="console-card overflow-hidden" aria-labelledby="onedrive-strategy-heading">
      <div className="border-b border-border bg-gradient-to-r from-cyan-400/10 via-transparent to-blue-400/10 px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div><div className="eyebrow">OneDrive Accounts migration strategy</div><h2 id="onedrive-strategy-heading" className="mt-1 font-['Space_Grotesk'] text-xl font-bold">Assess once. Pre-stage twice. Cut over with evidence.</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">A controlled strategy combining Quest-style discovery, matching, project waves, and reporting with ShareGate-style CSV or scripted bulk execution, incremental copies, and operator-friendly validation.</p></div><button onClick={onNewJob} className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"><Cloud size={14} /> Create OneDrive job</button></div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"><span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-2 py-1 font-bold text-teal-300">Recommended: pilot → full copy → delta → cutover</span><span className="rounded-full border border-border px-2 py-1">Adaptive concurrency</span><span className="rounded-full border border-border px-2 py-1">Owner-scoped audit trail</span></div>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">{strategySteps.map(({ number, title, detail, icon: Icon }) => <div key={number} className="rounded-xl border border-border bg-card/40 p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-bold text-primary">{number}</span><Icon size={16} className="text-primary" /></div><h3 className="mt-3 text-xs font-bold">{title}</h3><p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p></div>)}</div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border px-5 py-3 text-[10px] text-muted-foreground sm:px-6"><span>Operating guardrails: use off-peak windows, package roughly 250 files and 100–250 MB, and avoid over-queuing requests.</span><a href="https://learn.microsoft.com/en-us/sharepointmigration/sharepoint-online-and-onedrive-migration-speed" target="_blank" rel="noreferrer" className="font-bold text-primary hover:underline">Microsoft performance guidance <ArrowRight size={11} className="ml-1 inline" /></a></div>
    </section>

    <section className="console-card overflow-hidden" aria-labelledby="onedrive-monitor-heading">
      <div className="flex flex-col justify-between gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><Activity size={15} className="text-teal-300" /><h2 id="onedrive-monitor-heading" className="font-['Space_Grotesk'] text-sm font-bold">Ongoing OneDrive migration jobs</h2><span className="flex items-center gap-1 rounded-full bg-teal-400/10 px-2 py-1 text-[10px] font-bold text-teal-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-300" />Live</span></div><p className="mt-1 text-xs text-muted-foreground">Completion percentage is refreshed from the persisted job checkpoint and worker events.</p></div><div className="flex items-center gap-4 text-right"><div><div className="text-lg font-bold tabular-nums">{overall}%</div><div className="text-[10px] text-muted-foreground">overall completion</div></div><div className="hidden h-8 w-px bg-border sm:block" /><div><div className="text-lg font-bold tabular-nums">{ongoing.length}</div><div className="text-[10px] text-muted-foreground">ongoing jobs</div></div></div></div>
      {attention > 0 && <div className="flex items-start gap-2 border-b border-amber-400/20 bg-amber-400/5 px-5 py-3 text-[11px] text-amber-100/80"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" /><span>{attention} OneDrive job{attention === 1 ? "" : "s"} need operator attention before they can complete.</span></div>}
      {ongoing.length ? <div className="divide-y divide-border/70">{ongoing.map((job) => { const percent = completionPercent(job); const tone = job.status === "Needs review" || job.status === "Paused" || job.status === "Failed" ? "bg-amber-400" : "bg-gradient-to-r from-cyan-400 to-blue-400"; return <div key={job.id} className="px-5 py-4 sm:px-6"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-xs font-bold">{job.name}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold">{job.status}</span></div><div className="mt-1 text-[10px] text-muted-foreground">{job.id} · {jobItems(job)} · {job.eta || "ETA pending"}</div></div><div className="flex items-center gap-3"><span className="text-sm font-bold tabular-nums">{percent}%</span><CheckCircle2 size={15} className={percent >= 100 ? "text-teal-300" : "text-muted-foreground"} /></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${percent}%` }} /></div><div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground"><span>{job.throughput || (job.throughputGbHr ? `${job.throughputGbHr} GB/hr` : "Throughput pending")}</span><span>{percent >= 100 ? "Complete" : "Checkpoint safe · resumable"}</span></div></div>; })}</div> : <div className="p-8 text-center"><CheckCircle2 size={24} className="mx-auto text-teal-300" /><h3 className="mt-2 text-sm font-bold">No active OneDrive jobs</h3><p className="mt-1 text-xs text-muted-foreground">Create a pilot or full-copy job to start tracking completion here.</p><button onClick={onNewJob} className="mt-4 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">Create OneDrive job</button></div>}
    </section>

    <p className="text-[10px] leading-relaxed text-muted-foreground">Strategy references: <a href="https://support.quest.com/technical-documents/on-demand-migration/current/user-guide" target="_blank" rel="noreferrer" className="text-primary hover:underline">Quest On Demand Migration user guide</a> · <a href="https://help.sharegate.com/en/articles/10236220-copy-onedrive-for-business-overview" target="_blank" rel="noreferrer" className="text-primary hover:underline">ShareGate OneDrive overview</a> · <a href="https://sharegate.com/blog/how-to-migrate-onedrive-from-one-tenant-to-another" target="_blank" rel="noreferrer" className="text-primary hover:underline">ShareGate tenant-to-tenant guidance</a></p>
  </div>;
}
