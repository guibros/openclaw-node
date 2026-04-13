#!/usr/bin/env node
/**
 * web-fetch.mjs — Playwright-based web fetcher
 *
 * Renders JS-heavy pages and returns clean text/HTML.
 * Fallback for when WebFetch gets blocked by anti-bot or JS rendering.
 *
 * Usage:
 *   node bin/web-fetch.mjs <url>                    # returns text content
 *   node bin/web-fetch.mjs <url> --html             # returns raw HTML
 *   node bin/web-fetch.mjs <url> --selector "article"  # extract specific element
 *   node bin/web-fetch.mjs <url> --wait 5000        # custom wait (ms)
 *   node bin/web-fetch.mjs <url> --screenshot out.png  # save screenshot
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--'));

if (!url) {
  console.error('Usage: web-fetch.mjs <url> [--html] [--selector "css"] [--wait ms] [--screenshot file]');
  process.exit(1);
}

const flags = {
  html: args.includes('--html'),
  selector: null,
  wait: 3000,
  screenshot: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--selector' && args[i + 1]) flags.selector = args[++i];
  if (args[i] === '--wait' && args[i + 1]) flags.wait = parseInt(args[++i], 10);
  if (args[i] === '--screenshot' && args[i + 1]) flags.screenshot = args[++i];
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  if (flags.wait > 0) {
    await page.waitForTimeout(flags.wait);
  }

  if (flags.screenshot) {
    await page.screenshot({ path: flags.screenshot, fullPage: true });
    console.error(`Screenshot saved: ${flags.screenshot}`);
  }

  if (flags.selector) {
    const el = await page.$(flags.selector);
    if (!el) {
      console.error(`Selector "${flags.selector}" not found`);
      process.exit(1);
    }
    console.log(flags.html ? await el.innerHTML() : await el.innerText());
  } else {
    console.log(flags.html ? await page.content() : await page.innerText('body'));
  }
} finally {
  await browser.close();
}
