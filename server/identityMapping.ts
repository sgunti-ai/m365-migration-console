import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { identityMappingPolicies, identityMappings } from "../drizzle/schema";
import { checkTargetAccountReadiness, discoverGraphUsersForConnection, provisionTargetUser, type GraphUser } from "./graph";

export type CollisionAction = "auto_map" | "review" | "block" | "skip";
export type CollisionMatrix = {
  exactMatch: CollisionAction;
  domainRewrite: CollisionAction;
  targetDuplicate: CollisionAction;
  noTarget: CollisionAction;
  disabledTarget: CollisionAction;
  sourceDuplicate: CollisionAction;
};

export const defaultCollisionMatrix: CollisionMatrix = {
  exactMatch: "auto_map",
  domainRewrite: "review",
  targetDuplicate: "review",
  noTarget: "review",
  disabledTarget: "block",
  sourceDuplicate: "block",
};

type MappingStatus = "proposed" | "approved" | "rejected" | "blocked" | "needs_review" | "unmapped";
type MappingInput = { sourceUserId: string; sourceUpn?: string; sourceMail?: string; targetUserId?: string; targetUpn?: string; targetMail?: string; status: MappingStatus; matchMethod: string; confidence: number; collisionCode?: string; explanation: string; decision: string };

const normalize = (value?: string) => value?.trim().toLowerCase() || "";
const localPart = (upn?: string) => normalize(upn).split("@")[0] || "";
const domainOf = (upn?: string) => normalize(upn).split("@")[1] || "";
const applyDomainRewrite = (upn: string, sourceDomain: string, targetDomain: string) => {
  const normalized = normalize(upn);
  return domainOf(normalized) === normalize(sourceDomain) ? `${localPart(normalized)}@${normalize(targetDomain)}` : "";
};
const id = (prefix: string) => `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 22)}`;

function candidatesFor(value: string, byUpn: Map<string, GraphUser[]>, byMail: Map<string, GraphUser[]>) {
  return [...(byUpn.get(value) ?? []), ...(byMail.get(value) ?? [])].filter((candidate, index, list) => list.findIndex((item) => item.id === candidate.id) === index);
}

export function buildMappingProposals(sourceUsers: GraphUser[], targetUsers: GraphUser[], sourceDomain: string, targetDomain: string, matrix: CollisionMatrix = defaultCollisionMatrix): MappingInput[] {
  const targetByUpn = new Map<string, GraphUser[]>();
  const targetByMail = new Map<string, GraphUser[]>();
  const sourceKeys = new Map<string, number>();
  for (const user of sourceUsers) {
    const key = normalize(user.userPrincipalName) || normalize(user.mail);
    if (key) sourceKeys.set(key, (sourceKeys.get(key) ?? 0) + 1);
  }
  for (const user of targetUsers) {
    const upn = normalize(user.userPrincipalName);
    const mail = normalize(user.mail);
    if (upn) targetByUpn.set(upn, [...(targetByUpn.get(upn) ?? []), user]);
    if (mail) targetByMail.set(mail, [...(targetByMail.get(mail) ?? []), user]);
  }

  return sourceUsers.filter((user) => Boolean(user.id)).map((source) => {
    const sourceUpn = source.userPrincipalName;
    const sourceMail = source.mail;
    const duplicateKey = normalize(sourceUpn) || normalize(sourceMail);
    if (!sourceUpn && !sourceMail) return { sourceUserId: source.id, status: "unmapped", matchMethod: "none", confidence: 0, collisionCode: "SOURCE_IDENTITY_MISSING", explanation: "Source user has no UPN or mail attribute to derive a target identity.", decision: "review" };
    if (duplicateKey && (sourceKeys.get(duplicateKey) ?? 0) > 1) return { sourceUserId: source.id, sourceUpn, sourceMail, status: matrix.sourceDuplicate === "block" ? "blocked" : "needs_review", matchMethod: "duplicate_source", confidence: 0, collisionCode: "SOURCE_DUPLICATE", explanation: `Source identity ${duplicateKey} is present on multiple source accounts.`, decision: matrix.sourceDuplicate };

    const exact = candidatesFor(normalize(sourceUpn), targetByUpn, targetByMail).concat(candidatesFor(normalize(sourceMail), targetByUpn, targetByMail)).filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
    const rewritten = sourceUpn ? applyDomainRewrite(sourceUpn, sourceDomain, targetDomain) : "";
    const rewriteCandidates = candidatesFor(rewritten, targetByUpn, targetByMail);
    const candidates = exact.length ? exact : rewriteCandidates;
    const method = exact.length ? "exact_match" : rewriteCandidates.length ? "domain_rewrite" : "none";
    const collisionCode = candidates.length > 1 ? "TARGET_DUPLICATE" : candidates.length === 0 ? "TARGET_NOT_FOUND" : undefined;
    if (!candidates.length) return { sourceUserId: source.id, sourceUpn, sourceMail, targetUpn: rewritten || undefined, status: matrix.noTarget === "block" ? "blocked" : "unmapped", matchMethod: method, confidence: 0, collisionCode, explanation: rewritten ? `Proposed domain rewrite ${sourceUpn} → ${rewritten}, but no unique target account was found.` : "No target account matched the source identity.", decision: matrix.noTarget };
    if (candidates.length > 1) return { sourceUserId: source.id, sourceUpn, sourceMail, targetUpn: rewritten || candidates[0].userPrincipalName, status: matrix.targetDuplicate === "block" ? "blocked" : "needs_review", matchMethod: method, confidence: 40, collisionCode, explanation: `Multiple target accounts match the ${method === "domain_rewrite" ? "rewritten identity" : "source identity"}; an operator must choose one.`, decision: matrix.targetDuplicate };
    const target = candidates[0];
    const disabled = target.accountEnabled === false;
    const action = disabled ? matrix.disabledTarget : (method === "exact_match" ? matrix.exactMatch : matrix.domainRewrite);
    const status: MappingStatus = action === "block" ? "blocked" : action === "review" ? "needs_review" : "proposed";
    return { sourceUserId: source.id, sourceUpn, sourceMail, targetUserId: target.id, targetUpn: target.userPrincipalName, targetMail: target.mail, status, matchMethod: method, confidence: disabled ? 0 : method === "exact_match" ? 100 : 92, collisionCode: disabled ? "TARGET_DISABLED" : undefined, explanation: disabled ? `Target ${target.userPrincipalName ?? target.id} is disabled.` : method === "exact_match" ? `Exact source-to-target identity match found for ${sourceUpn ?? sourceMail}.` : `Domain rewrite proposed: ${sourceUpn} → ${target.userPrincipalName}.`, decision: action };
  });
}

export async function createMappingPolicy(ownerOpenId: string, input: { sourceConnectionId: string; targetConnectionId: string; sourceDomain: string; targetDomain: string; collisionMatrix?: Partial<CollisionMatrix> }) {
  const db = await getDb();
  if (!db) throw new Error("A configured database is required for identity mapping.");
  const matrix = { ...defaultCollisionMatrix, ...input.collisionMatrix };
  const [sourceUsers, targetUsers] = await Promise.all([discoverGraphUsersForConnection(ownerOpenId, input.sourceConnectionId), discoverGraphUsersForConnection(ownerOpenId, input.targetConnectionId)]);
  const proposals = buildMappingProposals(sourceUsers, targetUsers, input.sourceDomain, input.targetDomain, matrix);
  const policyId = id("IMP");
  await db.insert(identityMappingPolicies).values({ id: policyId, ownerOpenId, sourceConnectionId: input.sourceConnectionId, targetConnectionId: input.targetConnectionId, sourceDomain: normalize(input.sourceDomain), targetDomain: normalize(input.targetDomain), collisionMatrix: JSON.stringify(matrix), status: proposals.some((item) => ["blocked", "needs_review", "unmapped"].includes(item.status)) ? "Proposed" : "Approved" });
  if (proposals.length) await db.insert(identityMappings).values(proposals.map((item) => ({ id: id("MAP"), policyId, ownerOpenId, ...item })));
  return { policyId, sourceCount: sourceUsers.length, targetCount: targetUsers.length, mappingCount: proposals.length, summary: summarize(proposals), sourceDomain: normalize(input.sourceDomain), targetDomain: normalize(input.targetDomain) };
}

function summarize(rows: MappingInput[]) { return rows.reduce<Record<string, number>>((result, row) => { result[row.status] = (result[row.status] ?? 0) + 1; return result; }, {}); }

export async function listMappingPolicies(ownerOpenId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(identityMappingPolicies).where(eq(identityMappingPolicies.ownerOpenId, ownerOpenId)).orderBy(desc(identityMappingPolicies.updatedAt));
}

export async function getLatestMappingReadiness(ownerOpenId: string) {
  const policies = await listMappingPolicies(ownerOpenId);
  const policy = policies[0];
  if (!policy) return { hasPolicy: false, policyId: undefined, total: 0, approved: 0, unresolved: 0 };
  const rows = await listMappings(ownerOpenId, policy.id);
  const unresolved = rows.filter((row) => ["needs_review", "unmapped", "blocked"].includes(row.status) || (row.status === "proposed" && row.decision !== "auto_map")).length;
  return { hasPolicy: true, policyId: policy.id, total: rows.length, approved: rows.length - unresolved, unresolved };
}

export async function listMappings(ownerOpenId: string, policyId: string, status?: string) {
  const db = await getDb();
  if (!db) return [];
  const filters = [eq(identityMappings.ownerOpenId, ownerOpenId), eq(identityMappings.policyId, policyId)];
  if (status && ["proposed", "approved", "rejected", "blocked", "needs_review", "unmapped"].includes(status)) filters.push(eq(identityMappings.status, status as MappingStatus));
  return db.select().from(identityMappings).where(and(...filters)).orderBy(desc(identityMappings.confidence));
}

export async function updateMappingDecision(ownerOpenId: string, mappingId: string, decision: "approve" | "reject" | "block") {
  const db = await getDb();
  if (!db) throw new Error("A configured database is required for identity mapping.");
  const existing = await db.select().from(identityMappings).where(and(eq(identityMappings.id, mappingId), eq(identityMappings.ownerOpenId, ownerOpenId))).limit(1);
  if (!existing[0]) throw new Error("Identity mapping was not found.");
  if (decision === "approve" && existing[0].readinessStatus !== "ready") throw new Error("Target account readiness must be verified as ready before approval.");
  const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "blocked";
  await db.update(identityMappings).set({ status, decision }).where(and(eq(identityMappings.id, mappingId), eq(identityMappings.ownerOpenId, ownerOpenId)));
  return { ok: true, status };
}

export async function validateMappingTargetReadiness(ownerOpenId: string, mappingId: string, workload = "oneDrive") {
  const db = await getDb();
  if (!db) throw new Error("A configured database is required for identity mapping.");
  const rows = await db.select().from(identityMappings).where(and(eq(identityMappings.id, mappingId), eq(identityMappings.ownerOpenId, ownerOpenId))).limit(1);
  const mapping = rows[0];
  if (!mapping) throw new Error("Identity mapping was not found.");
  const policyRows = await db.select().from(identityMappingPolicies).where(and(eq(identityMappingPolicies.id, mapping.policyId), eq(identityMappingPolicies.ownerOpenId, ownerOpenId))).limit(1);
  const policy = policyRows[0];
  if (!policy) throw new Error("Identity mapping policy was not found.");
  if (!mapping.targetUserId) {
    await db.update(identityMappings).set({ readinessStatus: "missing", readinessDetail: "No target user is associated with this mapping.", readinessCheckedAt: new Date() }).where(eq(identityMappings.id, mappingId));
    return { status: "missing" as const, detail: "No target user is associated with this mapping." };
  }
  await db.update(identityMappings).set({ readinessStatus: "checking", readinessCheckedAt: new Date() }).where(eq(identityMappings.id, mappingId));
  const result = await checkTargetAccountReadiness(ownerOpenId, policy.targetConnectionId, mapping.targetUserId, workload);
  await db.update(identityMappings).set({ readinessStatus: result.status, readinessDetail: result.detail, requiredLicense: result.requiredLicense, assignedLicenseCount: result.assignedLicenseCount, readinessCheckedAt: new Date() }).where(eq(identityMappings.id, mappingId));
  return result;
}

export async function provisionMappingTarget(ownerOpenId: string, mappingId: string, input: { temporaryPassword: string; usageLocation: string; workload?: string }) {
  const db = await getDb();
  if (!db) throw new Error("A configured database is required for identity mapping.");
  const rows = await db.select().from(identityMappings).where(and(eq(identityMappings.id, mappingId), eq(identityMappings.ownerOpenId, ownerOpenId))).limit(1);
  const mapping = rows[0];
  if (!mapping) throw new Error("Identity mapping was not found.");
  const policyRows = await db.select().from(identityMappingPolicies).where(and(eq(identityMappingPolicies.id, mapping.policyId), eq(identityMappingPolicies.ownerOpenId, ownerOpenId))).limit(1);
  const policy = policyRows[0];
  if (!policy) throw new Error("Identity mapping policy was not found.");
  if (mapping.targetUserId) throw new Error("This mapping already has a target account; verify readiness instead of provisioning another account.");
  const sourceIdentity = mapping.sourceUpn ?? mapping.sourceMail ?? undefined;
  const local = localPart(sourceIdentity);
  if (!local) throw new Error("A source UPN or mail is required to derive the target UPN.");
  const userPrincipalName = `${local}@${policy.targetDomain}`;
  await db.update(identityMappings).set({ provisioningStatus: "requested" }).where(eq(identityMappings.id, mappingId));
  try {
    const created = await provisionTargetUser(ownerOpenId, policy.targetConnectionId, { userPrincipalName, displayName: mapping.sourceUpn ?? mapping.sourceMail ?? local, mailNickname: local.replace(/[^a-z0-9._-]/gi, "").slice(0, 64) || `user-${mapping.sourceUserId.slice(0, 8)}`, usageLocation: input.usageLocation, temporaryPassword: input.temporaryPassword });
    await db.update(identityMappings).set({ targetUserId: created.id, targetUpn: created.userPrincipalName ?? userPrincipalName, provisioningStatus: "created", readinessStatus: "unknown", readinessDetail: "Target account created. Run readiness validation before approval." }).where(eq(identityMappings.id, mappingId));
    const readiness = await validateMappingTargetReadiness(ownerOpenId, mappingId, input.workload ?? "oneDrive");
    return { created, readiness };
  } catch (error) {
    await db.update(identityMappings).set({ provisioningStatus: "failed", readinessStatus: "blocked", readinessDetail: error instanceof Error ? error.message : "Target provisioning failed." }).where(eq(identityMappings.id, mappingId));
    throw error;
  }
}

export function mappingsCsv(rows: Array<Record<string, unknown>>) {
  const columns = ["sourceUpn", "targetUpn", "status", "matchMethod", "confidence", "collisionCode", "explanation"];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n") + "\n";
}
