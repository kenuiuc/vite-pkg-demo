import { apiBase } from '../config/runtime'

export interface InfoResponse {
  env: string
  title: string
  message: string
  port: number
  servedAt: string
}

export async function fetchInfo(): Promise<InfoResponse> {
  const response = await fetch(`${apiBase}/info`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json() as Promise<InfoResponse>
}
