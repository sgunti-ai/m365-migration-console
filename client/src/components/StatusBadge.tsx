import { CheckCircle2, CircleDashed, Clock3, OctagonAlert, PauseCircle, ShieldAlert } from "lucide-react";
import type { MigrationStatus } from "@/lib/mockApi";

type Props = { status: MigrationStatus | string; size?: "sm" | "md" };

const config: Record<string, { className: string; icon: typeof CheckCircle2 }> = {
  Running: { className: "bg-sky-400/10 text-sky-300 border-sky-400/20", icon: CircleDashed },
  Completed: { className: "bg-teal-400/10 text-teal-300 border-teal-400/20", icon: CheckCircle2 },
  "Needs review": { className: "bg-amber-400/10 text-amber-300 border-amber-400/20", icon: ShieldAlert },
  Queued: { className: "bg-violet-400/10 text-violet-300 border-violet-400/20", icon: Clock3 },
  Failed: { className: "bg-rose-400/10 text-rose-300 border-rose-400/20", icon: OctagonAlert },
  Paused: { className: "bg-amber-400/10 text-amber-300 border-amber-400/20", icon: PauseCircle },
  Mapped: { className: "bg-teal-400/10 text-teal-300 border-teal-400/20", icon: CheckCircle2 },
  "Needs mapping": { className: "bg-amber-400/10 text-amber-300 border-amber-400/20", icon: ShieldAlert },
  Conflict: { className: "bg-rose-400/10 text-rose-300 border-rose-400/20", icon: OctagonAlert },
  Excluded: { className: "bg-slate-400/10 text-slate-300 border-slate-400/20", icon: PauseCircle },
  Success: { className: "bg-teal-400/10 text-teal-300 border-teal-400/20", icon: CheckCircle2 },
  Warning: { className: "bg-amber-400/10 text-amber-300 border-amber-400/20", icon: ShieldAlert },
  High: { className: "bg-rose-400/10 text-rose-300 border-rose-400/20", icon: OctagonAlert },
  Medium: { className: "bg-amber-400/10 text-amber-300 border-amber-400/20", icon: ShieldAlert },
  Low: { className: "bg-slate-400/10 text-slate-300 border-slate-400/20", icon: CircleDashed },
};

export function StatusBadge({ status, size = "sm" }: Props) {
  const entry = config[status] ?? config.Queued;
  const Icon = entry.icon;
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-semibold ${size === "sm" ? "text-[11px]" : "text-xs"} ${entry.className}`}><Icon size={size === "sm" ? 12 : 14} strokeWidth={2.2} />{status}</span>;
}

export function LiveDot({ label = "Live" }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-teal-300"><span className="status-dot pulse-live bg-teal-300 text-teal-300" />{label}</span>;
}
