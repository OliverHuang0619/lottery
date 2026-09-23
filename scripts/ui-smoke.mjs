// Use an installed Playwright package: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const password = (await readFile(path.join(root, '.env'), 'utf8')).match(/^APP_PASSWORD=(.+)$/m)?.[1].trim()
const output = path.join(root, 'work/ui-qa')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const base = process.env.APP_URL || 'http://127.0.0.1:4173'
  assert.equal((await page.request.get(base + '/api/health')).status(), 200)
  assert.equal((await page.request.get(base + '/api/conversations')).status(), 401)
  await page.goto(base)
  await page.getByLabel('登录密码').fill(password)
  await page.getByRole('button', { name: '进入工作台' }).click()
  await page.getByRole('heading', { name: '历史数据与预测表现' }).waitFor()
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true })
  await page.waitForFunction(() => document.body.innerText.includes('102'))
  await page.screenshot({ path: path.join(output, 'dashboard.png'), fullPage: true })
  await page.getByRole('button', { name: '返回分析对话' }).click()
  // Exercise UI transport with fixtures, without creating synthetic production forecasts.
  let sent = false
  await page.route('**/api/conversations', route => route.fulfill({ json: { id: 'ui-fixture', title: 'UI 自动验证', thread_id: null } }))
  await page.route('**/api/conversations/ui-fixture', route => route.fulfill({ json: {
    messages: sent ? [{ id: 'u1', role: 'user', content: '测试分析' }, { id: 'a1', role: 'assistant', content: '测试回答：任务完成，历史记录保持完整。' }] : [],
    tasks: sent ? [{ id: 'task-fixture', status: 'completed', error: null }] : [],
  } }))
  await page.route('**/api/conversations/ui-fixture/messages', async route => {
    sent = true
    await route.fulfill({ status: 202, json: { id: 'task-fixture', status: 'queued' } })
  })
  await page.getByRole('textbox', { name: '发送消息' }).fill('测试分析')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('测试回答：任务完成，历史记录保持完整。', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile horizontal overflow')
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: health, authentication, dashboard, chat submission, mobile overflow, browser runtime errors')
} finally { await browser.close() }
