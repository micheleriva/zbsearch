import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { EdgeApiError, badRequest, conflict, notFound, unauthorized } from '../src/errors.js'

describe('errors', () => {
  it('EdgeApiError exposes status and code', () => {
    const err = new EdgeApiError(418, 'TEAPOT', 'short and stout')
    assert.equal(err.status, 418)
    assert.equal(err.code, 'TEAPOT')
    assert.equal(err.message, 'short and stout')
    assert.equal(err.name, 'EdgeApiError')
  })

  it('toBody returns API error shape', () => {
    const body = badRequest('invalid').toBody()
    assert.deepEqual(body, {
      error: { code: 'BAD_REQUEST', message: 'invalid' }
    })
  })

  it('notFound uses 404', () => {
    const err = notFound('missing')
    assert.equal(err.status, 404)
    assert.equal(err.code, 'NOT_FOUND')
  })

  it('badRequest uses 400', () => {
    assert.equal(badRequest('nope').status, 400)
  })

  it('unauthorized uses 401', () => {
    assert.equal(unauthorized().status, 401)
    assert.equal(unauthorized('denied').message, 'denied')
  })

  it('conflict uses 409', () => {
    assert.equal(conflict('exists').code, 'CONFLICT')
  })
})
