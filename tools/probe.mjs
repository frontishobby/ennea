/**
 * 브라우저 확인용 최소 도구. 시스템 Chrome 을 헤드리스로 띄워 스크린샷과
 * 콘솔 오류를 뽑는다. Playwright MCP 가 자주 끊겨서 직접 둔다.
 *
 *   node tools/probe.mjs <url> [출력폴더] [키1,키2,...]
 *   node tools/probe.mjs http://localhost:5173/ /tmp/shots Enter
 *
 * 키를 주면 한 번에 하나씩 누르며 단계마다 스크린샷을 남긴다.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [url, outDir = '/tmp/ennea-probe', keys = ''] = process.argv.slice(2)
if (!url) {
  console.error('사용법: node tools/probe.mjs <url> [출력폴더] [키1,키2,...]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  // 미리듣기·게임 오디오가 제스처 없이도 돌게 한다. 소리는 끈다.
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const problems = []
page.on('pageerror', (e) => problems.push('PAGEERROR: ' + e.message))
page.on('console', (m) => m.type() === 'error' && problems.push('CONSOLE: ' + m.text()))
page.on('requestfailed', (r) => problems.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText ?? '')))

const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` })
  console.log(`  ${outDir}/${name}.png`)
}

await page.goto(url, { waitUntil: 'networkidle' })
await shot('00-load')
let n = 1
for (const key of keys.split(',').filter(Boolean)) {
  await page.keyboard.press(key)
  await page.waitForTimeout(1500)
  await shot(`${String(n++).padStart(2, '0')}-${key}`)
}

console.log(`\n문제 ${problems.length}건`)
for (const p of problems.slice(0, 20)) console.log('  ' + p)
await browser.close()
process.exit(problems.length ? 1 : 0)
