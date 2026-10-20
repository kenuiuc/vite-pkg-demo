import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const distDir = path.join(root, 'dist')
const apiDir = process.env.DEMO_API_DIR || path.resolve(root, '../vite-pkg-demo-api')
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome'

const ENVS = [
  { name: 'local', sitePort: 5200, apiPort: 4000, title: 'Vite Package Once Demo (local)' },
  { name: 'sit', sitePort: 5201, apiPort: 4001, title: 'Vite Package Once Demo (SIT)' },
  { name: 'uat', sitePort: 5202, apiPort: 4002, title: 'Vite Package Once Demo (UAT)' },
  { name: 'prod', sitePort: 5203, apiPort: 4003, title: 'Vite Package Once Demo (PROD)' }
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function startStaticServer(dir, port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    let filePath = path.join(dir, decodeURIComponent(url.pathname))

    // SPA 路由回退
    if (url.pathname === '/' || !path.extname(url.pathname)) {
      filePath = path.join(dir, 'index.html')
    }

    try {
      const data = await readFile(filePath)
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      })
      res.end(data)
    } catch {
      try {
        const html = await readFile(path.join(dir, 'index.html'))
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('not found')
      }
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function waitForReady(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('Backend did not become ready in time')), timeoutMs)

    const onExit = (code) => {
      clearTimeout(timer)
      reject(new Error(`Backend exited before ready (code ${code})`))
    }
    child.once('exit', onExit)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      buffer += text
      process.stdout.write(`[api] ${text}`)
      if (buffer.includes('READY')) {
        clearTimeout(timer)
        child.off('exit', onExit)
        resolve()
      }
    })

    child.stdout.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function main() {
  assert(existsSync(path.join(distDir, 'index.html')), 'dist/index.html not found. Run `pnpm build` first.')
  assert(existsSync(apiDir), `Backend repo not found: ${apiDir}. Set DEMO_API_DIR if needed.`)
  assert(existsSync(chromePath), `Chrome not found: ${chromePath}. Set CHROME_PATH if needed.`)

  const apiProcess = spawn(process.execPath, ['start-all.mjs'], {
    cwd: apiDir,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  apiProcess.stderr.on('data', (chunk) => process.stderr.write(`[api] ${chunk}`))

  const servers = []
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'vite-pkg-demo-'))

  try {
    await waitForReady(apiProcess)

    for (const env of ENVS) {
      const siteDir = path.join(tmpRoot, env.name)
      await cp(distDir, siteDir, { recursive: true })
      await cp(path.join(root, 'deploy', `config.${env.name}.js`), path.join(siteDir, 'config.js'))
      servers.push(await startStaticServer(siteDir, env.sitePort))

      const page = await browser.newPage()
      const pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(String(error)))

      await page.goto(`http://localhost:${env.sitePort}/`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(
        () => {
          const element = document.querySelector('[data-testid="api-env"]')
          return element && element.textContent && element.textContent.trim().length > 0
        },
        undefined,
        { timeout: 10000 }
      )

      const title = await page.title()
      const envName = ((await page.textContent('[data-testid="env-name"]')) || '').trim()
      const apiEnv = ((await page.textContent('[data-testid="api-env"]')) || '').trim()
      const apiBase = ((await page.textContent('[data-testid="api-base"]')) || '').trim()
      const runtimeConfig = await page.evaluate(() => window.__APP_CONFIG__)

      assert(title === env.title, `${env.name}: unexpected title "${title}"`)
      assert(envName === env.name, `${env.name}: unexpected frontend env "${envName}"`)
      assert(apiEnv === env.name, `${env.name}: backend returned env "${apiEnv}"`)
      assert(apiBase === `http://localhost:${env.apiPort}/api`, `${env.name}: unexpected apiBase "${apiBase}"`)
      assert(runtimeConfig?.VITE_ENV_NAME === env.name, `${env.name}: window.__APP_CONFIG__ not loaded`)
      assert(pageErrors.length === 0, `${env.name}: page errors: ${pageErrors.join('; ')}`)

      console.log(`PASS ${env.name}: title="${title}", backend=${apiEnv}, apiBase=${apiBase}`)
      await page.close()
    }

    console.log('E2E PASS')
  } finally {
    await browser.close()
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    apiProcess.kill('SIGTERM')
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`E2E FAIL: ${error.message}`)
  process.exit(1)
})
