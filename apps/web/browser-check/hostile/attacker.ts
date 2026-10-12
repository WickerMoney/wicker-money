import { createServer as createHttp, type IncomingHttpHeaders, type Server } from 'node:http'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import type { AddressInfo, Socket } from 'node:net'

/**
 * A server the hostile plugin would like to talk to.
 *
 * It lives on another origin from the app (`attacker.test`, mapped to loopback by the browser's
 * `--host-resolver-rules`), records everything that reaches it, and answers every request with
 * permissive CORS headers so that a block can only be the browser's or the app's doing, never the
 * attacker's. Three listeners, because data can leave by more than HTTP:
 *
 *  - HTTP requests, with their headers and body;
 *  - bare TCP connections that never send a request (what `preconnect` opens);
 *  - UDP datagrams (what a WebRTC STUN binding request is).
 */

export interface Hit {
  /** The attack id from the `hx` query parameter, or `null` when the request did not carry one. */
  readonly id: string | null
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
  readonly body: string
  readonly at: number
}

export interface Connection {
  readonly at: number
  requests: number
}

export class Attacker {
  private constructor(
    readonly hits: Hit[],
    readonly connections: Connection[],
    readonly datagrams: Array<{ at: number; bytes: number; port: number; payload: string }>,
    private readonly http: Server,
    private readonly udp: UdpSocket,
    readonly port: number,
    readonly udpPort: number,
  ) {}

  /** The attacker's origin as the browser names it. */
  get origin(): string { return `http://attacker.test:${this.port}` }

  static async start(pages: Map<string, string> = new Map()): Promise<Attacker> {
    const hits: Hit[] = []
    const connections: Connection[] = []
    const datagrams: Array<{ at: number; bytes: number; port: number; payload: string }> = []
    const http = createHttp((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => { chunks.push(c) })
      req.on('end', () => {
        const url = req.url ?? '/'
        const hx = new URL(url, 'http://x').searchParams.get('hx')
        hits.push({ id: hx, method: req.method ?? 'GET', url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8').slice(0, 2000), at: Date.now() })
        const sock = req.socket as Socket & { __conn?: Connection }
        if (sock.__conn !== undefined) sock.__conn.requests += 1
        const page = pages.get(new URL(url, 'http://x').pathname)
        res.writeHead(200, {
          'content-type': page === undefined ? 'text/plain' : 'text/html',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
          'timing-allow-origin': '*',
        })
        res.end(page ?? 'ok')
      })
    })
    http.on('connection', (sock: Socket & { __conn?: Connection }) => {
      const conn = { at: Date.now(), requests: 0 }
      sock.__conn = conn
      connections.push(conn)
    })
    await new Promise<void>((resolve) => { http.listen(0, '127.0.0.1', resolve) })
    const udp = createSocket('udp4')
    udp.on('message', (msg, rinfo) => {
      datagrams.push({ at: Date.now(), bytes: msg.length, port: rinfo.port, payload: msg.toString('latin1').slice(0, 800) })
      const challenge = turnChallenge(msg)
      if (challenge !== null) udp.send(challenge, rinfo.port, rinfo.address)
    })
    await new Promise<void>((resolve) => { udp.bind(0, '127.0.0.1', resolve) })
    return new Attacker(hits, connections, datagrams, http, udp, (http.address() as AddressInfo).port, udp.address().port)
  }

  hitsFor(id: string): Hit[] { return this.hits.filter((h) => h.id === id) }

  async close(): Promise<void> {
    this.udp.close()
    await new Promise<void>((resolve) => { this.http.close(() => { resolve() }); this.http.closeAllConnections() })
  }
}

const stunAttr = (type: number, value: Buffer): Buffer => {
  const head = Buffer.alloc(4)
  head.writeUInt16BE(type, 0)
  head.writeUInt16BE(value.length, 2)
  return Buffer.concat([head, value, Buffer.alloc((4 - (value.length % 4)) % 4)])
}

/**
 * What a TURN server does with a first `Allocate` request: answer 401 with a realm and a nonce, which makes the browser
 * send the request again with its USERNAME, and the username is a string the page chose. Returns `null` for anything else.
 */
function turnChallenge(msg: Buffer): Buffer | null {
  if (msg.length < 20 || msg.readUInt16BE(0) !== 0x0003) return null
  for (let i = 20; i + 4 <= msg.length;) {
    if (msg.readUInt16BE(i) === 0x0008) return null // already carries MESSAGE-INTEGRITY: the authenticated retry
    i += 4 + msg.readUInt16BE(i + 2) + ((4 - (msg.readUInt16BE(i + 2) % 4)) % 4)
  }
  const body = Buffer.concat([
    stunAttr(0x0009, Buffer.concat([Buffer.from([0, 0, 4, 1]), Buffer.from('Unauthorized')])),
    stunAttr(0x0014, Buffer.from('attacker.test')), stunAttr(0x0015, Buffer.from('0123456789abcdef')),
  ])
  const head = Buffer.alloc(20)
  head.writeUInt16BE(0x0113, 0)
  head.writeUInt16BE(body.length, 2)
  msg.copy(head, 4, 4, 20)
  return Buffer.concat([head, body])
}
