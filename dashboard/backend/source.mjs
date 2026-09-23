import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const DEFAULT_SOURCE = 'https://2026kj.zkclhb.com:2026/hk.html'
// This source accepts normal browser navigation headers but rejects the former
// bare LotteryAnalysis request with HTTP 403. No cookies or login are required.
const SOURCE_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'identity',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
})
export function publicAddress(address) {
  if (isIP(address) !== 4) return false // Fail closed for IPv6 and mapped IPv4.
  const [a,b] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)))
}
export function validateSource(value) {
  const url = new URL(value)
  const allowed = (process.env.SOURCE_ALLOWED_HOSTS || '2026kj.zkclhb.com').split(',').map(x => x.trim())
  if (url.protocol !== 'https:' || url.username || url.password || !allowed.includes(url.hostname)) throw new Error('来源必须是配置中允许的 HTTPS 域名')
  return url
}
export async function fetchSource(value) {
  const url = validateSource(value)
  const addresses = await lookup(url.hostname, { all: true, family: 4 })
  if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new Error('禁止访问非公网地址')
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: SOURCE_HEADERS,
      lookup: (_host, options, cb) => options.all ? cb(null, [addresses[0]]) : cb(null, addresses[0].address, 4),
    }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`来源返回 HTTP ${res.statusCode}，未更新记录；请检查来源或更换允许的地址`)); return }
      const chunks = []; let size = 0
      res.on('data', chunk => { size += chunk.length; if (size > 2_000_000) req.destroy(new Error('来源超过 2 MB 限制')); else chunks.push(chunk) })
      res.on('error', reject)
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    const timer = setTimeout(() => req.destroy(new Error('抓取超时（30 秒）')), 30_000)
    req.on('close', () => clearTimeout(timer))
    req.on('error', reject)
  })
}
