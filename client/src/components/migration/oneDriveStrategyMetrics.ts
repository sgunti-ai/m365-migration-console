export type StrategyJobProgress = {
  progress?: number | null;
  itemsDone?: number | null;
  itemsTotal?: number | null;
  status: string;
};

export function completionPercent(job: StrategyJobProgress) {
  const value = Number(job.progress ?? 0);
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

export function overallCompletion(jobs: StrategyJobProgress[]) {
  const ongoing = jobs.filter((job) => !["Completed", "Cancelled"].includes(job.status));
  if (!ongoing.length) return 0;
  const totalItems = ongoing.reduce((sum, job) => sum + (Number(job.itemsTotal) || 0), 0);
  const doneItems = ongoing.reduce((sum, job) => sum + (Number(job.itemsDone) || 0), 0);
  return totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : Math.round(ongoing.reduce((sum, job) => sum + completionPercent(job), 0) / ongoing.length);
}
