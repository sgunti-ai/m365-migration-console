import { useState } from "react";
import { Activity, AlertTriangle, Clock3, Gauge, Layers3, RotateCcw, X, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { evaluateWorkerRisk } from "./workerTelemetryRisk";

const fmt = (value: number) => value.toLocaleString();

export function WorkerTelemetryPanel() {
  const [logOpen, setLogOpen] = useState(false);
  const { data, isLoading, isError } = trpc.migration.worker.telemetry.useQuery(undefined, { refetchInterval: 10000 });
  const unavailable = !isLoading && (!data?.enabled || isError);
  const staging = data?.queues.staging;
  const polling = data?.queues.polling;
  const counters = data?.counters;
  const risk = evaluateWorkerRisk({ throttles: counters?.throttles ?? 0, failedJobRate: counters?.failedJobRate ?? 0 });
  const warning = !unavailable && risk.level !== "safe";

  return <section className="console-card overflow-hidden">
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300"><Activity size={17} /></div><div><h2 className="font-['Space_Grotesk'] text-sm font-bold">Worker telemetry</h2><p className="mt-1 text-xs text-muted-foreground">BullMQ staging and polling health · refreshes every 10s</p></div></div>
      {warning ? <button type="button" onClick={() => setLogOpen(true)} className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${risk.level === "critical" ? "bg-rose-400/10 text-rose-300" : "bg-amber-400/10 text-amber-300"}`} aria-label="Open worker incident log"><span className={`h-1.5 w-1.5 rounded-full ${risk.level === "critical" ? "bg-rose-300" : "bg-amber-300"}`} />{risk.level === "critical" ? "Critical risk" : "Attention needed"}<span className="ml-1 underline underline-offset-2">View log</span></button> : <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${unavailable ? "bg-amber-400/10 text-amber-300" : "bg-teal-400/10 text-teal-300"}`}><span className={`h-1.5 w-1.5 rounded-full ${unavailable ? "bg-amber-300" : "bg-teal-300"}`} />{isLoading ? "Sampling" : unavailable ? "Redis unavailable" : "Healthy"}</span>}
    </div>
    {unavailable ? <div className="flex items-start gap-3 px-5 py-4 text-xs text-muted-foreground"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" /><p>Configure <span className="font-semibold text-foreground">REDIS_URL</span> to activate queue depth, retry, throttling, and throughput telemetry.</p></div> : <>
      {warning && <button type="button" onClick={() => setLogOpen(true)} className={`flex w-full items-start gap-3 border-b px-5 py-3 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${risk.level === "critical" ? "border-rose-300/20 bg-rose-300/10 text-rose-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`} role="alert"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><span className="block font-bold">{risk.level === "critical" ? "Migration worker risk is above the safe threshold" : "Migration worker needs attention"}</span><span className="mt-1 block text-[11px] opacity-80">{risk.reasons.join(" · ")}. Click to inspect recent incidents.</span></span></button>}
      <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4"><Metric icon={Layers3} label="Queue depth" value={fmt((staging?.waiting ?? 0) + (polling?.waiting ?? 0))} detail={`Staging ${staging?.waiting ?? 0} · Polling ${polling?.waiting ?? 0}`} /><Metric icon={Zap} label="Throughput" value={`${fmt(counters?.throughputMbHr ?? 0)} MB/hr`} detail={`${fmt(counters?.stagedBytes ?? 0)} bytes staged`} tone="teal" /><Metric icon={RotateCcw} label="Retry rate" value={`${counters?.retryRate ?? 0}%`} detail={`${fmt(counters?.retries ?? 0)} retries · ${fmt(counters?.jobsFailed ?? 0)} failed`} tone="amber" /><Metric icon={Gauge} label="Throttling" value={fmt(counters?.throttles ?? 0)} detail={`${fmt(counters?.failedJobRate ?? 0)}% failed job rate`} tone="rose" /></div>
      {logOpen && <IncidentLogPanel close={() => setLogOpen(false)} />}
    </>}
  </section>;
}

function IncidentLogPanel({ close }: { close: () => void }) {
  const { data, isLoading, isError } = trpc.migration.worker.recentIncidents.useQuery(undefined, { refetchInterval: 15000 });
  const failedJobs = data?.failedJobs ?? [];
  const throttlingEvents = data?.throttlingEvents ?? [];
  return <div className="border-t border-border bg-background/50" aria-label="Recent worker incident log"><div className="flex items-center justify-between border-b border-border px-5 py-3"><div><h3 className="text-xs font-bold text-foreground">Recent worker incidents</h3><p className="mt-1 text-[10px] text-muted-foreground">Failed jobs and throttling events from the latest migration activity</p></div><button type="button" onClick={close} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close incident log"><X size={14} /></button></div>{isLoading ? <div className="px-5 py-5 text-xs text-muted-foreground">Loading recent incidents…</div> : isError ? <div className="px-5 py-5 text-xs text-rose-300">Unable to load incident history. Try again shortly.</div> : !failedJobs.length && !throttlingEvents.length ? <div className="px-5 py-5 text-xs text-muted-foreground">No recent failed jobs or throttling events were found.</div> : <div className="grid gap-4 p-5 lg:grid-cols-2"><IncidentGroup title="Failed jobs" count={failedJobs.length}>{failedJobs.map(job => <div key={job.id} className="rounded-lg border border-rose-300/15 bg-rose-300/5 p-3"><div className="flex items-center justify-between gap-3"><span className="truncate text-xs font-bold text-foreground">{job.name}</span><span className="text-[10px] font-semibold text-rose-300">{job.progress}%</span></div><div className="mt-1 text-[10px] text-muted-foreground">{job.id} · {job.workload} · {job.errors} error{job.errors === 1 ? "" : "s"}</div><div className="mt-2 text-[10px] text-muted-foreground">{job.eta}</div></div>)}</IncidentGroup><IncidentGroup title="Throttling events" count={throttlingEvents.length}>{throttlingEvents.map(event => <div key={event.id} className="rounded-lg border border-amber-300/15 bg-amber-300/5 p-3"><div className="flex items-center justify-between gap-3"><span className="truncate text-xs font-bold text-foreground">{event.jobName}</span><span className="text-[10px] font-semibold text-amber-300">{event.type}</span></div><div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><Clock3 size={11} />{new Date(event.createdAt).toLocaleString()}</div><div className="mt-2 line-clamp-2 text-[10px] text-muted-foreground">{typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload)}</div></div>)}</IncidentGroup></div>}</div>;
}

function IncidentGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <div><div className="mb-2 flex items-center justify-between"><h4 className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{title}</h4><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{count}</span></div><div className="max-h-52 space-y-2 overflow-auto">{children}</div></div>;
}

function Metric({ icon: Icon, label, value, detail, tone = "blue" }: { icon: typeof Gauge; label: string; value: string; detail: string; tone?: "blue" | "teal" | "amber" | "rose" }) {
  const styles = { blue: "bg-blue-400/10 text-blue-300", teal: "bg-teal-400/10 text-teal-300", amber: "bg-amber-400/10 text-amber-300", rose: "bg-rose-400/10 text-rose-300" };
  return <div className="bg-card px-5 py-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</span><span className={`grid h-7 w-7 place-items-center rounded-lg ${styles[tone]}`}><Icon size={14} /></span></div><div className="mt-3 font-['Space_Grotesk'] text-xl font-bold text-foreground">{value}</div><div className="mt-1 text-[10px] text-muted-foreground">{detail}</div></div>;
}
