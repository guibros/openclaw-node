/**
 * web-fetch-guard.test.mjs — REMEDIATION_PLAN P5-7.
 *
 * workspace-bin/web-fetch.mjs runs with the node's network position; an
 * agent-supplied URL used to reach loopback services, the cloud metadata
 * endpoint and file:// paths. The guard is pure and DNS is injected here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, assertPublicUrl } from '../workspace-bin/web-fetch.mjs';

describe('isPrivateIp', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1']) {
    it(`${ip} is private/reserved`, () => assert.equal(isPrivateIp(ip), true));
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    it(`${ip} is public`, () => assert.equal(isPrivateIp(ip), false));
  }
  it('a non-IP is treated as unsafe', () => assert.equal(isPrivateIp('not-an-ip'), true));
});

describe('assertPublicUrl', () => {
  const resolving = (map) => async (h) => { if (!(h in map)) throw new Error('ENOTFOUND'); return map[h].map(address => ({ address })); };

  it('refuses non-http schemes', async () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://x', 'javascript:alert(1)']) {
      await assert.rejects(assertPublicUrl(u), /refused|invalid/);
    }
  });

  it('refuses literal private and metadata addresses', async () => {
    await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data/'), /private\/reserved/);
    await assert.rejects(assertPublicUrl('http://127.0.0.1:7893/memory/inject'), /private\/reserved/);
    await assert.rejects(assertPublicUrl('http://[::1]:8222/varz'), /private\/reserved/);
    await assert.rejects(assertPublicUrl('http://localhost:3000/'), /local\/internal/);
    await assert.rejects(assertPublicUrl('http://metadata.google.internal/'), /local\/internal/);
  });

  it('refuses a public-looking name that resolves to a private address', async () => {
    const lookup = resolving({ 'evil.example': ['93.184.216.34', '127.0.0.1'] });
    await assert.rejects(assertPublicUrl('https://evil.example/', { lookup }), /resolves to private/);
  });

  it('refuses credentials in the URL and unresolvable hosts', async () => {
    await assert.rejects(assertPublicUrl('http://user:pw@example.com/'), /credentials/);
    await assert.rejects(assertPublicUrl('http://nope.example/', { lookup: resolving({}) }), /cannot resolve/);
  });

  it('allows a public host', async () => {
    const lookup = resolving({ 'example.com': ['93.184.216.34'] });
    const u = await assertPublicUrl('https://example.com/page?x=1', { lookup });
    assert.equal(u.hostname, 'example.com');
  });
});

describe('mcp-knowledge HTTP Host/Origin gate (P5-7)', async () => {
  let checkHttpOrigin;
  try { ({ checkHttpOrigin } = await import('../lib/mcp-knowledge/server.mjs')); } catch { checkHttpOrigin = null; }
  const self = { host: '127.0.0.1', port: 7895 };

  it('accepts its own host with no Origin (curl / MCP clients)', (t) => {
    if (!checkHttpOrigin) return t.skip('mcp sdk not installed');
    assert.equal(checkHttpOrigin({ host: '127.0.0.1:7895' }, self).ok, true);
    assert.equal(checkHttpOrigin({ host: 'localhost:7895' }, self).ok, true);
  });

  it('refuses a foreign Host (DNS rebinding) and a foreign Origin (cross-site POST)', (t) => {
    if (!checkHttpOrigin) return t.skip('mcp sdk not installed');
    assert.equal(checkHttpOrigin({ host: 'attacker.example:7895' }, self).ok, false);
    assert.equal(checkHttpOrigin({ host: '127.0.0.1:7895', origin: 'http://evil.example' }, self).ok, false);
    assert.equal(checkHttpOrigin({ host: '127.0.0.1:7895', origin: 'http://127.0.0.1:3000' }, self).ok, false);
    assert.equal(checkHttpOrigin({ host: '127.0.0.1:7895', origin: 'http://localhost:7895' }, self).ok, true);
  });
});
