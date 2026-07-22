// Write load test: constant-rate batch upserts on
// POST /v1/indexes/:id/documents/batch, tracking pendingOps drift via the
// status endpoint.
//
// Env:
//   BASE_URL (required), API_KEY, INDEX_ID (default "loadtest")
//   WRITE_RATE      batches per second (default 5)
//   WRITE_DURATION  k6 duration string (default "2m")
//   BATCH_SIZE      ops per batch (default 100)

import http from 'k6/http'
import { check } from 'k6'
import { Gauge, Trend } from 'k6/metrics'

import { batchUrl, headers, randomBatch, statusUrl } from './lib.js'

const writeLatency = new Trend('write_batch_latency', true)
const pendingOps = new Gauge('status_pending_ops')

const BATCH_SIZE = Number(__ENV.BATCH_SIZE || 100)

export const options = {
  scenarios: {
    write: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.WRITE_RATE || 5),
      timeUnit: '1s',
      duration: __ENV.WRITE_DURATION || '2m',
      preAllocatedVUs: 10,
      maxVUs: 100
    }
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: false }]
  }
}

export default function () {
  const res = http.post(batchUrl, randomBatch(BATCH_SIZE, 'write'), { headers: headers() })
  writeLatency.add(res.timings.duration)
  check(res, { 'status is 202': (r) => r.status === 202 })

  // Sample the status endpoint every 10th iteration to watch the write buffer
  // grow (and drain, if rebuilds are triggered) over the run.
  if (__ITER % 10 === 0) {
    const status = http.get(statusUrl, { headers: headers() })
    if (status.status === 200) {
      pendingOps.add(status.json('pendingOps'))
    }
  }
}
