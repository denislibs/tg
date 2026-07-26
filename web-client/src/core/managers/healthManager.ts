import type { RestClient } from '../net/restClient'

export interface HealthStatus { status: string }

// Proves the UI -> worker -> REST -> backend pipeline.
export function newHealthManager(rest: RestClient) {
  return {
    async check(): Promise<HealthStatus> {
      return rest.get<HealthStatus>('/health')
    },
  }
}
