export type WorkItemStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING_APPROVAL' | 'APPROVED' | 'RESOLVED' | 'CLOSED';
export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TeamRole = 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  memberCount?: number;
  userRole?: TeamRole;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  name?: string;
  email?: string;
  user?: User;
}

export interface WorkItem {
  id: string;
  title: string;
  description?: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  team_id: string;
  team_name?: string;
  creator_id: string;
  creator_name?: string;
  assignee_id?: string;
  assignee_name?: string;
  version: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  work_item_id: string;
  user_id: string;
  user_name?: string;
  action: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  comment?: string;
  created_at: string;
}

export interface Comment {
  id: string;
  work_item_id: string;
  user_id: string;
  user_name?: string;
  content: string;
  edited_at?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  work_item_id?: string;
  type: string;
  message: string;
  read: number;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface WorkItemFilters {
  team_id?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  assignee_id?: string;
  search?: string;
  sort_by?: 'created_at' | 'updated_at' | 'priority' | 'status' | 'title';
  sort_order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}
