/**
 * dsh-hs2-pipeline — host half.
 *
 * The page cannot read arbitrary files. When an agent finishes a step it POSTs
 * the absolute paths it just wrote; this route checks they sit inside the
 * reported delivery folder, remembers them, and serves the preview image back
 * to the page. Nothing here is specific to one computer.
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, stat, mkdtemp, rm, readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const name = 'dsh-hs2-pipeline'
export const inject = ['webServer', 'connection']

const PREFIX = '/api/dsh-hs2-pipeline'
const JOB_ID = /^[0-9]{8}-[0-9]{6}$/
const PART_ID = /^[a-z][a-z0-9]{0,24}$/
const STAGES = { split: true, fit: true, pack: true }
const jobs = new Map()

function home() {
  return process.env.DSH_HOME && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

function storeFile() {
  return join(home(), 'hs2-pipeline-reports.json')
}

function altStoreFile() {
  const h = home().replace(/[\\/]+$/, '')
  const base = homedir()
  if (/\.dsh-desktop$/i.test(h)) return join(base, '.dsh', 'hs2-pipeline-reports.json')
  if (/\.dsh$/i.test(h)) return join(base, '.dsh-desktop', 'hs2-pipeline-reports.json')
  return ''
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '::1' || /^127(\.\d{1,3}){3}$/.test(hostname)
}

function trusted(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  if (!isLoopback(host.split(':')[0])) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function inside(root, file) {
  const base = resolve(root)
  const target = resolve(file)
  const rel = relative(base, target)
  return rel !== '' && !rel.startsWith('..') && !rel.split(sep).includes('..')
}

async function isFile(file) {
  try {
    const info = await stat(file)
    return info.isFile()
  } catch {
    return false
  }
}

async function isDir(file) {
  try {
    const info = await stat(file)
    return info.isDirectory()
  } catch {
    return false
  }
}

function launch(command, args, options) {
  const windowsHide = !!(options && options.windowsHide)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolvePromise()
    })
  })
}

function openExplorer(folder) {
  return launch('explorer.exe', [folder], { windowsHide: false })
}

function psQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function pickerOwner() {
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class Hs2Fg {',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);',
    '  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
    '  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);',
    '  public static void Force(IntPtr hWnd) {',
    '    IntPtr fore = GetForegroundWindow();',
    '    uint ft = GetWindowThreadProcessId(fore, IntPtr.Zero);',
    '    uint tt = GetCurrentThreadId();',
    '    if (ft != tt) AttachThreadInput(ft, tt, true);',
    '    SetForegroundWindow(hWnd);',
    '    if (ft != tt) AttachThreadInput(ft, tt, false);',
    '  }',
    '}',
    '"@',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow',
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.Size = New-Object System.Drawing.Size(1,1)',
    '$owner.Opacity = 0',
    '$owner.Show()',
    '$owner.Activate()',
    '[Hs2Fg]::Force($owner.Handle)'
  ]
}

function pickerScript(kind, filter, outFile) {
  const dest = psQuote(outFile)
  const head = pickerOwner()
  if (kind === 'folder') {
    return head.concat([
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = '选择文件夹'",
      '$dialog.ShowNewFolderButton = $true',
      '$ok = $dialog.ShowDialog($owner)',
      '$owner.Dispose()',
      "if ($ok -eq [System.Windows.Forms.DialogResult]::OK) { Set-Content -LiteralPath " + dest + " -Value $dialog.SelectedPath -Encoding utf8 }"
    ]).join('\n')
  }
  const spec = filter === 'blend'
    ? 'Blender (*.blend)|*.blend'
    : '素材 (*.zip;*.blend)|*.zip;*.blend|所有文件 (*.*)|*.*'
  const title = filter === 'blend' ? '选择 .blend 文件' : '选择素材'
  return head.concat([
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    "$dialog.Title = '" + title + "'",
    "$dialog.Filter = '" + spec + "'",
    '$dialog.CheckFileExists = $true',
    '$dialog.Multiselect = $false',
    '$ok = $dialog.ShowDialog($owner)',
    '$owner.Dispose()',
    "if ($ok -eq [System.Windows.Forms.DialogResult]::OK) { Set-Content -LiteralPath " + dest + " -Value $dialog.FileName -Encoding utf8 }"
  ]).join('\n')
}

function runPicker(script) {
  return new Promise((resolvePromise, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: false })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('选择超时'))
    }, 180000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
}

async function pickNative(kind, filter) {
  const dir = await mkdtemp(join(tmpdir(), 'hs2-pick-'))
  const outFile = join(dir, 'path.txt')
  try {
    await runPicker(pickerScript(kind, filter, outFile))
    const picked = (await readFile(outFile, 'utf8').catch(() => '')).replace(/^\uFEFF/, '').trim()
    return picked
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function loadOneStore(file, fillOnly) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return
    Object.keys(parsed).forEach(function (id) {
      if (!JOB_ID.test(id)) return
      const incoming = parsed[id]
      if (!incoming || typeof incoming !== 'object') return
      if (fillOnly && jobs.has(id)) {
        const cur = jobs.get(id) || { root: '', items: {} }
        if ((!cur.root || cur.root === '') && incoming.root) cur.root = incoming.root
        if (!cur.items) cur.items = {}
        const incomingItems = incoming.items && typeof incoming.items === 'object' ? incoming.items : {}
        Object.keys(incomingItems).forEach(function (key) {
          const next = incomingItems[key]
          if (!next || typeof next !== 'object') return
          const prev = cur.items[key]
          if (!prev) {
            cur.items[key] = next
            return
          }
          cur.items[key] = {
            part: next.part || prev.part,
            stage: next.stage || prev.stage,
            blend: prev.blend || next.blend || '',
            preview: prev.preview || next.preview || '',
            zip: prev.zip || next.zip || '',
            searchName: prev.searchName || next.searchName || '',
            updated: Math.max(Number(prev.updated) || 0, Number(next.updated) || 0) || Date.now()
          }
        })
        jobs.set(id, cur)
        return
      }
      jobs.set(id, {
        root: incoming.root || '',
        items: incoming.items && typeof incoming.items === 'object' ? incoming.items : {}
      })
    })
  } catch {
    /* missing or unreadable */
  }
}

async function loadStore() {
  await loadOneStore(storeFile(), false)
  const alt = altStoreFile()
  if (alt && alt !== storeFile()) await loadOneStore(alt, true)
}

async function saveStore() {
  const data = {}
  jobs.forEach(function (value, id) { data[id] = value })
  await mkdir(dirname(storeFile()), { recursive: true })
  await writeFile(storeFile(), JSON.stringify(data))
}

function remember(jobId, root, items) {
  const current = jobs.get(jobId) || { root: '', items: {} }
  let changed = false
  if (root) {
    const nextRoot = resolve(root)
    if (current.root !== nextRoot) {
      current.root = nextRoot
      changed = true
    }
  }
  items.forEach(function (item) {
    const key = item.part + ':' + item.stage
    const prev = current.items[key] || {}
    const next = {
      part: item.part,
      stage: item.stage,
      blend: item.blend || prev.blend || '',
      preview: item.preview || prev.preview || '',
      zip: item.zip || prev.zip || '',
      searchName: item.searchName || prev.searchName || '',
      label: item.label || prev.label || '',
      updated: prev.updated || Date.now()
    }
    if (next.blend !== (prev.blend || '') || next.preview !== (prev.preview || '') || next.zip !== (prev.zip || '') || next.searchName !== (prev.searchName || '') || next.label !== (prev.label || '')) {
      next.updated = Date.now()
      changed = true
      current.items[key] = next
    } else if (!current.items[key]) {
      current.items[key] = next
      changed = true
    }
  })
  jobs.set(jobId, current)
  return changed
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('回报内容过大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}


async function findProjectDir(jobId) {
  if (!JOB_ID.test(jobId)) return ''
  const desktop = join(homedir(), 'Desktop')
  const parents = [join(desktop, 'hs2-pipeline')]
  try {
    const top = await readdir(desktop, { withFileTypes: true })
    for (const entry of top) {
      if (entry.isDirectory()) parents.push(join(desktop, entry.name, 'hs2-pipeline'))
    }
  } catch {
    /* no desktop */
  }
  for (const parent of parents) {
    let entries
    try { entries = await readdir(parent, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name !== jobId && !entry.name.startsWith(jobId + '-')) continue
      const dir = join(parent, entry.name)
      if (await isDir(join(dir, '01-split')) || await isDir(join(dir, '_logs')) || await isDir(join(dir, '02-fit'))) return dir
    }
  }
  return ''
}

async function ingestFromDisk(jobId) {
  const job = jobs.get(jobId)
  if (!job || typeof job.root !== 'string' || job.root === '') return false
  const root = resolve(job.root)
  let changed = false

  async function absorb(stage, parts) {
    const accepted = []
    for (const item of parts) {
      if (!item || !PART_ID.test(String(item.part || '')) || !STAGES[stage]) continue
      const next = { part: String(item.part), stage }
      for (const field of ['blend', 'preview', 'zip']) {
        const value = item[field]
        if (typeof value !== 'string' || value === '') continue
        if (!inside(root, value) || !(await isFile(value))) continue
        next[field] = resolve(value)
      }
      if (typeof item.name === 'string' && item.name.trim()) {
        const name = item.name.trim().slice(0, 80)
        if (stage === 'pack') next.searchName = name
        if (/^acc\d*$/.test(next.part)) next.label = name.slice(0, 40)
      }
      if (next.blend || next.preview || next.zip || next.label) accepted.push(next)
    }
    if (accepted.length) {
      if (remember(jobId, root, accepted)) changed = true
    }
  }

  const resultPath = join(root, '_logs', 'result.json')
  try {
    const raw = JSON.parse(await readFile(resultPath, 'utf8'))
    if (raw && Array.isArray(raw.parts)) {
      const stage = STAGES[raw.stage] ? raw.stage : ''
      if (stage) {
        await absorb(stage, raw.parts)
      } else {
        // Infer stage from path when omitted
        const byStage = { split: [], fit: [], pack: [] }
        for (const item of raw.parts) {
          const sample = String(item && (item.blend || item.preview || item.zip) || '')
          const stageGuess = /[\\/]01-split[\\/]/i.test(sample) ? 'split'
            : /[\\/]02-fit[\\/]/i.test(sample) ? 'fit'
            : /[\\/]03-mod[\\/]/i.test(sample) ? 'pack'
            : ''
          if (stageGuess) byStage[stageGuess].push(item)
        }
        for (const stage of Object.keys(byStage)) {
          if (byStage[stage].length) await absorb(stage, byStage[stage])
        }
      }
    }
  } catch {
    /* result.json may not exist yet */
  }

  // Fallback: scan conventional output folders so a finished Codex still surfaces without result.json
  const partIds = ['top', 'bot', 'bra', 'pants', 'glove', 'panst', 'socks', 'shoe', 'acc', 'hair']
  const scanPlan = [
    { stage: 'split', dir: '01-split', suffix: '_split' },
    { stage: 'fit', dir: '02-fit', suffix: '_fit' },
  ]
  for (const plan of scanPlan) {
    const found = []
    for (const part of partIds) {
      const blend = join(root, plan.dir, part, part + plan.suffix + '.blend')
      const preview = join(root, plan.dir, part, part + plan.suffix + '_preview.png')
      const item = { part, stage: plan.stage }
      if (await isFile(blend)) item.blend = blend
      if (await isFile(preview)) item.preview = preview
      if (item.blend || item.preview) found.push(item)
    }
    if (plan.stage === 'split') {
      try {
        const entries = await readdir(join(root, plan.dir), { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() || !/^acc\d+$/.test(entry.name)) continue
          const part = entry.name
          const blend = join(root, plan.dir, part, part + plan.suffix + '.blend')
          const preview = join(root, plan.dir, part, part + plan.suffix + '_preview.png')
          const item = { part, stage: plan.stage }
          if (await isFile(blend)) item.blend = blend
          if (await isFile(preview)) item.preview = preview
          if (item.blend || item.preview) found.push(item)
        }
      } catch {
        /* 01-split may not exist yet */
      }
    }
    if (found.length) {
      if (remember(jobId, root, found)) changed = true
    }
  }

  return changed
}

export function apply(ctx) {
  const ready = loadStore()
  const route = (suffix, method, handler) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PREFIX + suffix,
    handler: async (req, res) => {
      const readOnly = (suffix === '/job' || suffix === '/jobs' || suffix === '/preview') && req.method === method && method === 'GET'
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        // 401 = loopback OK but no cookie. Allow read-only GET so the page/tools
        // can recover delivered files. 403 = not trusted host/origin: still block.
        if (!(readOnly && rejection === 401 && trusted(req))) {
          sendJson(res, rejection, { ok: false, error: { message: rejection === 401 ? 'authentication required' : 'forbidden' } })
          return
        }
      } else if (!trusted(req)) {
        sendJson(res, 403, { ok: false, error: { message: 'forbidden' } })
        return
      }
      if (req.method !== method) {
        res.setHeader('allow', method)
        sendJson(res, 405, { ok: false, error: { message: 'method not allowed' } })
        return
      }
      try {
        await ready
        await handler(req, res, new URL(req.url, 'http://localhost'))
      } catch (error) {
        if (!res.headersSent) sendJson(res, 400, { ok: false, error: { message: error.message } })
      }
    }
  }), 'dsh-hs2-pipeline ' + suffix)

  route('/report', 'POST', async (req, res) => {
    const payload = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'))
    if (!payload || !JOB_ID.test(String(payload.jobId || '')) || typeof payload.root !== 'string' || !payload.root) {
      throw new Error('jobId 或 root 不对')
    }
    const root = resolve(payload.root)
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 200) : []
    const accepted = []
    for (const item of items) {
      if (!item || !PART_ID.test(String(item.part || '')) || !STAGES[item.stage]) continue
      const next = { part: item.part, stage: item.stage }
      for (const field of ['blend', 'preview', 'zip']) {
        const value = item[field]
        if (typeof value !== 'string' || value === '') continue
        if (!inside(root, value) || !(await isFile(value))) throw new Error(field + ' 不在交付目录里，或文件不存在')
        next[field] = resolve(value)
      }
      if (typeof item.name === 'string' && item.name.trim()) {
        const name = item.name.trim().slice(0, 80)
        if (item.stage === 'pack') next.searchName = name
        if (/^acc\d*$/.test(String(item.part || ''))) next.label = name.slice(0, 40)
      }
      if (next.blend || next.preview || next.zip || next.label) accepted.push(next)
    }
    remember(payload.jobId, root, accepted)
    await saveStore()
    sendJson(res, 200, { ok: true, accepted: accepted.length })
  })

  route('/project', 'POST', async (req, res) => {
    const payload = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
    if (!payload || !JOB_ID.test(String(payload.id || ''))) throw new Error('项目编号不对')
    const safe = String(payload.name || 'project').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'project'
    const folderName = payload.id + '-' + safe
    const parent = typeof payload.parent === 'string' ? payload.parent.trim() : ''
    if (!parent || (!/^[A-Za-z]:[\\/]/.test(parent) && !parent.startsWith('\\\\'))) {
      sendJson(res, 200, { ok: true, path: '', relative: 'hs2-pipeline/' + folderName })
      return
    }
    const dest = resolve(parent, folderName)
    await mkdir(join(dest, '01-split'), { recursive: true })
    await mkdir(join(dest, '02-fit'), { recursive: true })
    await mkdir(join(dest, '03-mod'), { recursive: true })
    remember(payload.id, dest, [])
    await saveStore()
    sendJson(res, 200, { ok: true, path: dest, relative: folderName })
  })

  route('/project/delete', 'POST', async (req, res) => {
    const payload = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8'))
    if (!payload || !JOB_ID.test(String(payload.id || ''))) throw new Error('项目编号不对')
    const raw = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (!raw) {
      jobs.delete(payload.id)
      await saveStore()
      sendJson(res, 200, { ok: true, removed: false })
      return
    }
    const target = resolve(raw)
    if (!/^[A-Za-z]:[\\/]/.test(target) && !target.startsWith('\\\\')) throw new Error('要绝对路径')
    if (/^[A-Za-z]:\\?$/.test(target)) throw new Error('不能删盘符')
    const parts = target.split(/[\\/]+/).filter(Boolean)
    if (parts.length < 3) throw new Error('这个路径太靠根目录，不删')
    const home = resolve(homedir())
    const blocked = [home, join(home, 'Desktop'), join(home, 'Documents'), join(home, 'Downloads')]
    if (blocked.some(function (dir) { return resolve(dir).toLowerCase() === target.toLowerCase() })) throw new Error('不能删这个目录')
    if (!(await isDir(target))) {
      jobs.delete(payload.id)
      await saveStore()
      sendJson(res, 200, { ok: true, removed: false })
      return
    }
    const leaf = parts[parts.length - 1]
    const marked = leaf.startsWith(payload.id)
      || await isDir(join(target, '01-split'))
      || await isDir(join(target, '02-fit'))
      || await isDir(join(target, '03-mod'))
      || await isDir(join(target, '_logs'))
    if (!marked) throw new Error('这个文件夹不像本插件的项目目录，没有删文件')
    await rm(target, { recursive: true, force: false })
    jobs.delete(payload.id)
    await saveStore()
    sendJson(res, 200, { ok: true, removed: true })
  })

  route('/jobs', 'GET', async (req, res) => {
    const list = []
    jobs.forEach(function (job, id) {
      const items = job && job.items ? Object.keys(job.items).map(function (key) { return job.items[key] }) : []
      list.push({ id: id, root: job && job.root ? job.root : '', itemCount: items.length, items: items })
    })
    sendJson(res, 200, { ok: true, jobs: list })
  })

  route('/job', 'GET', async (req, res, url) => {
    const id = url.searchParams.get('id') || ''
    if (!JOB_ID.test(id)) throw new Error('jobId 不对')
    const rootParam = (url.searchParams.get('root') || '').trim()
    let rebound = false
    const current = jobs.get(id)
    const storedRoot = current && current.root ? current.root : ''
    const storedOk = storedRoot !== '' && await isDir(storedRoot)
    let nextRoot = ''
    if (rootParam && (/^[A-Za-z]:[\\/]/.test(rootParam) || rootParam.startsWith('\\\\'))) {
      const given = resolve(rootParam)
      if (await isDir(given)) nextRoot = given
    }
    if (!nextRoot && !storedOk) nextRoot = await findProjectDir(id)
    if (nextRoot && remember(id, nextRoot, [])) rebound = true
    const dirty = await ingestFromDisk(id)
    if (dirty || rebound) await saveStore()
    const job = jobs.get(id)
    const items = job ? Object.keys(job.items).map(function (key) { return job.items[key] }) : []
    sendJson(res, 200, { ok: true, root: job ? job.root : '', items: items })
  })

  route('/pick', 'POST', async (req, res) => {
    const payload = JSON.parse((await readBody(req, 8 * 1024)).toString('utf8') || '{}')
    const kind = payload && payload.kind === 'folder' ? 'folder' : 'file'
    const filter = payload && payload.filter === 'blend' ? 'blend' : 'source'
    const picked = await pickNative(kind, filter)
    sendJson(res, 200, { ok: true, path: picked })
  })

  route('/open', 'POST', async (req, res) => {
    const payload = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8'))
    if (payload && payload.kind === 'folder') {
      const folder = typeof payload.path === 'string' ? payload.path.trim() : ''
      const zip = typeof payload.zip === 'string' ? payload.zip.trim() : ''
      const project = typeof payload.project === 'string' ? payload.project.trim() : ''
      if (/["\r\n]/.test(folder + zip + project)) throw new Error('路径里有打不开的字符')
      const candidates = []
      if (zip) candidates.push(dirname(resolve(zip)))
      if (folder) candidates.push(resolve(folder))
      if (project) {
        candidates.push(resolve(project, '03-mod'))
        candidates.push(resolve(project))
      }
      let target = ''
      for (const candidate of candidates) {
        if (await isDir(candidate)) { target = candidate; break }
      }
      if (!target) throw new Error('文件夹还没建好')
      await openExplorer(target)
      sendJson(res, 200, { ok: true, path: target })
      return
    }
    const file = typeof payload.path === 'string' ? resolve(payload.path.trim()) : ''
    if (!file || !/\.blend$/i.test(file)) throw new Error('只打开 .blend 文件')
    if (!/^[A-Za-z]:[\\/]/.test(file) && !file.startsWith('\\\\')) throw new Error('要绝对路径')
    if (/["\r\n]/.test(payload.path || '')) throw new Error('路径里有打不开的字符')
    if (!(await isFile(file))) throw new Error('文件不存在')
    const blender = typeof payload.blender === 'string' ? payload.blender.trim() : ''
    if (blender) {
      if (!/\.exe$/i.test(blender) || !(await isFile(blender))) throw new Error('环境设置里的 Blender 程序找不到')
      await launch(blender, [file])
    } else {
      await launch('cmd.exe', ['/d', '/c', 'start', '', file], { windowsHide: true })
    }
    sendJson(res, 200, { ok: true })
  })

  route('/preview', 'GET', async (req, res, url) => {
    const id = url.searchParams.get('job') || ''
    const part = url.searchParams.get('part') || ''
    const stage = url.searchParams.get('stage') || ''
    const job = JOB_ID.test(id) ? jobs.get(id) : undefined
    const item = job && job.items[part + ':' + stage]
    if (!item || !item.preview) {
      sendJson(res, 404, { ok: false, error: { message: '还没有这张预览图' } })
      return
    }
    const data = await readFile(item.preview)
    const lower = item.preview.toLowerCase()
    const type = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : lower.endsWith('.webp') ? 'image/webp' : 'image/png'
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(data)
  })

  return () => {}
}
