import { apiClient } from './client'

export interface PublicUser {
  id: string
  email: string
  displayName: string
  status: 'active' | 'suspended'
  emailVerifiedAt: string | null
  createdAt: string | null
}

interface UserResponse {
  user: PublicUser
}

export interface LoginResponse extends UserResponse {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export async function registerAccount(input: {
  email: string
  password: string
  displayName?: string
}): Promise<UserResponse> {
  const response = await apiClient.post<UserResponse>('/auth/register', input)
  return response.data
}

export async function loginAccount(input: {
  email: string
  password: string
}): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/login', input)
  return response.data
}

export async function getCurrentUser(): Promise<UserResponse> {
  const response = await apiClient.get<UserResponse>('/auth/me')
  return response.data
}