import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
async function readJson(file: string) { return JSON.parse(await readFile(path.join(root, file), 'utf8')) }
async function dashboardPayload() {
  const [recordsDoc, analysis, evaluation, reviewFiles, predictionFiles] = await Promise.all([
    readJson('data/current/records.json'), readJson('data/current/analysis.json'),
    readJson('data/current/model-evaluation.json'), readdir(path.join(root, 'reviews')),
    readdir(path.join(root, 'predictions')),
  ])
  const predictionCandidates = predictionFiles.map(name => ({ name, match: name.match(/^prediction-for-(\d+)(-with-flat-zodiac)?\.json$/) })).filter(row => row.match).sort((a, b) => Number(a.match![1]) - Number(b.match![1]) || Number(Boolean(a.match![2])) - Number(Boolean(b.match![2])))
  const prediction = await readJson(`predictions/${predictionCandidates.at(-1)!.name}`)
  const reviewRows = await Promise.all(reviewFiles.filter(name => /^review-.*\.json$/.test(name)).map(name => readJson(`reviews/${name}`)))
  const canonical = new Map<string, any>()
  for (const row of reviewRows.sort((a, b) => Number(Boolean(a.correction_of)) - Number(Boolean(b.correction_of)))) canonical.set(row.actual_issue, row)
  const recordByIssue = new Map(recordsDoc.records.map((row: any) => [row.issue, row]))
  const reviews = await Promise.all([...canonical.values()].map(async row => {
    let savedPrediction = null
    try { savedPrediction = await readJson(`predictions/prediction-for-${row.actual_issue}-with-flat-zodiac.json`) }
    catch { try { savedPrediction = await readJson(`predictions/prediction-for-${row.actual_issue}.json`) } catch { /* older review without a saved prediction file */ } }
    const actualRecord = recordByIssue.get(row.actual_issue) as { numbers?: unknown[] } | undefined
    return { ...row, predicted_regular: savedPrediction?.regular ?? [], predicted_regular_three: savedPrediction?.regular_three ?? [], actual_numbers: actualRecord?.numbers ?? [] }
  }))
  reviews.sort((a, b) => Number(b.actual_issue) - Number(a.actual_issue))
  return { generatedAt: new Date().toISOString(), records: recordsDoc.records, analysis, prediction, evaluation, reviews }
}
function dynamicData() {
  return { name: 'lottery-dynamic-data', configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use('/dashboard.json', async (_req, res) => {
      try { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(await dashboardPayload())) }
      catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown error' })) }
    })
  } }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  server: { proxy: { '/api': 'http://127.0.0.1:4173' } },
  plugins: [react(), dynamicData()],
})
