import type { PlanConfig, PlanRecord, PlanSummary, ScheduleResult } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === 'string' ? body.detail : formatValidation(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

function formatValidation(detail: unknown): string {
  if (!Array.isArray(detail)) return JSON.stringify(detail);
  return detail.map((d) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`).join('; ');
}

export const api = {
  listPlans: () => request<PlanSummary[]>('/plans'),
  getPlan: (id: string) => request<PlanRecord>(`/plans/${id}`),
  createPlan: (config?: PlanConfig) =>
    request<PlanRecord>('/plans', { method: 'POST', body: config ? JSON.stringify(config) : undefined }),
  updatePlan: (id: string, config: PlanConfig) =>
    request<PlanRecord>(`/plans/${id}`, { method: 'PUT', body: JSON.stringify(config) }),
  deletePlan: (id: string) => request<void>(`/plans/${id}`, { method: 'DELETE' }),
  defaults: () => request<PlanConfig>('/defaults'),
  schedule: (config: PlanConfig) =>
    request<ScheduleResult>('/schedule', { method: 'POST', body: JSON.stringify(config) }),
};
