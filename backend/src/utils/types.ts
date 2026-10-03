import { Request } from 'express';

export type WorkItemStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'RESOLVED'
  | 'CLOSED';

export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type TeamRole = 'ADMIN' | 'MEMBER' | 'VIEWER';

// Role hierarchy: higher index = more permissions
export const ROLE_HIERARCHY: TeamRole[] = ['VIEWER', 'MEMBER', 'ADMIN'];

export function hasMinimumRole(userRole: TeamRole, requiredRole: TeamRole): boolean {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(requiredRole);
}

// Status transition rules: maps current status -> allowed next statuses
export const STATUS_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['PENDING_APPROVAL', 'OPEN', 'RESOLVED'],
  PENDING_APPROVAL: ['APPROVED', 'IN_PROGRESS'],
  APPROVED: ['RESOLVED', 'IN_PROGRESS'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: ['OPEN'],
};

// Transitions that require ADMIN role
export const ADMIN_ONLY_TRANSITIONS: Partial<Record<WorkItemStatus, WorkItemStatus[]>> = {
  PENDING_APPROVAL: ['APPROVED'],
};

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
}

export interface WorkItem {
  id: string;
  title: string;
  description: string | null;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  team_id: string;
  creator_id: string;
  assignee_id: string | null;
  version: number;
  tags: string; // JSON string in DB
  metadata: string; // JSON string in DB
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  work_item_id: string;
  user_id: string;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  work_item_id: string;
  user_id: string;
  content: string;
  edited_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  work_item_id: string | null;
  type: string;
  message: string;
  read: number;
  created_at: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  idempotencyKey?: string;
}
