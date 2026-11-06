import { Activity, AlertTriangle, Gauge, Layers3, RotateCcw, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";

const fmt = (value: number) => value.toLocaleString();

export function WorkerTelemetryPanel() {
  const { data, isLoading, isError } = trpc.migration.worker.telemetry.useQuery(undefined, { refetchInterval: 10000 });
  const unavailable = !isLoading && (!data?.enabled || isError);
  const staging = data?.queues.staging;
  const polling = data?.queues.polling;
  const counters = data?.counters;
  return <section className="console-card overflow-hidden"><div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300"><Activity size={17} /></div><div><h2 className="font-['Space_Grotesk'] text-sm font-bold">Worker telemetry</h2><p className="mt-1 text-xs text-muted-foreground">BullMQ staging and polling health · refreshes every 10s</p></div></div><span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${unavailable ? "bg-amber-400/10 text-amber-300" : "bg-teal-400/10 text-teal-300"}`}><span className={`h-1.5 w-1.5 rounded-full ${unavailable ? "bg-amber-300" : "bg-teal-300"}`} />{isLoading ? "Sampling" : unavailable ? "Redis unavailable" : "Live"}</span></div>{unavailable ? <div className="flex items-start gap-3 px-5 py-4 text-xs text-muted-foreground"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" /><p>Configure <span className="font-semibold text-foreground">REDIS_URL</span> to activate queue depth, retry, throttling, and throughput telemetry.</p></div> : <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4"><Metric icon={Layers3} label="Queue depth" value={fmt((staging?.waiting ?? 0) + (polling?.waiting ?? 0))} detail={`Staging ${staging?.waiting ?? 0} · Polling ${polling?.waiting ?? 0}`} /><Metric icon={Zap} label="Throughput" value={`${fmt(counters?.throughputMbHr ?? 0)} MB/hr`} detail={`${fmt(counters?.stagedBytes ?? 0)} bytes staged`} tone="teal" /><Metric icon={RotateCcw} label="Retry rate" value={`${counters?.retryRate ?? 0}%`} detail={`${fmt(counters?.retries ?? 0)} retries · ${fmt(counters?.jobsFailed ?? 0)} failed`} tone="amber" /><Metric icon={Gauge} label="Throttling" value={fmt(counters?.throttles ?? 0)} detail={`${fmt((staging?.active ?? 0) + (polling?.active ?? 0))} active jobs`} tone="rose" /></div>}</section>;
}

function Metric({ icon: Icon, label, value, detail, tone = "blue" }: { icon: typeof Gauge; label: string; value: string; detail: string; tone?: "blue" | "teal" | "amber" | "rose" }) {
  const styles = { blue: "bg-blue-400/10 text-blue-300", teal: "bg-teal-400/10 text-teal-300", amber: "bg-amber-400/10 text-amber-300", rose: "bg-rose-400/10 text-rose-300" };
  return <div className="bg-card px-5 py-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</span><span className={`grid h-7 w-7 place-items-center rounded-lg ${styles[tone]}`}><Icon size={14} /></span></div><div className="mt-3 font-['Space_Grotesk'] text-xl font-bold text-foreground">{value}</div><div className="mt-1 text-[10px] text-muted-foreground">{detail}</div></div>;
}
