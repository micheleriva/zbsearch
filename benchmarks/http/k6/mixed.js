// Mixed load test: ~95% searches / ~5% batch writes on a shared arrival-rate
// ramp, approximating production traffic.
//
// Env:
//   BASE_URL (required), API_KEY, INDEX_ID (default "loadtest")
//   ABORT_ON_THRESHOLD=true  abort the run when the p(99) threshold fails

import http from 'k6/http'
import { check } from 'k6'
import { Trend } from 'k6/metrics'

import { batchUrl, headers, randomBatch, randomSearchBody, searchUrl } from './lib.js'

const searchLatency = new Trend('search_latency', true)
const writeLatency = new Trend('write_batch_latency', true)

export const options = {
  scenarios: {
    mixed: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: 50, duration: '1m' },
        { target: 200, duration: '1m' },
        { target: 200, duration: '2m' },
        { target: 500, duration: '1m' },
        { target: 500, duration: '2m' },
        { target: 0, duration: '1m' }
      ]
    }
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: false }],
    search_latency: [
      {
        threshold: 'p(99)<500',
        abortOnFail: __ENV.ABORT_ON_THRESHOLD === 'true',
        delayAbortEval: '30s'
      }
    ]
  }
}

export default function () {
  if (Math.random() < 0.05) {
    const res = http.post(batchUrl, randomBatch(100, 'mixed'), { headers: headers() })
    writeLatency.add(res.timings.duration)
    check(res, { 'write status is 202': (r) => r.status === 202 })
    return
  }

  const res = http.post(searchUrl, randomSearchBody(), { headers: headers() })
  searchLatency.add(res.timings.duration)
  check(res, { 'search status is 200': (r) => r.status === 200 })
}
