import { apiClient } from './client';
import { Notification, PaginatedResponse } from '../types';

export async function getNotifications(
  page = 1,
  limit = 10
): Promise<PaginatedResponse<Notification>> {
  return apiClient.get<PaginatedResponse<Notification>>('/notifications', { page, limit });
}

export async function markRead(id: string): Promise<void> {
  return apiClient.put<void>(`/notifications/${id}/read`);
}

export async function markAllRead(): Promise<void> {
  return apiClient.put<void>('/notifications/read-all');
}
