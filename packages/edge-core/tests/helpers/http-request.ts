import type { HttpRequest } from '../../src/router.js'

export function makeRequest(
  method: string,
  pathname: string,
  options?: {
    body?: unknown
    headers?: Record<string, string>
    search?: Record<string, string>
  }
): HttpRequest {
  const searchParams = new URLSearchParams(options?.search)
  const headers = new Headers(options?.headers)

  return {
    method,
    pathname,
    searchParams,
    headers,
    json: async <T>() => (options?.body ?? {}) as T
  }
}
