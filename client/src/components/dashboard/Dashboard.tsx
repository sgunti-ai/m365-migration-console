import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  CalendarDays,
  Cloud,
  Database,
  ExternalLink,
  Gauge,
  HardDrive,
  MoreHorizontal,
  RefreshCcw,
  Server,
  ShieldCheck,
  Users,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { activity, mockGetOverview, migrationJobs } from "@/lib/mockApi";
import { StatusBadge, LiveDot } from "@/components/StatusBadge";

type Props = { onNewJob: () => void; onRefresh: () => void };
type Period = "24h" | "7d" | "30d";

type Stat = {
  label: string;
  value: string;
  detail: string;
  tone: string;
  icon: typeof Users;
};

const periodData: Record<Period, Array<{ label: string; completed: number; discovered: number }>> = {
  "24h": [
    { label: "00:00", completed: 34, discovered: 58 }, { label: "04:00", completed: 48, discovered: 77 }, { label: "08:00", completed: 71, discovered: 115 }, { label: "12:00", completed: 96, discovered: 142 }, { label: "16:00", completed: 126, discovered: 184 }, { label: "20:00", completed: 151, discovered: 213 }, { label: "Now", completed: 174, discovered: 242 },
  ],
  "7d": [
    { label: "Mon", completed: 842, discovered: 1014 }, { label: "Tue", completed: 1260, discovered: 1482 }, { label: "Wed", completed: 1588, discovered: 1940 }, { label: "Thu", completed: 2196, discovered: 2580 }, { label: "Fri", completed: 2740, discovered: 3228 }, { label: "Sat", completed: 3188, discovered: 3742 }, { label: "Sun", completed: 3624, discovered: 4218 },
  ],
  "30d": [
    { label: "Aug 07", completed: 3820, discovered: 5140 }, { label: "Aug 12", completed: 6480, discovered: 8120 }, { label: "Aug 17", completed: 10400, discovered: 12760 }, { label: "Aug 22", completed: 14600, discovered: 17120 }, { label: "Aug 27", completed: 18980, discovered: 22140 }, { label: "Sep 01", completed: 23240, discovered: 26840 }, { label: "Sep 05", completed: 28460, discovered: 31980 },
  ],
};

const workloadData = [
  { name: "OneDrive", value: 46, color: "#42c9cf" },
  { name: "Exchange", value: 26, color: "#5b8def" },
  { name: "SharePoint", value: 18, color: "#a57cf2" },
  { name: "Teams", value: 10, color: "#efb44d" },
];

const departmentData = [
  { name: "Finance", completed: 412, running: 86, failed: 12 },
  { name: "Engineering", completed: 682, running: 168, failed: 18 },
  { name: "Sales", completed: 514, running: 72, failed: 8 },
  { name: "Operations", completed: 378, running: 94, failed: 14 },
  { name: "Legal", completed: 216, running: 38, failed: 4 },
];

const throughputData = [
  { label: "00:00", gb: 84 }, { label: "04:00", gb: 112 }, { label: "08:00", gb: 148 }, { label: "12:00", gb: 132 }, { label: "16:00", gb: 186 }, { label: "20:00", gb: 218 }, { label: "Now", gb: 246 },
];

const rangeFactors: Record<Period | "custom", number> = { "24h": 0.78, "7d": 0.92, "30d": 1, custom: 0.88 };

const tenantProfiles = {
  "All tenants": { factor: 1, display: "All connected tenants", workloadShift: [0, 0, 0, 0] },
  "Source tenant A": { factor: 0.56, display: "source-a.example", workloadShift: [4, -1, -2, -1] },
  "Source tenant B": { factor: 0.28, display: "eu.source-a.example", workloadShift: [-3, 2, 1, 0] },
  "Source tenant C": { factor: 0.16, display: "latam.source-a.example", workloadShift: [-1, -1, 2, 0] },
} as const;

function cx(...values: Array<string | false | undefined>) { return values.filter(Boolean).join(" "); }

export function Dashboard({ onNewJob, onRefresh }: Props) {
  const [period, setPeriod] = useState<Period>("24h");
  const [dateRange, setDateRange] = useState<Period | "custom">("24h");
  const [tenant, setTenant] = useState<keyof typeof tenantProfiles>("All tenants");
  const [customStart, setCustomStart] = useState("2026-08-29");
  const [customEnd, setCustomEnd] = useState("2026-09-05");
  const [loading, setLoading] = useState(true);
  const [activeJobs, setActiveJobs] = useState(12);
  const [showEmptyActivity, setShowEmptyActivity] = useState(false);
  const scopeFactor = tenantProfiles[tenant].factor;
  const customDayCount = Math.max(1, Math.round((new Date(customEnd).getTime() - new Date(customStart).getTime()) / 86400000) + 1);
  const rangeFactor = dateRange === "custom" ? Math.min(1.25, Math.max(0.35, customDayCount / 7)) : rangeFactors[dateRange];
  const filterFactor = scopeFactor * rangeFactor;
  const activePeriod: Period = dateRange === "custom" ? "7d" : dateRange;
  const selectedRangeLabel = dateRange === "custom" ? `${customStart} → ${customEnd}` : dateRange === "24h" ? "Last 24 hours" : dateRange === "7d" ? "Last 7 days" : "Last 30 days";

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    mockGetOverview().then((data) => {
      if (!mounted) return;
      setActiveJobs(data.activeJobs);
      window.setTimeout(() => mounted && setLoading(false), 360);
    });
    return () => { mounted = false; };
  }, [period, dateRange, tenant, customStart, customEnd]);

  const scaledPeriodData = useMemo(() => periodData[activePeriod].map((point) => ({ ...point, completed: Math.round(point.completed * filterFactor), discovered: Math.round(point.discovered * filterFactor) })), [activePeriod, filterFactor]);
  const scaledWorkloadData = useMemo(() => {
    const rangeShift = dateRange === "24h" ? [0, 1, 0, -1] : dateRange === "custom" ? [1, 0, -1, 0] : [0, 0, 0, 0];
    return workloadData.map((item, index) => ({
      ...item,
      value: Math.max(2, item.value + tenantProfiles[tenant].workloadShift[index] + rangeShift[index]),
    }));
  }, [dateRange, tenant]);
  const scaledDepartmentData = useMemo(() => departmentData.map((item) => ({ ...item, completed: Math.round(item.completed * filterFactor), running: Math.round(item.running * filterFactor), failed: Math.max(1, Math.round(item.failed * filterFactor)) })), [filterFactor]);
  const scaledThroughputData = useMemo(() => throughputData.map((point) => ({ ...point, gb: Math.round(point.gb * filterFactor) })), [filterFactor]);
  const scopedUsers = Math.round(2418 * filterFactor);
  const scopedCompleted = Math.round(1796 * filterFactor);
  const scopedFailed = Math.max(1, Math.round(47 * filterFactor));
  const scopedTransferred = Math.round(8420 * filterFactor);
  const scopedSuccess = ((scopedCompleted / Math.max(1, scopedCompleted + scopedFailed)) * 100).toFixed(1);
  const scopedActiveJobs = Math.max(1, Math.round(activeJobs * scopeFactor));
  const stats: Stat[] = useMemo(() => [
    { label: "Total users to migrate", value: scopedUsers.toLocaleString(), detail: `+${Math.round(184 * filterFactor)} in range`, tone: "cyan", icon: Users },
    { label: "Active migrations", value: String(scopedActiveJobs), detail: `${Math.max(1, Math.round(3 * filterFactor))} need attention`, tone: "blue", icon: RefreshCcw },
    { label: "Completed migrations", value: scopedCompleted.toLocaleString(), detail: `${((scopedCompleted / Math.max(1, scopedUsers)) * 100).toFixed(1)}% of users`, tone: "teal", icon: CheckCircle2 },
    { label: "Failed migrations", value: scopedFailed.toLocaleString(), detail: `${dateRange === "24h" ? "-12" : "-8"} in selected range`, tone: "rose", icon: XCircle },
    { label: "Data transferred", value: `${scopedTransferred.toLocaleString()} GB`, detail: `+${Math.round(620 * filterFactor).toLocaleString()} GB in range`, tone: "violet", icon: Database },
    { label: "Success rate", value: `${scopedSuccess}%`, detail: `${tenant === "All tenants" ? "+1.8%" : "+1.2%"} vs previous range`, tone: "amber", icon: Gauge },
  ], [dateRange, scopedActiveJobs, scopedCompleted, scopedFailed, scopedSuccess, scopedTransferred, scopedUsers, scopeFactor, tenant, filterFactor]);

  const applyDateRange = (value: Period | "custom") => { setDateRange(value); if (value !== "custom") setPeriod(value); };

  return <div className="space-y-5">
    <DashboardFilters dateRange={dateRange} selectedRangeLabel={selectedRangeLabel} tenant={tenant} customStart={customStart} customEnd={customEnd} onDateRangeChange={applyDateRange} onTenantChange={setTenant} onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd} />
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="status-dot bg-teal-300 text-teal-300" />Showing <b className="text-foreground">{tenant}</b> <span className="opacity-40">·</span> {selectedRangeLabel} <button onClick={onRefresh} className="ml-1 font-semibold text-primary hover:underline">Refresh data</button></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {stats.map((stat, index) => <StatCard key={stat.label} stat={stat} index={index} loading={loading} />)}
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,.65fr)]">
      <section className="console-card overflow-hidden" aria-labelledby="progress-heading">
        <PanelHeader title="Migration progress" description="Users discovered and completed across the selected period" action={<div className="flex items-center gap-1 rounded-lg bg-muted p-1">{(["24h", "7d", "30d"] as Period[]).map((value) => <button key={value} onClick={() => applyDateRange(value)} className={cx("rounded-md px-2.5 py-1.5 text-[11px] font-bold", dateRange === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{value === "24h" ? "Last 24h" : value === "7d" ? "7 days" : "30 days"}</button>)}</div>} />
        <div className="h-[280px] p-4 pt-5 sm:p-5"><ResponsiveContainer width="100%" height="100%"><LineChart data={scaledPeriodData} margin={{ top: 6, right: 4, left: -22, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(130,149,178,.16)" /><XAxis dataKey="label" tick={{ fill: "#8295b2", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "#8295b2", fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip /><Line type="monotone" dataKey="completed" name="Completed" stroke="#42c9cf" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#42c9cf" }} /><Line type="monotone" dataKey="discovered" name="Discovered" stroke="#5b8def" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4, fill: "#5b8def" }} /></LineChart></ResponsiveContainer></div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-5 py-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#42c9cf]" />Completed</span><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#5b8def]" />Discovered</span><span className="ml-auto">Current period completion <b className="text-foreground">{scopedSuccess}%</b></span></div>
      </section>

      <section className="console-card overflow-hidden" aria-labelledby="workload-heading">
        <PanelHeader title="Workload distribution" description="Share of total migration scope" action={<button onClick={() => toast.info("Opening workload details")} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><MoreHorizontal size={16} /></button>} />
        <div className="flex min-h-[280px] items-center gap-4 px-5 py-4"><div className="h-[190px] w-[190px] shrink-0"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={scaledWorkloadData} dataKey="value" innerRadius={58} outerRadius={84} paddingAngle={3} stroke="none">{scaledWorkloadData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="24" fontWeight="700">100%</text><text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" fill="#8295b2" fontSize="10">scope</text></PieChart></ResponsiveContainer></div><div className="min-w-0 flex-1 space-y-4">{workloadData.map((entry) => <div key={entry.name} className="flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color }} />{entry.name}</span><span className="font-bold text-foreground">{entry.value}%</span></div>)}</div></div>
      </section>
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,.75fr)]">
      <section className="console-card overflow-hidden" aria-labelledby="department-heading">
        <PanelHeader title="Status by department" description="Migration outcomes for each business group" action={<button onClick={() => toast.success("Department report exported")} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-[11px] font-bold hover:bg-muted"><ArrowDownToLine size={13} />Export</button>} />
        <div className="h-[285px] p-4 pt-5 sm:p-5"><ResponsiveContainer width="100%" height="100%"><BarChart data={scaledDepartmentData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }} barGap={3}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(130,149,178,.16)" /><XAxis dataKey="name" tick={{ fill: "#8295b2", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "#8295b2", fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11, color: "#8295b2" }} /><Bar dataKey="completed" name="Completed" fill="#42c9cf" radius={[3, 3, 0, 0]} /><Bar dataKey="running" name="Running" fill="#5b8def" radius={[3, 3, 0, 0]} /><Bar dataKey="failed" name="Failed" fill="#f06b78" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </section>
      <section className="console-card overflow-hidden" aria-labelledby="throughput-heading">
        <PanelHeader title="Transfer throughput" description="Data transferred per hour" action={<LiveDot />} />
        <div className="h-[285px] p-4 pt-5 sm:p-5"><ResponsiveContainer width="100%" height="100%"><AreaChart data={scaledThroughputData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}><defs><linearGradient id="dashboardThroughput" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a57cf2" stopOpacity={.38} /><stop offset="100%" stopColor="#a57cf2" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(130,149,178,.16)" /><XAxis dataKey="label" tick={{ fill: "#8295b2", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "#8295b2", fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip /><Area type="monotone" dataKey="gb" name="GB / hour" stroke="#a57cf2" strokeWidth={2.5} fill="url(#dashboardThroughput)" /></AreaChart></ResponsiveContainer></div><div className="flex items-center justify-between border-t border-border px-5 py-3 text-[11px]"><span className="text-muted-foreground">Current throughput</span><span className="font-bold text-violet-300">246 GB/hr <span className="ml-1 font-medium text-teal-300">+18%</span></span></div>
      </section>
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
      <ActivityPanel showEmpty={showEmptyActivity} setShowEmpty={setShowEmptyActivity} onNewJob={onNewJob} tenant={tenant} />
      <SystemHealth onRefresh={onRefresh} tenant={tenant} />
    </div>
  </div>;
}

function DashboardFilters({ dateRange, selectedRangeLabel, tenant, customStart, customEnd, onDateRangeChange, onTenantChange, onCustomStartChange, onCustomEndChange }: { dateRange: Period | "custom"; selectedRangeLabel: string; tenant: keyof typeof tenantProfiles; customStart: string; customEnd: string; onDateRangeChange: (value: Period | "custom") => void; onTenantChange: (value: keyof typeof tenantProfiles) => void; onCustomStartChange: (value: string) => void; onCustomEndChange: (value: string) => void }) {
  return <section className="console-card flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between" aria-label="Dashboard filters"><div className="flex items-center gap-2"><div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays size={16} /></div><div><div className="text-xs font-bold">Dashboard scope</div><div className="mt-0.5 text-[11px] text-muted-foreground">Every metric and chart updates with this selection</div></div></div><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><div className="flex items-center gap-1 rounded-lg bg-muted p-1">{(["24h", "7d", "30d", "custom"] as const).map((value) => <button key={value} onClick={() => onDateRangeChange(value)} className={cx("rounded-md px-2.5 py-1.5 text-[11px] font-bold", dateRange === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{value === "24h" ? "24 hours" : value === "7d" ? "7 days" : value === "30d" ? "30 days" : "Custom"}</button>)}</div><select aria-label="Filter by tenant" value={tenant} onChange={(event) => onTenantChange(event.target.value as keyof typeof tenantProfiles)} className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold outline-none focus:border-ring"><option>All tenants</option><option>Source tenant A</option><option>Source tenant B</option><option>Source tenant C</option></select>{dateRange === "custom" && <div className="flex items-center gap-1"><input aria-label="Start date" type="date" value={customStart} onChange={(event) => onCustomStartChange(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-[11px] outline-none focus:border-ring" /><span className="text-xs text-muted-foreground">to</span><input aria-label="End date" type="date" value={customEnd} onChange={(event) => onCustomEndChange(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-[11px] outline-none focus:border-ring" /></div>}</div></section>;
}

function StatCard({ stat, index, loading }: { stat: Stat; index: number; loading: boolean }) {
  const toneClasses: Record<string, string> = { cyan: "bg-teal-400/10 text-teal-300", blue: "bg-blue-400/10 text-blue-300", teal: "bg-emerald-400/10 text-emerald-300", rose: "bg-rose-400/10 text-rose-300", violet: "bg-violet-400/10 text-violet-300", amber: "bg-amber-400/10 text-amber-300" };
  const Icon = stat.icon;
  return <div className={cx("console-card reveal p-4 sm:p-5", `reveal-delay-${Math.min(index, 3)}`)}>{loading ? <div className="animate-pulse space-y-4"><div className="flex justify-between"><div className="h-3 w-28 rounded bg-muted" /><div className="h-8 w-8 rounded-lg bg-muted" /></div><div className="h-8 w-24 rounded bg-muted" /><div className="h-3 w-32 rounded bg-muted" /></div> : <><div className="flex items-start justify-between"><span className="text-xs font-semibold text-muted-foreground">{stat.label}</span><span className={cx("grid h-8 w-8 place-items-center rounded-lg", toneClasses[stat.tone])}><Icon size={15} /></span></div><div className="metric-number mt-4 font-['Space_Grotesk'] text-[27px] font-bold text-foreground">{stat.value}</div><div className={cx("mt-2 flex items-center gap-1.5 text-[11px] font-semibold", stat.tone === "rose" ? "text-rose-300" : "text-teal-300")}><ArrowRight size={12} />{stat.detail}</div></>}</div>;
}

function PanelHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="font-['Space_Grotesk'] text-sm font-bold" id={`${title.toLowerCase().replaceAll(" ", "-")}-heading`}>{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>{action}</div>; }

function ActivityPanel({ showEmpty, setShowEmpty, onNewJob, tenant }: { showEmpty: boolean; setShowEmpty: (value: boolean) => void; onNewJob: () => void; tenant: keyof typeof tenantProfiles }) {
  const latestJobs = migrationJobs.slice(0, tenant === "All tenants" ? 3 : 2);
  return <section className="console-card overflow-hidden" aria-labelledby="recent-activity-heading"><div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 className="font-['Space_Grotesk'] text-sm font-bold" id="recent-activity-heading">Recent activity</h2><p className="mt-1 text-xs text-muted-foreground">Migration jobs, errors, and user notifications</p></div><div className="flex items-center gap-1"><button onClick={() => setShowEmpty(!showEmpty)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted">{showEmpty ? "Show sample" : "Empty state"}</button><button onClick={() => toast.info("Activity history is available in the Audit log")} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><MoreHorizontal size={16} /></button></div></div>{showEmpty ? <EmptyState icon={Activity} title="No recent activity" description="When migration jobs change state or users need attention, events will appear here." actionLabel="Create a migration job" onAction={onNewJob} /> : <div className="divide-y divide-border/70">{latestJobs.map((job) => <div key={job.id} className="flex items-center gap-3 px-5 py-3.5"><div className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", job.status === "Needs review" ? "bg-amber-400/10 text-amber-300" : "bg-blue-400/10 text-blue-300")}><Cloud size={15} /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">{job.name}</div><div className="mt-1 text-[11px] text-muted-foreground">{job.id} <span className="mx-1 opacity-40">·</span> {job.started}</div></div><StatusBadge status={job.status} /></div>)}{activity.slice(1, 3).map((event) => <div key={event.title} className="flex items-center gap-3 px-5 py-3.5"><div className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", event.type === "warning" ? "bg-amber-400/10 text-amber-300" : event.type === "error" ? "bg-rose-400/10 text-rose-300" : "bg-teal-400/10 text-teal-300")}>{event.type === "warning" ? <AlertCircle size={15} /> : event.type === "error" ? <XCircle size={15} /> : <CheckCircle2 size={15} />}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">{event.title}</div><div className="mt-1 text-[11px] text-muted-foreground">{event.detail}</div></div>{event.type === "warning" || event.type === "error" ? <button onClick={() => toast.info("Opening remediation queue")} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted">Review</button> : <span className="text-[10px] font-semibold text-teal-300">Read</span>}</div>)}</div>}<button onClick={() => toast.info("Activity history is available in the Audit log")} className="flex w-full items-center justify-center gap-1.5 border-t border-border py-3 text-[11px] font-bold text-primary hover:bg-muted">View all activity <ArrowRight size={13} /></button></section>;
}

function SystemHealth({ onRefresh, tenant }: { onRefresh: () => void; tenant: keyof typeof tenantProfiles }) {
  const checks = [
    { label: "Source tenant API", detail: tenant === "All tenants" ? "3 connections active" : tenantProfiles[tenant].display, status: "Connected", icon: Cloud, tone: "teal" },
    { label: "Target tenant API", detail: "destination.example", status: "Connected", icon: Server, tone: "teal" },
    { label: "Graph throttling", detail: "2 events in the last hour", status: "Watch", icon: Zap, tone: "amber" },
    { label: "License compliance", detail: tenant === "All tenants" ? "2,406 of 2,418 ready" : `${Math.round(2406 * tenantProfiles[tenant].factor).toLocaleString()} of ${Math.round(2418 * tenantProfiles[tenant].factor).toLocaleString()} ready`, status: tenant === "All tenants" ? "99.5%" : "99.1%", icon: ShieldCheck, tone: "teal" },
  ];
  return <section className="console-card overflow-hidden" aria-labelledby="health-heading"><div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 className="font-['Space_Grotesk'] text-sm font-bold" id="health-heading">System health</h2><p className="mt-1 text-xs text-muted-foreground">Tenant connections and readiness signals</p></div><button onClick={onRefresh} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Refresh system health"><RefreshCcw size={15} /></button></div><div className="divide-y divide-border/70">{checks.map((check) => { const Icon = check.icon; const warning = check.tone === "amber"; return <div key={check.label} className="flex items-center gap-3 px-5 py-3.5"><div className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", warning ? "bg-amber-400/10 text-amber-300" : "bg-teal-400/10 text-teal-300")}><Icon size={15} /></div><div className="min-w-0 flex-1"><div className="text-xs font-bold">{check.label}</div><div className="mt-1 truncate text-[11px] text-muted-foreground">{check.detail}</div></div><div className={cx("flex items-center gap-1.5 text-[11px] font-bold", warning ? "text-amber-300" : "text-teal-300")}><span className={cx("status-dot", warning ? "bg-amber-300 text-amber-300" : "bg-teal-300 text-teal-300")} />{check.status}</div></div>; })}</div><div className="mx-5 my-4 rounded-lg border border-blue-300/15 bg-blue-300/5 p-3"><div className="flex items-start gap-2.5"><Wifi size={15} className="mt-0.5 shrink-0 text-blue-300" /><div><div className="text-xs font-bold text-blue-100">All core systems operational</div><div className="mt-1 text-[11px] leading-relaxed text-blue-100/65">Polling interval is 30 seconds. Last health check completed just now.</div></div></div></div></section>;
}

function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: { icon: typeof Activity; title: string; description: string; actionLabel: string; onAction: () => void }) { return <div className="flex min-h-[250px] flex-col items-center justify-center px-6 py-10 text-center"><div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon size={19} /></div><div className="mt-4 text-sm font-bold">{title}</div><p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p><button onClick={onAction} className="mt-5 flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted">{actionLabel}<ArrowRight size={13} /></button></div>; }
