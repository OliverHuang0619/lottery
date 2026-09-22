import { randomUUID, timingSafeEqual } from 'node:crypto'
import { DEFAULT_SOURCE, validateSource } from './source.mjs'

export const MODEL_OPTIONS = Object.freeze([
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
])
export const EFFORT_OPTIONS = Object.freeze([
  { id: 'minimal', name: 'Minimal' }, { id: 'low', name: 'Light' },
  { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }, { id: 'xhigh', name: 'XHigh' },
])
const defaultModel = () => process.env.CODEX_MODEL || 'gpt-5.6-sol'
const defaultEffort = () => process.env.CODEX_REASONING_EFFORT || 'low'

const send = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
async function body(req) {
  let value = ''
  for await (const chunk of req) {
    value += chunk
    if (Buffer.byteLength(value) > 32_000) throw Object.assign(new Error('请求过大'), { status: 413 })
  }
  try { return JSON.parse(value || '{}') } catch { throw Object.assign(new Error('无效 JSON'), { status: 400 }) }
}
export function createApi(store, executor, token) {
  if (!token || token.length < 24) throw new Error('请设置至少 24 字符的 APP_TOKEN')
  return async (req, res, url) => {
    if (url.pathname === '/api/health') { send(res, 200, { ok: true }); return true }
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/dashboard.json') return false
    const incoming = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''))
    const expected = Buffer.from(token)
    if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) { send(res, 401, { error: '请填写正确的访问令牌' }); return true }
    try {
      if (url.pathname === '/api/dashboard' || url.pathname === '/dashboard.json') return false
      if (req.method === 'GET' && url.pathname === '/api/config') {
        send(res, 200, { defaultSource: DEFAULT_SOURCE, defaultModel: defaultModel(), defaultEffort: defaultEffort(), models: MODEL_OPTIONS, efforts: EFFORT_OPTIONS, skills: [{ id: 'analyze-lottery-history', name: '开奖分析与预测' }] }); return true
      }
      if (url.pathname === '/api/conversations') {
        if (req.method === 'GET') send(res, 200, store.all('SELECT * FROM conversations ORDER BY created_at DESC'))
        else if (req.method === 'POST') { const input = await body(req); send(res, 201, store.conversation(typeof input.title === 'string' ? input.title : undefined)) }
        else send(res, 405, { error: 'Method not allowed' })
        return true
      }
      const conversationRoute = url.pathname.match(/^\/api\/conversations\/([\w-]+)(\/messages)?$/)
      if (conversationRoute) {
        const id = conversationRoute[1]
        if (!store.get('SELECT id FROM conversations WHERE id=?', id)) { send(res, 404, { error: '对话不存在' }); return true }
        if (req.method === 'GET' && !conversationRoute[2]) {
          send(res, 200, { messages: store.all('SELECT * FROM messages WHERE conversation_id=? ORDER BY rowid', id), tasks: store.all('SELECT id,status,error,created_at FROM tasks WHERE conversation_id=? ORDER BY rowid', id) }); return true
        }
        if (req.method === 'POST' && conversationRoute[2]) {
          const input = await body(req)
          if (input.skill && input.skill !== 'analyze-lottery-history') throw new Error('未知技能')
          const model = input.model || defaultModel()
          const reasoningEffort = input.reasoningEffort || defaultEffort()
          if (!MODEL_OPTIONS.some(option => option.id === model)) throw new Error('不支持的模型')
          if (!EFFORT_OPTIONS.some(option => option.id === reasoningEffort)) throw new Error('不支持的推理强度')
          if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 16000) throw new Error('消息需为 1–16000 字符')
          if (input.sourceUrl !== undefined && typeof input.sourceUrl !== 'string') throw new Error('无效来源地址')
          if (input.sourceUrl) validateSource(input.sourceUrl)
          if (store.get("SELECT id FROM tasks WHERE conversation_id=? AND status IN ('queued','running')", id)) { send(res, 409, { error: '当前对话已有任务正在处理' }); return true }
          if (store.get("SELECT count(*) AS count FROM tasks WHERE status IN ('queued','running')").count >= 20) { send(res, 429, { error: '任务队列已满' }); return true }
          const taskId = randomUUID()
          store.db.exec('BEGIN')
          try {
            store.message(id, 'user', input.content.trim())
            store.run('INSERT INTO tasks(id,conversation_id,status,prompt,source_url,error,created_at,model,reasoning_effort) VALUES(?,?,?,?,?,?,?,?,?)', taskId, id, 'queued', input.content.trim(), input.sourceUrl || null, null, new Date().toISOString(), model, reasoningEffort)
            store.db.exec('COMMIT')
          } catch (error) { store.db.exec('ROLLBACK'); throw error }
          store.event(taskId, { type: 'status', status: 'queued' })
          send(res, 202, { id: taskId, status: 'queued' })
          void executor.drain()
          return true
        }
      }
      const eventRoute = url.pathname.match(/^\/api\/tasks\/([\w-]+)\/events$/)
      if (req.method === 'GET' && eventRoute) {
        const id = eventRoute[1]
        if (!store.get('SELECT id FROM tasks WHERE id=?', id)) { send(res, 404, { error: '任务不存在' }); return true }
        let cursor = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0)
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('无效事件游标')
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
        const poll = () => {
          const rows = store.all('SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT 100', id, cursor)
          for (const row of rows) { cursor = row.id; res.write(`id: ${row.id}\ndata: ${row.payload}\n\n`) }
          const task = store.get('SELECT status FROM tasks WHERE id=?', id)
          if (rows.length < 100 && ['failed','completed'].includes(task.status)) { clearInterval(timer); res.end() }
          else res.write(': heartbeat\n\n')
        }
        const timer = setInterval(poll, 1000)
        res.on('close', () => clearInterval(timer))
        poll(); return true
      }
      send(res, 404, { error: '接口不存在' }); return true
    } catch (error) { send(res, error.status || 400, { error: error.message }); return true }
  }
}
