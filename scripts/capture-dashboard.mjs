/**
 * Captures the public PostHog dashboard for Wit as a PNG for the profile README.
 * GitHub strips iframes from Markdown, so a scheduled workflow runs this and
 * commits the image instead (.github/workflows/refresh-dashboard.yml).
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

/** Shared dashboard, the same URL the PostHog embed snippet points at. */
const DASHBOARD_URL = 'https://eu.posthog.com/embedded/5xk8HbhfujNwv4yrFYyjGUvrKXWOgg';

/**
 * How many tiles to keep at least, counted in dashboard order. Any other tile
 * that starts above the bottom of those is kept whole too, so rearranging the
 * dashboard never leaves a tile cut in half.
 */
const TILE_COUNT = 4;

/** Page width in CSS pixels; the image is captured at twice that for sharp text. */
const WIDTH = 880;

const OUTPUT_DIR = new URL('../assets/', import.meta.url);

/** The embed only has a light theme, so one image serves both GitHub themes. */
const OUTPUT_FILE = new URL('wit-dashboard.png', OUTPUT_DIR);

/**
 * Loads the dashboard and saves its first tiles.
 * Throws when the tiles have no data, so a broken page never replaces a good image.
 */
async function capture(browser) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 1000 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: 60_000 });

  const tiles = page.locator('.InsightCard');
  await tiles.nth(TILE_COUNT - 1).waitFor({ timeout: 30_000 });
  await page.locator('.InsightCard canvas').first().waitFor({ timeout: 30_000 });
  /** Charts animate in after their data arrives. */
  await page.waitForTimeout(3_000);

  const text = (await tiles.allInnerTexts()).join(' ').replace(/\s+/g, ' ');
  if (!/\d{1,3}(,\d{3})+/.test(text)) {
    throw new Error(`No numbers on the dashboard, refusing to capture: "${text.slice(0, 120)}"`);
  }

  const boxes = await tiles.evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
    }),
  );
  const top = Math.min(...boxes.slice(0, TILE_COUNT).map((box) => box.top));
  let bottom = Math.max(...boxes.slice(0, TILE_COUNT).map((box) => box.bottom));
  for (let grown = true; grown; ) {
    grown = false;
    for (const box of boxes) {
      if (box.top < bottom && box.bottom > bottom) {
        bottom = box.bottom;
        grown = true;
      }
    }
  }
  const margin = 8;
  const clip = { x: 0, y: Math.max(0, top - margin), width: WIDTH, height: bottom - top + margin * 2 };

  await page.screenshot({ path: OUTPUT_FILE.pathname, clip, fullPage: true });
  await context.close();
  return OUTPUT_FILE.pathname;
}

await mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  console.log(`Saved ${await capture(browser)}`);
} finally {
  await browser.close();
}
