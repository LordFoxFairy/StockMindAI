/**
 * 自动截图脚本 — 使用 Playwright 截取各模块页面
 * 用法: bun scripts/screenshot.ts
 * 前提: dev server 已在 localhost:3134 运行
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = 'http://localhost:3134';
const OUTPUT_DIR = join(import.meta.dir, '..', 'docs', 'assets');

// 模块导航点击顺序（侧栏按钮 title 属性值）→ tab 按钮文本
interface ScreenshotTask {
  name: string;        // 输出文件名（不含扩展名）
  module: string;      // 侧栏按钮 title
  tab?: string;        // header tab 按钮文本（可选，默认第一个）
  waitMs?: number;     // 额外等待毫秒
  darkMode?: boolean;  // 是否截暗色模式
}

const TASKS: ScreenshotTask[] = [
  // 亮色模式
  { name: 'market-chart', module: '行情中心', tab: '图表' },
  { name: 'market-watchlist', module: '行情中心', tab: '行情', waitMs: 2000 },
  { name: 'quant-strategy', module: '量化分析', tab: '量化', waitMs: 1500 },
  { name: 'quant-backtest', module: '量化分析', tab: '回测', waitMs: 1500 },
  { name: 'quant-lab', module: '量化分析', tab: '实验室' },
  { name: 'ai-insight-cards', module: 'AI洞察', tab: 'AI卡片' },
  { name: 'ai-predict', module: 'AI洞察', tab: '预测' },
  { name: 'compare', module: '多股对比', tab: '对比' },
  { name: 'portfolio-optimize', module: '组合优化', tab: '组合优化' },
  { name: 'portfolio-factor', module: '组合优化', tab: '因子分析' },
  // 暗色模式（关键页面）
  { name: 'dark-market-chart', module: '行情中心', tab: '图表', darkMode: true },
  { name: 'dark-ai-insight', module: 'AI洞察', tab: 'AI卡片', darkMode: true },
  { name: 'dark-quant-backtest', module: '量化分析', tab: '回测', darkMode: true, waitMs: 1500 },
];

async function run() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2, // Retina quality
  });
  const page = await context.newPage();

  // Load page
  console.log('Loading page...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  let currentDarkMode = false;

  for (const task of TASKS) {
    console.log(`Screenshot: ${task.name}...`);

    // Toggle dark mode if needed
    if (task.darkMode && !currentDarkMode) {
      // Click theme toggle button in header
      const themeBtn = page.locator('header button[aria-label="Toggle theme"]');
      if (await themeBtn.count() > 0) {
        await themeBtn.click();
        await page.waitForTimeout(500);
        currentDarkMode = true;
      }
    } else if (!task.darkMode && currentDarkMode) {
      const themeBtn = page.locator('header button[aria-label="Toggle theme"]');
      if (await themeBtn.count() > 0) {
        await themeBtn.click();
        await page.waitForTimeout(500);
        currentDarkMode = false;
      }
    }

    // Click sidebar module button by title
    const moduleBtn = page.locator(`aside button[title="${task.module}"]`);
    if (await moduleBtn.count() > 0) {
      await moduleBtn.click();
      await page.waitForTimeout(500);
    } else {
      console.warn(`  Module button "${task.module}" not found, skipping`);
      continue;
    }

    // Click tab if specified
    if (task.tab) {
      // Find tab button in header that matches text
      const tabBtn = page.locator(`header button`).filter({ hasText: task.tab });
      if (await tabBtn.count() > 0) {
        await tabBtn.first().click();
        await page.waitForTimeout(500);
      }
    }

    // Extra wait for data loading
    if (task.waitMs) {
      await page.waitForTimeout(task.waitMs);
    }

    // Take screenshot
    const filePath = join(OUTPUT_DIR, `${task.name}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    console.log(`  Saved: ${filePath}`);
  }

  await browser.close();
  console.log(`\nDone! ${TASKS.length} screenshots saved to ${OUTPUT_DIR}`);
}

run().catch((err) => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
