import { useEffect, useState } from "react";
import { ArrowDownToLine, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type Connection = { id: string; label: string; direction: "source" | "target"; tenantId: string };
type Policy = { id: string; sourceDomain: string; targetDomain: string; status: string; updatedAt: string };
type Mapping = { id: string; sourceUpn?: string | null; targetUpn?: string | null; status: string; matchMethod: string; confidence: number; collisionCode?: string | null; explanation: string };
type Action = "auto_map" | "review" | "block" | "skip";
const defaultMatrix = { exactMatch: "auto_map" as Action, domainRewrite: "review" as Action, targetDuplicate: "review" as Action, noTarget: "review" as Action, disabledTarget: "block" as Action, sourceDuplicate: "block" as Action };
const matrixFields: Array<[keyof typeof defaultMatrix, string]> = [["exactMatch", "Exact match"], ["domainRewrite", "Domain rewrite"], ["targetDuplicate", "Target duplicate"], ["noTarget", "No target"], ["disabledTarget", "Disabled target"], ["sourceDuplicate", "Source duplicate"]];

export function IdentityMappingPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sourceConnectionId, setSourceConnectionId] = useState("");
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [sourceDomain, setSourceDomain] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [matrix, setMatrix] = useState(defaultMatrix);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  const loadPolicies = async () => {
    const response = await fetch("/api/workspace/identity-mapping/policies", { credentials: "include" });
    if (!response.ok) return;
    const result = await response.json() as { policies?: Policy[] };
    const next = result.policies ?? [];
    setPolicies(next);
    if (!policyId && next[0]) setPolicyId(next[0].id);
  };
  const loadMappings = async (selectedPolicy = policyId) => {
    if (!selectedPolicy) { setMappings([]); return; }
    const query = statusFilter === "all" ? "" : `&status=${encodeURIComponent(statusFilter)}`;
    const response = await fetch(`/api/workspace/identity-mapping/mappings?policyId=${encodeURIComponent(selectedPolicy)}${query}`, { credentials: "include" });
    if (response.ok) setMappings(((await response.json()) as { mappings?: Mapping[] }).mappings ?? []);
  };
  useEffect(() => {
    void fetch("/api/workspace/tenant-connections", { credentials: "include" }).then((response) => response.json() as Promise<{ connections?: Connection[] }>).then((result) => {
      const list = result.connections ?? [];
      setConnections(list);
      setSourceConnectionId(list.find((item) => item.direction === "source")?.id ?? "");
      setTargetConnectionId(list.find((item) => item.direction === "target")?.id ?? "");
    });
    void loadPolicies();
  }, []);
  useEffect(() => { void loadMappings(); }, [policyId, statusFilter]);

  const propose = async () => {
    setBusy(true);
    const response = await fetch("/api/workspace/identity-mapping/policies", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ sourceConnectionId, targetConnectionId, sourceDomain, targetDomain, collisionMatrix: matrix }) });
    const result = await response.json() as { ok?: boolean; result?: { policyId: string; summary: Record<string, number>; mappingCount: number }; error?: string };
    setBusy(false);
    if (!response.ok || !result.ok || !result.result) toast.error("Mapping proposal failed", { description: result.error ?? "Check both tenant connections and Graph permissions." });
    else { setPolicyId(result.result.policyId); toast.success("Mapping proposal created", { description: `${result.result.mappingCount.toLocaleString()} users classified. Review collisions before approval.` }); void loadPolicies(); }
  };
  const decide = async (id: string, decision: "approve" | "reject" | "block") => {
    await fetch(`/api/workspace/identity-mapping/mappings/${encodeURIComponent(id)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ decision }) });
    void loadMappings();
  };
  const sources = connections.filter((item) => item.direction === "source");
  const targets = connections.filter((item) => item.direction === "target");
  return <section className="console-card overflow-hidden border-blue-300/20"><div className="border-b border-border bg-blue-300/5 px-5 py-4"><div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-300/15 text-blue-200"><ShieldCheck size={17} /></div><div><div className="eyebrow">Identity mapping</div><h2 className="mt-1 font-['Space_Grotesk'] text-sm font-bold">Rewrite domains and resolve collisions</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Propose deterministic source-to-target mappings from Microsoft Graph. Domain rewrites are never silently executed; ambiguous, duplicate, disabled, or missing targets remain reviewable.</p></div></div></div><div className="space-y-5 p-5"><div className="grid gap-3 md:grid-cols-2"><label className="text-[11px] font-bold text-muted-foreground">Source tenant<select value={sourceConnectionId} onChange={(event) => setSourceConnectionId(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-semibold"><option value="">Select source</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.tenantId}</option>)}</select></label><label className="text-[11px] font-bold text-muted-foreground">Target tenant<select value={targetConnectionId} onChange={(event) => setTargetConnectionId(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs font-semibold"><option value="">Select target</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.tenantId}</option>)}</select></label><label className="text-[11px] font-bold text-muted-foreground">Source domain<input value={sourceDomain} onChange={(event) => setSourceDomain(event.target.value)} placeholder="contoso.com" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs" /></label><label className="text-[11px] font-bold text-muted-foreground">Target domain<input value={targetDomain} onChange={(event) => setTargetDomain(event.target.value)} placeholder="testsecondary.co.in" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs" /></label></div><div className="rounded-xl border border-border bg-muted/15 p-4"><div className="text-xs font-bold">Collision matrix</div><p className="mt-1 text-[11px] text-muted-foreground">Choose the default action for each classification. Individual decisions remain auditable.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{matrixFields.map(([field, label]) => <label key={field} className="text-[11px] font-semibold text-muted-foreground">{label}<select value={matrix[field]} onChange={(event) => setMatrix((current) => ({ ...current, [field]: event.target.value as Action }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"><option value="auto_map">Auto-map</option><option value="review">Needs review</option><option value="block">Block</option><option value="skip">Skip</option></select></label>)}</div></div><button onClick={() => void propose()} disabled={busy || !sourceConnectionId || !targetConnectionId || !sourceDomain || !targetDomain} className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50"><RefreshCcw size={14} className={busy ? "animate-spin" : ""} />{busy ? "Reading tenants…" : "Propose identity mappings"}</button>{policies.length > 0 && <div className="border-t border-border pt-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="eyebrow">Mapping review queue</div><div className="mt-1 text-[11px] text-muted-foreground">{mappings.length.toLocaleString()} records in the selected view</div></div><div className="flex gap-2"><select value={policyId} onChange={(event) => setPolicyId(event.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-[11px] font-semibold">{policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.sourceDomain} → {policy.targetDomain} · {policy.status}</option>)}</select>{policyId && <a href={`/api/workspace/identity-mapping/mappings.csv?policyId=${encodeURIComponent(policyId)}`} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold hover:bg-muted"><ArrowDownToLine size={13} />CSV</a>}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-[11px] font-semibold"><option value="all">All statuses</option><option value="needs_review">Needs review</option><option value="unmapped">Unmapped</option><option value="blocked">Blocked</option><option value="proposed">Proposed</option><option value="approved">Approved</option></select></div></div><div className="mt-3 overflow-x-auto rounded-lg border border-border/70"><table className="w-full min-w-[800px] text-left text-[11px]"><thead className="bg-muted/30 text-muted-foreground"><tr><th className="px-3 py-2">Source</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">Match</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2 text-right">Action</th></tr></thead><tbody className="divide-y divide-border/60">{mappings.map((mapping) => <tr key={mapping.id}><td className="px-3 py-2 font-semibold">{mapping.sourceUpn ?? "—"}</td><td className="px-3 py-2 font-semibold">{mapping.targetUpn ?? "—"}</td><td className="px-3 py-2"><span className="rounded bg-blue-300/10 px-1.5 py-1 text-blue-200">{mapping.matchMethod}</span><div className="mt-1 text-[10px] text-muted-foreground">{mapping.confidence}% confidence</div></td><td className="px-3 py-2">{mapping.status}</td><td className="max-w-[300px] px-3 py-2 text-muted-foreground">{mapping.explanation}</td><td className="px-3 py-2 text-right"><div className="flex justify-end gap-1">{mapping.status !== "approved" && mapping.targetUpn && <button onClick={() => void decide(mapping.id, "approve")} className="rounded bg-teal-300/10 px-2 py-1 font-bold text-teal-200">Approve</button>}{!["blocked", "rejected"].includes(mapping.status) && <button onClick={() => void decide(mapping.id, "block")} className="rounded bg-rose-300/10 px-2 py-1 font-bold text-rose-200">Block</button>}</div></td></tr>)}</tbody></table></div></div>}</div></section>;
}
