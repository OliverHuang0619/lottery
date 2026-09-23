import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { prepareWorkspace, publishWorkspace, validateRecords } from './workspace.mjs'

const row = { issue: '001', date: '2026-01-01', numbers: ['平一','平二','平三','平四','平五','平六','特码'].map((position, i) => ({ position, number: i + 1, zodiac: '鼠' })) }
const prediction = { target_issue: '003', special: row.numbers[6], regular: row.numbers.slice(0, 6), regular_three: row.numbers.slice(0, 3), forecast_assessment: { walk_forward: {}, saved_reviews: {} } }
async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lottery-publish-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'original'), copy = path.join(directory, 'copy')
  for (const folder of ['data/current', 'predictions', 'reviews', 'skill']) await mkdir(path.join(root, folder), { recursive: true })
  await writeFile(path.join(root, 'data/current/records.json'), JSON.stringify({ records: [row] }))
  await writeFile(path.join(root, 'predictions/prediction-for-002.json'), '{"locked":true}')
  await prepareWorkspace(root, copy)
  return { root, copy }
}
test('publishes valid new results without altering historical ledger', async t => {
  const { root, copy } = await setup(t)
  await writeFile(path.join(copy, 'data/current/records.json'), JSON.stringify({ records: [{ ...row, issue: '002', date: '2026-01-02' }, row] }))
  await writeFile(path.join(copy, 'predictions/prediction-for-003.json'), JSON.stringify(prediction))
  assert.equal(await publishWorkspace(root, copy), 2)
  assert.equal(JSON.parse(await readFile(path.join(root, 'data/current/records.json'))).records.length, 2)
  assert.equal(await readFile(path.join(root, 'predictions/prediction-for-002.json'), 'utf8'), '{"locked":true}')
})
test('rejects history tampering before publishing any other output', async t => {
  const { root, copy } = await setup(t)
  await writeFile(path.join(copy, 'predictions/prediction-for-002.json'), '{}')
  await writeFile(path.join(copy, 'data/current/analysis.json'), '{}')
  await assert.rejects(publishWorkspace(root, copy), /拒绝覆盖/)
  await assert.rejects(readFile(path.join(root, 'data/current/analysis.json')), { code: 'ENOENT' })
})
test('rejects duplicates, altered records and invalid number/position schemas', async t => {
  const { root, copy } = await setup(t)
  const changed = { ...row, date: '2026-01-02' }
  await writeFile(path.join(copy, 'data/current/records.json'), JSON.stringify({ records: [changed] }))
  await assert.rejects(publishWorkspace(root, copy), /已有开奖记录/)
  assert.throws(() => validateRecords({ records: [row, { ...row, issue: '1' }] }), /重复/)
  assert.throws(() => validateRecords({ records: [{ ...row, numbers: row.numbers.map(n => ({ ...n, number: 50 })) }] }))
})
test('rejects incomplete model artifacts', async t => {
  const { root, copy } = await setup(t)
  await writeFile(path.join(copy, 'predictions/prediction-for-003.json'), '{}')
  await assert.rejects(publishWorkspace(root, copy), /预测结果缺少/)
})
test('preserves legacy undated records, while requiring dates on new draws', async t => {
  const { root, copy } = await setup(t)
  const legacy = { ...row, date: null }
  for (const directory of [root, copy]) await writeFile(path.join(directory, 'data/current/records.json'), JSON.stringify({ records: [legacy] }))
  assert.equal(await publishWorkspace(root, copy), 0)
  await writeFile(path.join(copy, 'data/current/records.json'), JSON.stringify({ records: [legacy, { ...legacy, issue: '002' }] }))
  await assert.rejects(publishWorkspace(root, copy), /无效开奖日期/)
})
