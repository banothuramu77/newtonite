import { apiClient } from './client';
import {
  WorkItem,
  ActivityLog,
  Comment,
  PaginatedResponse,
  WorkItemFilters,
  WorkItemStatus,
  WorkItemPriority,
} from '../types';

export interface WorkItemDetailResponse {
  workItem: WorkItem;
  activityLog: ActivityLog[];
  comments: Comment[];
}

export interface CreateWorkItemData {
  title: string;
  description?: string;
  team_id: string;
  priority: WorkItemPriority;
  status?: WorkItemStatus;
  assignee_id?: string;
  tags?: string[];
}

export interface UpdateWorkItemData {
  title?: string;
  description?: string | null;
  priority?: WorkItemPriority;
  assignee_id?: string | null;
  tags?: string[];
  version: number;
}

export interface AssignWorkItemData {
  assignee_id: string | null;
  version: number;
}

export async function getWorkItems(
  filters: WorkItemFilters
): Promise<PaginatedResponse<WorkItem>> {
  const params: Record<string, unknown> = { ...filters };
  const response = await apiClient.get<PaginatedResponse<WorkItem>>('/work-items', params);
  return { ...response, items: response.items.map(normalizeWorkItem) };
}

export async function getWorkItem(id: string): Promise<WorkItemDetailResponse> {
  const response = await apiClient.get<WorkItemDetailResponse>(`/work-items/${id}`);
  response.workItem = normalizeWorkItem(response.workItem);
  return response;
}

export async function createWorkItem(data: CreateWorkItemData, idempotencyKey?: string): Promise<WorkItem> {
  const response = await apiClient.post<{ workItem: WorkItem }>('/work-items', data, idempotencyKey);
  return normalizeWorkItem(response.workItem);
}

export async function updateWorkItem(
  id: string,
  data: UpdateWorkItemData
): Promise<WorkItem> {
  const response = await apiClient.put<{ workItem: WorkItem }>(`/work-items/${id}`, data);
  return normalizeWorkItem(response.workItem);
}

export async function assignWorkItem(
  id: string,
  data: AssignWorkItemData
): Promise<WorkItem> {
  const response = await apiClient.post<{ workItem: WorkItem }>(`/work-items/${id}/assign`, data);
  return normalizeWorkItem(response.workItem);
}

export async function changeStatus(
  id: string,
  status: WorkItemStatus,
  version: number
): Promise<WorkItem> {
  const response = await apiClient.put<{ workItem: WorkItem }>(`/work-items/${id}/status`, {
    status,
    version,
  });
  return normalizeWorkItem(response.workItem);
}

export async function addComment(id: string, content: string, idempotencyKey?: string): Promise<Comment> {
  const response = await apiClient.post<{ comment: Comment }>(`/work-items/${id}/comments`, {
    content,
  }, idempotencyKey);
  return response.comment;
}

export async function deleteComment(
  workItemId: string,
  commentId: string
): Promise<void> {
  return apiClient.delete<void>(`/work-items/${workItemId}/comments/${commentId}`);
}

export async function searchWorkItems(
  query: string,
  params?: Omit<WorkItemFilters, 'search'>
): Promise<PaginatedResponse<WorkItem>> {
  const response = await apiClient.get<PaginatedResponse<WorkItem>>('/search', { q: query, ...params });
  return { ...response, items: response.items.map(normalizeWorkItem) };
}

function normalizeWorkItem(item: WorkItem): WorkItem {
  if (Array.isArray(item.tags)) return item;
  try {
    const tags: unknown = JSON.parse(String(item.tags));
    return {
      ...item,
      tags: Array.isArray(tags) && tags.every((tag) => typeof tag === 'string') ? tags : [],
    };
  } catch {
    return { ...item, tags: [] };
  }
}
