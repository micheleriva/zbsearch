import type { ApiErrorBody } from './types.js'

export class EdgeApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'EdgeApiError'
    this.status = status
    this.code = code
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message
      }
    }
  }
}

export function notFound(message: string): EdgeApiError {
  return new EdgeApiError(404, 'NOT_FOUND', message)
}

export function badRequest(message: string): EdgeApiError {
  return new EdgeApiError(400, 'BAD_REQUEST', message)
}

export function unauthorized(message = 'Unauthorized'): EdgeApiError {
  return new EdgeApiError(401, 'UNAUTHORIZED', message)
}

export function conflict(message: string): EdgeApiError {
  return new EdgeApiError(409, 'CONFLICT', message)
}
