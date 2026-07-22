import http from 'k6/http'
import { check } from 'k6'
import { Trend } from 'k6/metrics'

import { headers, randomSearchBody, searchUrl } from './lib.js'

const searchLatency = new Trend('search_latency', true)

export const options = {
  scenarios: {
    search: {
      executor: 'ramping-arrival-rate',
      startRate: 25,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { target: 25, duration: '30s' },
        { target: 100, duration: '1m' },
        { target: 100, duration: '2m' },
        { target: 0, duration: '30s' }
      ]
    }
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: false }]
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
