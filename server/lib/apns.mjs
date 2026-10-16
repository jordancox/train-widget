// Apple Push Notification service, with Node's own http2 and crypto (no packages). Token auth: a JWT signed with
// the team's APNs key (a .p8 from developer.apple.com → Keys, kept in ~/.config/apple, never in the repo).
// TestFlight and App Store builds talk to production APNs, so that's the default.
//
//   start(token, aps)               push-to-start a Live Activity on one device (its push-to-start token)
//   broadcast(channel, aps, prio)   update or end every Live Activity subscribed to a channel (iOS 18+)
//   createChannel()                 a new broadcast channel; returns its id
//
// With no key configured it runs dry: it logs what it would send and answers as if Apple had said yes.
import http2 from 'node:http2';
import crypto from 'node:crypto';
import fs from 'node:fs';

export class APNs {
  constructor({ keyPath, keyId, teamId, bundleId, sandbox = false, log = console.log }) {
    this.bundleId = bundleId;
    this.log = log;
    this.dry = !(keyPath && keyId && teamId && fs.existsSync(keyPath));
    if (!this.dry) this.key = crypto.createPrivateKey(fs.readFileSync(keyPath));
    this.keyId = keyId;
    this.teamId = teamId;
    this.push = sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    this.manage = sandbox ? 'https://api-manage-broadcast.sandbox.push.apple.com:2195' : 'https://api-manage-broadcast.push.apple.com:2196';
    // Apple's broadcast page names api.push.apple.com in its text and api-broadcast.* in its example. Both answered
    // 200 on 16 Oct 2026; try the first and fall back to the second once if it refuses.
    this.broadcastHosts = sandbox
      ? ['https://api.sandbox.push.apple.com', 'https://api-broadcast.sandbox.push.apple.com']
      : ['https://api.push.apple.com', 'https://api-broadcast.push.apple.com'];
    this.sessions = new Map();
  }

  // Apple wants a fresh token at most every 20 minutes and refuses ones older than an hour.
  jwt() {
    if (this._jwt && Date.now() - this._jwtAt < 40 * 60e3) return this._jwt;
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'ES256', kid: this.keyId })}.${b64({ iss: this.teamId, iat: Math.floor(Date.now() / 1000) })}`;
    const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' });
    this._jwt = `${unsigned}.${sig.toString('base64url')}`;
    this._jwtAt = Date.now();
    return this._jwt;
  }

  session(origin) {
    let s = this.sessions.get(origin);
    if (s && !s.closed && !s.destroyed) return s;
    s = http2.connect(origin);
    s.on('error', () => this.sessions.delete(origin));
    s.on('goaway', () => this.sessions.delete(origin));
    s.on('close', () => this.sessions.delete(origin));
    s.setTimeout(10 * 60e3, () => s.close());
    this.sessions.set(origin, s);
    return s;
  }

  request(origin, method, path, headers = {}, body) {
    return new Promise((resolve, reject) => {
      const req = this.session(origin).request({
        ':method': method, ':path': path, authorization: `bearer ${this.jwt()}`, ...headers,
      });
      const chunks = [];
      let head = {};
      req.setTimeout(15000, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on('response', h => { head = h; });
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: head[':status'] ?? 0, headers: head, body: json ?? text });
      });
      req.on('error', reject);
      if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body));
      else req.end();
    });
  }

  async createChannel() {
    if (this.dry) { const id = 'dry-' + crypto.randomBytes(6).toString('hex'); this.log('apns (dry): new channel', id); return id; }
    const r = await this.request(this.manage, 'POST', `/1/apps/${this.bundleId}/channels`, { 'content-type': 'application/json' },
      { 'message-storage-policy': 1, 'push-type': 'LiveActivity' });
    if (r.status !== 201) throw new Error(`apns channel: ${r.status} ${JSON.stringify(r.body)}`);
    return r.headers['apns-channel-id'];
  }

  async start(token, aps) {
    const payload = { aps };
    if (this.dry) { this.log('apns (dry): start →', token.slice(0, 8), JSON.stringify(payload)); return { status: 200 }; }
    return this.request(this.push, 'POST', `/3/device/${token}`, {
      'apns-push-type': 'liveactivity',
      'apns-topic': `${this.bundleId}.push-type.liveactivity`,
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 600),
    }, payload);
  }

  async broadcast(channel, aps, priority = 10, ttl = 900) {
    const payload = { aps };
    if (this.dry) { this.log(`apns (dry): broadcast p${priority} →`, channel, JSON.stringify(payload)); return { status: 200 }; }
    let last;
    for (const host of this.broadcastHosts) {
      try {
        last = await this.request(host, 'POST', `/4/broadcasts/apps/${this.bundleId}`, {
          'apns-push-type': 'liveactivity',
          'apns-channel-id': channel,
          'apns-priority': String(priority),
          'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl),
        }, payload);
        if (last.status === 200) {
          if (this.broadcastHosts[0] !== host) this.broadcastHosts = [host];
          return last;
        }
      } catch (e) { last = { status: 0, body: String(e.message || e) }; }
    }
    return last;
  }

  close() { for (const s of this.sessions.values()) s.close(); }
}
