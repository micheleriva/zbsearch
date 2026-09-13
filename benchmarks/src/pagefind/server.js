import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.pagefind': 'application/octet-stream',
  '.pf_meta': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
  '.wasm': 'application/wasm'
}

/**
 * Static file server with per-request byte accounting. Responses are gzipped
 * when that shrinks them (a CDN's behavior); Pagefind's artifacts arrive
 * pre-compressed and pass through unchanged. `tally` counts bytes actually
 * sent on the wire.
 */
export function startServer(wwwDir) {
  const tally = { bytes: 0, requests: 0 }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')

    if (url.pathname === '/__reset') {
      tally.bytes = 0
      tally.requests = 0
      res.end('ok')
      return
    }
    if (url.pathname === '/__stats') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(tally))
      return
    }

    try {
      const filePath = path.join(wwwDir, decodeURIComponent(url.pathname))
      let body = await readFile(filePath)
      res.setHeader('content-type', TYPES[path.extname(filePath)] ?? 'application/octet-stream')
      res.setHeader('cache-control', 'no-store')

      if ((req.headers['accept-encoding'] ?? '').includes('gzip')) {
        const gz = gzipSync(body)
        if (gz.length < body.length) {
          res.setHeader('content-encoding', 'gzip')
          body = gz
        }
      }

      tally.bytes += body.length
      tally.requests += 1
      res.end(body)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        tally,
        close: () => new Promise((done) => server.close(done))
      })
    })
  })
}
