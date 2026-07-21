// Cold-start probe: one search every 5 seconds. Run right after a fresh deploy
// or an idle period; the first iterations show cold latency, the rest warm.
//
// Env:
//   BASE_URL (required), API_KEY, INDEX_ID (default "loadtest")
//   COLD_DURATION  k6 duration string (default "5m")

import http from 'k6/http'
import { Trend } from 'k6/metrics'

import { headers, randomSearchBody, searchUrl } from './lib.js'

const probeLatency = new Trend('probe_latency', true)

export const options = {
  scenarios: {
    coldstart: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '5s',
      duration: __ENV.COLD_DURATION || '5m',
      preAllocatedVUs: 1,
      maxVUs: 2
    }
  }
}

export default function () {
  const res = http.post(searchUrl, randomSearchBody(), { headers: headers() })
  probeLatency.add(res.timings.duration)
  console.log(`iter=${__ITER} status=${res.status} latency=${res.timings.duration.toFixed(1)}ms`)
}
