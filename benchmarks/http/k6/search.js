// Read-heavy load test: ramping arrival rate on POST /v1/indexes/:id/search.
//
// Env:
//   BASE_URL (required), API_KEY, INDEX_ID (default "loadtest")
//   ABORT_ON_THRESHOLD=true  abort the run when the p(99) threshold fails
//   WARMUP=true              short 30s low-rate run used by run.sh to warm the worker

import http from 'k6/http'
import { check } from 'k6'
import { Trend } from 'k6/metrics'

import { headers, randomSearchBody, searchUrl } from './lib.js'

const searchLatency = new Trend('search_latency', true)

const WARMUP = __ENV.WARMUP === 'true'

const stages = WARMUP
  ? [{ target: 20, duration: '30s' }]
  : [
      { target: 50, duration: '1m' },
      { target: 200, duration: '1m' },
      { target: 200, duration: '2m' },
      { target: 500, duration: '1m' },
      { target: 500, duration: '2m' },
      { target: 1000, duration: '1m' },
      { target: 1000, duration: '2m' },
      { target: 0, duration: '1m' }
    ]

export const options = {
  scenarios: {
    search: {
      executor: 'ramping-arrival-rate',
      startRate: WARMUP ? 20 : 50,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages
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
  const res = http.post(searchUrl, randomSearchBody(), { headers: headers() })
  searchLatency.add(res.timings.duration)
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has hits array': (r) => {
      try {
        return Array.isArray(r.json('hits'))
      } catch {
        return false
      }
    }
  })
}
