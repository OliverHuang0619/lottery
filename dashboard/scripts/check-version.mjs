import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const version = (await readFile(path.join(root, 'VERSION'), 'utf8')).trim()
const pkg = JSON.parse(await readFile(path.join(root, 'dashboard', 'package.json'), 'utf8'))

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`VERSION 不是有效的语义化版本：${version}`)
if (pkg.version !== version) throw new Error(`版本不一致：VERSION=${version}，dashboard/package.json=${pkg.version}`)
console.log(`Version ${version} validated`)
