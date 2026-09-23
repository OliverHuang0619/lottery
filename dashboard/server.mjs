import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStore } from './backend/store.mjs'
import { createExecutor } from './backend/executor.mjs'
import { createApi } from './backend/api.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(process.env.WORKSPACE_DIR || path.join(here, '..'))
const dist = path.join(here, 'dist')
const port = Number(process.env.PORT || 4173)
const store = openStore(process.env.STATE_DIR || path.join(projectRoot, 'runtime'))
const executor = createExecutor(store, projectRoot)
const api = createApi(store, executor, process.env.APP_TOKEN)
const json = async file => JSON.parse(await readFile(path.join(projectRoot, file), 'utf8'))

async function dashboardData() {
  const [recordsDoc, analysis, evaluation, reviewFiles, predictionFiles] = await Promise.all([
    json('data/current/records.json'), json('data/current/analysis.json'),
    json('data/current/model-evaluation.json'), readdir(path.join(projectRoot, 'reviews')),
    readdir(path.join(projectRoot, 'predictions')),
  ])
  const predictionCandidates = predictionFiles.map(name => ({ name, match: name.match(/^prediction-for-(\d+)(-with-flat-zodiac)?\.json$/) })).filter(row => row.match).sort((a, b) => Number(a.match[1]) - Number(b.match[1]) || Number(Boolean(a.match[2])) - Number(Boolean(b.match[2])))
  const prediction = await json(`predictions/${predictionCandidates.at(-1).name}`)
  const reviewRows = await Promise.all(reviewFiles.filter(name => /^review-.*\.json$/.test(name)).map(name => json(`reviews/${name}`)))
  const canonical = new Map()
  for (const row of reviewRows.sort((a, b) => Number(Boolean(a.correction_of)) - Number(Boolean(b.correction_of)))) canonical.set(row.actual_issue, row)
  const recordByIssue = new Map(recordsDoc.records.map(row => [row.issue, row]))
  const reviews = await Promise.all([...canonical.values()].map(async row => {
    let savedPrediction = null
    try { savedPrediction = await json(`predictions/prediction-for-${row.actual_issue}-with-flat-zodiac.json`) }
    catch { try { savedPrediction = await json(`predictions/prediction-for-${row.actual_issue}.json`) } catch { /* older review without a saved prediction file */ } }
    return { ...row, predicted_regular: savedPrediction?.regular ?? [], predicted_regular_three: savedPrediction?.regular_three ?? [], actual_numbers: recordByIssue.get(row.actual_issue)?.numbers ?? [] }
  }))
  reviews.sort((a, b) => Number(b.actual_issue) - Number(a.actual_issue))
  return { generatedAt: new Date().toISOString(), records: recordsDoc.records, analysis, prediction, evaluation, reviews }
}

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json; charset=utf-8' }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (await api(req, res, url)) return
    if (url.pathname === '/dashboard.json' || url.pathname === '/api/dashboard') {
      res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' })
      return res.end(JSON.stringify(await dashboardData()))
    }
    const requested = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0].slice(1))
    let file = path.resolve(dist, requested)
    if (file !== dist && !file.startsWith(dist + path.sep)) throw new Error('invalid path')
    if (path.extname(file) === '.json') { res.writeHead(404); return res.end() }
    try { if (!(await stat(file)).isFile()) file = path.join(dist, 'index.html') } catch { file = path.join(dist, 'index.html') }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
    res.end(await readFile(file))
  } catch (error) {
    res.writeHead(500, { 'Content-Type':'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown error' }))
  }
}).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Dashboard: http://localhost:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  executor.stop()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
})
