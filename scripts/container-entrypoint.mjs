import { cp, mkdir, access } from 'node:fs/promises'
import path from 'node:path'

const root = process.env.WORKSPACE_DIR || '/workspace'
await mkdir(root, { recursive: true })
for (const name of ['data', 'predictions', 'reviews']) {
  try { await access(path.join(root, name)) }
  catch { await cp(`/app/seed/${name}`, path.join(root, name), { recursive: true }) }
}
// Skill implementation follows the deployed image; historical artifacts remain in the volume.
await cp('/app/seed/skill', path.join(root, 'skill'), { recursive: true })
await mkdir(path.join(process.env.CODEX_HOME, 'skills'), { recursive: true })
await cp('/app/seed/skill/analyze-lottery-history', path.join(process.env.CODEX_HOME, 'skills/analyze-lottery-history'), { recursive: true })
await import('../dashboard/server.mjs')
