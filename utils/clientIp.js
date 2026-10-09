'use strict';

// The real visitor IP behind Cloudflare → Render.
//
// With `app.set('trust proxy', 1)`, req.ip is the address that connected to
// Render. Behind Cloudflare that is a Cloudflare edge, so every visitor routed
// through the same edge shared one rate-limit bucket. Cloudflare sends the
// visitor's address in CF-Connecting-IP, but makaug.onrender.com is directly
// reachable too, so the header is trusted ONLY when the hop that reached
// Render is a Cloudflare address.
//
// Cloudflare's published ranges, embedded so there is no network call at boot.
// To refresh: https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
// (or https://api.cloudflare.com/client/v4/ips). Last copied 8 Oct 2026.

const net = require('net');

const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
];
const CLOUDFLARE_IPV6_RANGES = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
];

const cloudflareBlockList = new net.BlockList();
for (const range of CLOUDFLARE_IPV4_RANGES) {
  const [address, prefix] = range.split('/');
  cloudflareBlockList.addSubnet(address, Number(prefix), 'ipv4');
}
for (const range of CLOUDFLARE_IPV6_RANGES) {
  const [address, prefix] = range.split('/');
  cloudflareBlockList.addSubnet(address, Number(prefix), 'ipv6');
}

function normalizeIp(value = '') {
  let ip = String(value || '').trim();
  if (!ip) return '';
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];
  return net.isIP(ip) ? ip : '';
}

function isCloudflareIp(value = '') {
  const ip = normalizeIp(value);
  if (!ip) return false;
  return cloudflareBlockList.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

// hopIp: the address that reached Render (req.ip under trust proxy 1).
function clientIpFrom({ hopIp = '', cfConnectingIp = '' } = {}) {
  const hop = normalizeIp(hopIp);
  const candidate = normalizeIp(String(cfConnectingIp || '').split(',')[0]);
  if (hop && candidate && isCloudflareIp(hop)) return candidate;
  return hop || '';
}

function clientIpForRequest(req = {}) {
  if (req.clientIp) return req.clientIp;
  const header = typeof req.get === 'function' ? req.get('cf-connecting-ip') : req.headers?.['cf-connecting-ip'];
  return clientIpFrom({ hopIp: req.ip || req.socket?.remoteAddress || '', cfConnectingIp: header || '' });
}

function clientIpMiddleware(req, _res, next) {
  req.clientIp = clientIpForRequest(req) || null;
  next();
}

// IPv6 visitors usually hold a whole /64, so one bucket per /64 (otherwise a
// client can rotate addresses inside its own prefix to dodge the limit).
function ipv6Slash64(ip = '') {
  const [head, tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = ip.includes('::') ? 8 - headParts.length - tailParts.length : 0;
  const parts = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  return `${parts.slice(0, 4).map((part) => (part || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// express-rate-limit keyGenerator
function rateLimitClientKey(req) {
  const ip = normalizeIp(req.clientIp || clientIpForRequest(req) || req.ip || '');
  if (!ip) return 'unknown';
  return net.isIPv6(ip) ? ipv6Slash64(ip) : ip;
}

module.exports = {
  CLOUDFLARE_IPV4_RANGES,
  CLOUDFLARE_IPV6_RANGES,
  isCloudflareIp,
  clientIpFrom,
  clientIpForRequest,
  clientIpMiddleware,
  rateLimitClientKey,
  normalizeIp
};
