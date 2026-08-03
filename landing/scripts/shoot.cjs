// Capture a full-page screenshot of the running dev server.
// Usage: node scripts/shoot.cjs
const { chromium } = require('/Users/lakshaymalhotra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core')
const { execSync } = require('child_process')

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Users/lakshaymalhotra/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  })
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(4500)

  const positions = await page.evaluate(() => {
    const map = {}
    for (const id of ['live', 'signals', 'pipeline', 'pricing', 'docs', 'cta']) {
      const el = document.getElementById(id)
      if (el) map[id] = el.getBoundingClientRect().top + window.scrollY
    }
    return map
  })
  console.log('POS:', JSON.stringify(positions))

  // Hero
  await page.screenshot({ path: 'shots/hero.png', fullPage: false })

  // Problem section
  await page.evaluate(() => window.scrollTo({ top: 1100, behavior: 'instant' }))
  await page.waitForTimeout(900)
  await page.screenshot({ path: 'shots/problem.png', fullPage: false })

  // Showcase (scroll to start of pinned section)
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), positions.signals)
  await page.waitForTimeout(900)
  await page.screenshot({ path: 'shots/showcase.png', fullPage: false })

  // Use cases — past the showcase
  await page.evaluate(() => window.scrollTo({ top: 12400, behavior: 'instant' }))
  await page.waitForTimeout(1800)
  await page.screenshot({ path: 'shots/usecases.png', fullPage: false })

  // Architecture
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), positions.pipeline)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: 'shots/architecture.png', fullPage: false })

  // Testimonials
  await page.evaluate(() => window.scrollTo({ top: 16725, behavior: 'instant' }))
  await page.waitForTimeout(1800)
  await page.screenshot({ path: 'shots/testimonials.png', fullPage: false })

  // Pricing
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), positions.pricing)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: 'shots/pricing.png', fullPage: false })

  // FAQ
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), positions.docs)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: 'shots/faq.png', fullPage: false })

  // Final CTA
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), positions.cta)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: 'shots/cta.png', fullPage: false })

  // Full page (capped)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'shots/full.png', fullPage: true })

  await browser.close()
  console.log('OK')
})()