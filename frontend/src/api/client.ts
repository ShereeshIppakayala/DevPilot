import axios from 'axios'

let accessToken: string | null = null

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  timeout: 8000,
  headers: { Accept: 'application/json' },
})

export function setAccessToken(token: string) {
  accessToken = token
  window.dispatchEvent(new Event('devpilot:auth-changed'))
}

export function clearAccessToken() {
  accessToken = null
  window.dispatchEvent(new Event('devpilot:auth-changed'))
}

export function hasAccessToken() {
  return accessToken !== null
}

apiClient.interceptors.request.use((request) => {
  if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`)
  return request
})