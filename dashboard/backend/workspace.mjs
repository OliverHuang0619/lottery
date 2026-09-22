import { cp, mkdir, readFile, readdir, writeFile, rename, lstat } from 'node:fs/promises'
import path from 'node:path'

async function files(directory) {
  try { return (await readdir(directory)).filter(name => name.endsWith('.json')) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
}
async function readRegular(file) {
  if (!(await lstat(file)).isFile()) throw new Error('结果必须是普通文件：' + file)
  return readFile(file, 'utf8')
}
function validPick(pick) { return Number.isInteger(pick?.number) && pick.number >= 1 && pick.number <= 49 && pick.zodiac?.length === 1 && '鼠牛虎兔龙蛇马羊猴鸡狗猪'.includes(pick.zodiac) }
export function validateArtifact(name, value) {
  if (name === 'predictions') {
    if (!/^\d+$/.test(value?.target_issue || '') || !validPick(value?.special) || !Array.isArray(value?.regular) || value.regular.length !== 6 || !value.regular.every(validPick) || new Set(value.regular.map(p => p.number)).size !== 6 || !Array.isArray(value?.regular_three) || value.regular_three.length !== 3 || !value.regular_three.every(p => validPick(p) && value.regular.some(r => r.number === p.number)) || new Set(value.regular_three.map(p => p.number)).size !== 3 || !value.forecast_assessment?.walk_forward || !value.forecast_assessment?.saved_reviews) throw new Error('预测结果缺少必要字段或号码无效')
  } else if (!/^\d+$/.test(value?.actual_issue || '') || typeof value.special_number_hit !== 'boolean' || typeof value.special_zodiac_hit !== 'boolean' || !Array.isArray(value.regular_hits)) throw new Error('复盘结果缺少必要字段')
}
export function validateRecords(document, legacyUndated = new Set()) {
  if (!Array.isArray(document?.records) || !document.records.length) throw new Error('开奖记录为空或格式错误')
  const seen = new Set()
  const positions = ['平一', '平二', '平三', '平四', '平五', '平六', '特码']
  for (const row of document.records) {
    const issue = Number(row.issue)
    if (typeof row.issue !== 'string' || !/^\d+$/.test(row.issue) || !Number.isSafeInteger(issue) || issue <= 0 || seen.has(issue)) throw new Error('重复或无效期号')
    seen.add(issue)
    if (!(row.date == null && legacyUndated.has(issue)) && (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date)) throw new Error('无效开奖日期')
    if (!Array.isArray(row.numbers) || row.numbers.length !== 7 || new Set(row.numbers.map(n => n.number)).size !== 7) throw new Error('开奖需要七个不重复号码')
    row.numbers.forEach((n, i) => {
      if (!Number.isInteger(n.number) || n.number < 1 || n.number > 49 || n.position !== positions[i] || !'鼠牛虎兔龙蛇马羊猴鸡狗猪'.includes(n.zodiac) || n.zodiac?.length !== 1) throw new Error('号码、位置或生肖无效')
    })
  }
}
export async function prepareWorkspace(root, directory) {
  await mkdir(directory, { recursive: true })
  for (const name of ['data/current', 'predictions', 'reviews', 'skill']) {
    await cp(path.join(root, name), path.join(directory, name), { recursive: true })
  }
}
export async function publishWorkspace(root, directory) {
  const updates = []
  for (const name of ['predictions', 'reviews']) {
    const original = await files(path.join(root, name))
    const candidates = await files(path.join(directory, name))
    for (const file of original) {
      if (!candidates.includes(file) || await readRegular(path.join(root, name, file)) !== await readRegular(path.join(directory, name, file))) throw new Error('拒绝覆盖或删除历史文件：' + file)
    }
    for (const file of candidates.filter(file => !original.includes(file))) {
      if (!/^(prediction-for-|review-)[\w-]+\.json$/.test(file)) throw new Error('结果文件名无效：' + file)
      const content = await readRegular(path.join(directory, name, file))
      validateArtifact(name, JSON.parse(content))
      updates.push({ file: path.join(root, name, file), content, fresh: true })
    }
  }
  const previous = JSON.parse(await readRegular(path.join(root, 'data/current/records.json')))
  const nextText = await readRegular(path.join(directory, 'data/current/records.json'))
  const next = JSON.parse(nextText)
  validateRecords(next, new Set(previous.records.filter(row => row.date == null).map(row => Number(row.issue))))
  for (const row of previous.records) {
    const match = next.records.find(candidate => Number(candidate.issue) === Number(row.issue))
    if (JSON.stringify(match) !== JSON.stringify(row)) throw new Error('拒绝覆盖或删除已有开奖记录：' + row.issue)
  }
  for (const file of ['records.json', 'analysis.json', 'backtest.json', 'model-evaluation.json']) {
    const candidate = path.join(directory, 'data/current', file)
    let content
    try { content = await readRegular(candidate) } catch (e) { if (e.code === 'ENOENT') continue; throw e }
    JSON.parse(content)
    const target = path.join(root, 'data/current', file)
    let previousText
    try { previousText = await readRegular(target) } catch (e) { if (e.code !== 'ENOENT') throw e }
    if (content !== previousText) updates.push({ file: target, content, fresh: false })
  }
  // Validate every proposed change before publishing. Individual replacements are atomic.
  for (const update of updates) {
    if (update.fresh) await writeFile(update.file, update.content, { flag: 'wx' })
    else { const temporary = update.file + '.tmp'; await writeFile(temporary, update.content); await rename(temporary, update.file) }
  }
  return updates.length
}
