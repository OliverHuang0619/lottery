import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { openStore } from './store.mjs'
import { createApi } from './api.mjs'
import { createExecutor } from './executor.mjs'
import { publicAddress, validateSource, DEFAULT_SOURCE } from './source.mjs'

const token = 'test-only-token-abcdefghijklmnopqrstuvwxyz'
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lottery-test-'))
  const store = openStore(directory)
  const executor = createExecutor(store, directory, { command: process.execPath, prefix: [path.join(import.meta.dirname, 'fixtures/fake-cli.mjs')], timeout: 5000, prepare: async (_root, working) => mkdir(working, { recursive: true }), publish: async () => 0, ...options })
  const api = createApi(store, executor, token)
  const server = createServer((req, res) => { void api(req, res, new URL(req.url, 'http://localhost')) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (url, data) => fetch(base + url, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })
  t.after(async () => {
    executor.stop(); server.closeAllConnections()
    await new Promise(resolve => server.close(resolve)); store.db.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { store, request, base, directory }
}
test('authentication, conversation persistence, CLI answer, resume and SSE replay', async t => {
  const f = await fixture(t)
  assert.equal((await fetch(f.base + '/api/conversations')).status, 401)
  assert.equal((await fetch(f.base + '/api/health')).status, 200)
  const c = await (await f.request('/api/conversations', { title: '测试对话' })).json()
  const task = await (await f.request(`/api/conversations/${c.id}/messages`, { content: '分析' })).json()
  const events = await (await f.request(`/api/tasks/${task.id}/events`)).text()
  assert.match(events, /completed/)
  const detail = await (await f.request(`/api/conversations/${c.id}`)).json()
  assert.equal(detail.messages[1].content, '分析完成')
  assert.equal(detail.tasks[0].status, 'completed')
  assert.equal(f.store.get('SELECT model FROM tasks WHERE id=?', task.id).model, 'gpt-5.6-sol')
  assert.equal(f.store.get('SELECT reasoning_effort FROM tasks WHERE id=?', task.id).reasoning_effort, 'low')
  assert.equal(f.store.get('SELECT thread_id FROM conversations WHERE id=?', c.id).thread_id, 'test-thread-123')
  const second = await (await f.request(`/api/conversations/${c.id}/messages`, { content: '继续' })).json()
  await (await f.request(`/api/tasks/${second.id}/events`)).text()
  const next = await (await f.request(`/api/conversations/${c.id}`)).json()
  assert.equal(next.messages.at(-1).content, '续接成功')
  const last = f.store.get('SELECT max(id) AS id FROM events WHERE task_id=?', task.id).id
  assert.equal(await (await f.request(`/api/tasks/${task.id}/events?after=${last}`)).text(), '')
})
test('fetch failure never launches CLI or creates a result', async t => {
  const f = await fixture(t, { fetcher: async () => { throw new Error('HTTP 403') } })
  const c = await (await f.request('/api/conversations', {})).json()
  const task = await (await f.request(`/api/conversations/${c.id}/messages`, { content: '获取最新', sourceUrl: DEFAULT_SOURCE })).json()
  assert.match(await (await f.request(`/api/tasks/${task.id}/events`)).text(), /403/)
  assert.equal(f.store.get('SELECT thread_id FROM conversations WHERE id=?', c.id).thread_id, null)
  assert.equal(f.store.all('SELECT * FROM messages WHERE role=?', 'assistant').length, 0)
})
test('CLI failure and timeout are terminal; duplicate active requests rejected', async t => {
  const f = await fixture(t, { timeout: 500 })
  const c = await (await f.request('/api/conversations', {})).json()
  const task = await (await f.request(`/api/conversations/${c.id}/messages`, { content: 'TEST_TIMEOUT' })).json()
  assert.equal((await f.request(`/api/conversations/${c.id}/messages`, { content: '重复' })).status, 409)
  assert.match(await (await f.request(`/api/tasks/${task.id}/events`)).text(), /任务执行超时/)
  const failed = await (await f.request(`/api/conversations/${c.id}/messages`, { content: 'TEST_FAILURE' })).json()
  assert.match(await (await f.request(`/api/tasks/${failed.id}/events`)).text(), /模拟失败/)
})
test('restart marks interrupted tasks failed and preserves messages', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lottery-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let store = openStore(directory)
  const c = store.conversation('持久化')
  store.message(c.id, 'user', '保留消息')
  store.run('INSERT INTO tasks(id,conversation_id,status,prompt,source_url,error,created_at) VALUES(?,?,?,?,?,?,?)', 'interrupted', c.id, 'running', '请求', null, null, new Date().toISOString())
  store.db.close(); store = openStore(directory)
  assert.equal(store.get('SELECT status FROM tasks').status, 'failed')
  assert.equal(store.get('SELECT content FROM messages').content, '保留消息')
  assert.equal(store.all('SELECT * FROM events').length, 1)
  store.db.close()
})
test('source validation rejects private networks, credentials, unlisted hosts and non-HTTPS', () => {
  assert.equal(validateSource(DEFAULT_SOURCE).hostname, '2026kj.zkclhb.com')
  for (const url of ['http://2026kj.zkclhb.com/hk.html', 'https://localhost/', 'https://user:pass@2026kj.zkclhb.com/']) assert.throws(() => validateSource(url))
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.2', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(publicAddress(address), false)
  assert.equal(publicAddress('8.8.8.8'), true)
})
test('model configuration is exposed and invalid overrides are rejected', async t => {
  const f = await fixture(t)
  const config = await (await f.request('/api/config')).json()
  assert.equal(config.defaultModel, 'gpt-5.6-sol')
  assert.equal(config.defaultEffort, 'low')
  assert.ok(config.models.some(row => row.id === 'gpt-5.6-sol'))
  const c = await (await f.request('/api/conversations', {})).json()
  assert.equal((await f.request(`/api/conversations/${c.id}/messages`, { content: '分析', model: 'gpt-5.3-codex' })).status, 400)
})
