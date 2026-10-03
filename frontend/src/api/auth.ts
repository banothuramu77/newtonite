import { apiClient } from './client';
import { User } from '../types';

export interface LoginResponse {
  user: User;
  token: string;
}

export interface RegisterResponse {
  user: User;
  token: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiClient.post<LoginResponse>('/auth/login', { email, password });
}

export async function register(
  email: string,
  name: string,
  password: string
): Promise<RegisterResponse> {
  return apiClient.post<RegisterResponse>('/auth/register', { email, name, password });
}

export async function getMe(): Promise<User> {
  const response = await apiClient.get<{ user: User }>('/auth/me');
  return response.user;
}

export async function updateProfile(name: string): Promise<User> {
  const response = await apiClient.put<{ user: User }>('/auth/me', { name });
  return response.user;
}
