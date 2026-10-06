import { apiClient } from './client'

export interface HealthResponse {
  status: 'ok'
  timestamp: string
  requestId: string
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await apiClient.get<HealthResponse>('/health')
  return response.data
}