import { apiClient } from './client';
import { Team, TeamMember, TeamRole } from '../types';

export interface TeamDetailResponse {
  team: Team;
  members: TeamMember[];
}

export async function getTeams(): Promise<Team[]> {
  const response = await apiClient.get<{ teams: Team[] }>('/teams');
  return response.teams;
}

export async function getTeam(id: string): Promise<TeamDetailResponse> {
  return apiClient.get<TeamDetailResponse>(`/teams/${id}`);
}

export async function createTeam(name: string, description?: string): Promise<Team> {
  const response = await apiClient.post<{ team: Team }>('/teams', { name, description });
  return response.team;
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole
): Promise<TeamMember> {
  const response = await apiClient.post<{ member: TeamMember }>(`/teams/${teamId}/members`, {
    userId,
    role,
  });
  return response.member;
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  return apiClient.delete<void>(`/teams/${teamId}/members/${userId}`);
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole
): Promise<TeamMember> {
  const response = await apiClient.put<{ member: TeamMember }>(`/teams/${teamId}/members/${userId}`, {
    role,
  });
  return response.member;
}
