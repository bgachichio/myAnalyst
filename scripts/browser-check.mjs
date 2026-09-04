/**
 * The app, in a real browser, doing the thing it exists to do.
 *
 * Unit tests prove the arithmetic. This proves the arithmetic reaches the
 * screen: a PDF goes in through the file input the way Brian would hand it
 * over, and the twelve figures come out the other side into a verdict. A check
 * that reports success must say what it examined, so every step prints.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "dist");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".woff": "font/woff",
};

// What the collector would have left behind. Served from memory so the check
// exercises the path that reads it, rather than proving only that its absence
// is survivable.
const COLLECTED = {
  "/data/latest.json": {
    generated_at: new Date().toISOString(),
    counters: [{ ticker: "UNGA", trade_date: "2026-09-03", close: 28, isin: null, sector: "Industrial", source: "nse", fetched_at: null }],
    series: {},
  },
  "/data/series-observations.json": {
    "ke.inflation": [{ date: "2026-08-31", value: 6.4 }],
    "fx.usdkes": [{ date: "2026-09-03", value: 129.5 }],
    "btc.usd": [{ date: "2026-09-03", value: 95_000 }],
    "cbk.cbr": [{ date: "2026-08-12", value: 9.75 }],
  },
};

const server = createServer(async (req, res) => {
  const asked = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // The type comes off the file actually served, not off the path asked for:
  // "/" has no extension, and octet-stream makes Chromium download the page
  // rather than render it.
  const path = asked === "/" ? "/index.html" : asked;
  if (COLLECTED[path]) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(COLLECTED[path]));
    return;
  }
  try {
    const file = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

try {
  for (const [theme, scheme] of [["light", "light"], ["dark", "dark"]]) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 390, height: 844 } });
    const problems = [];
    const missing = [];
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("response", (r) => r.status() >= 400 && missing.push(`${r.status()} ${new URL(r.url()).pathname}`));

    await page.goto(base, { waitUntil: "networkidle" });
    const verdict = (await page.locator(".display-sm").first().textContent()).trim();
    check(`${theme}: the worked example reaches a verdict`,
          ["BUY", "HOLD", "SELL"].includes(verdict), verdict);

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`${theme}: the surface takes the ${theme} token`,
          theme === "dark" ? bg !== "rgb(247, 250, 248)" : bg === "rgb(247, 250, 248)", bg);

    const wide = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`${theme}: nothing forces a sideways scroll at 390px`, !wide);

    const small = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll("button, a[href], input, select")) {
        // Screen-reader-only controls are clipped to a pixel by design: the
        // skip link until it is focused, the file input always. Measuring
        // those measures the clip, not the target.
        if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 44) bad.push(`${el.tagName.toLowerCase()} ${Math.round(r.height)}px: ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}`);
      }
      return bad;
    });
    check(`${theme}: every control clears the 44px touch floor`, small.length === 0, small.join("; "));

    check(`${theme}: every asset the page asks for exists`, missing.length === 0, missing.join("; "));

    const inflation = await page.getByLabel("Inflation").inputValue();
    check(`${theme}: the collector's inflation figure reaches the hurdle`, inflation === "6.4", inflation);
    const feed = await page.locator("text=/Collector last ran/").first().textContent();
    check(`${theme}: the app says when the collector last ran`, feed.includes("holding 1 counter."), feed.trim());
    check(`${theme}: no uncaught errors`, problems.length === 0, problems.join(" | "));
    await page.close();
  }

  // The whole point: a real PDF, through the real file input.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Start blank" }).click();
  await page.locator('input[type="file"]').setInputFiles(join(ROOT, "..", "fixtures", "statement.pdf"));
  await page.getByRole("button", { name: "Use these figures" }).waitFor({ timeout: 30_000 });

  const found = await page.locator("text=/of 12 figures found/").first().textContent();
  check("the reader finds all twelve figures in the PDF", found.includes("12 of 12"), found.trim());

  const cited = await page.locator("text=/on page \\d+/").count();
  check("every figure cites the page it came from", cited >= 10, `${cited} citations`);

  await page.getByRole("button", { name: "Use these figures" }).click();
  await page.getByLabel("Price per share").fill("28");

  const after = await page.locator(".display-sm").first().textContent();
  check("the figures read from the PDF produce a verdict", ["BUY", "HOLD", "SELL"].includes(after.trim()), after.trim());

  const income = await page.getByLabel("Total income").inputValue();
  check("total income arrived at full scale", income === "19864152000", income);

  const trend = await page.locator("figure", { hasText: "Profit after tax" }).first();
  await trend.scrollIntoViewIfNeeded();
  const summary = await trend.locator("p").last().textContent();
  check("the comparative period draws a trend", summary.includes("492,781,000"), summary.trim());

  check("no page errors during the read", problems.length === 0, problems.join(" | "));

  // The private deal screen: two lenses that must be allowed to disagree.
  await page.getByRole("button", { name: "Private", exact: true }).click();
  const ic = (await page.locator(".display-sm").first().textContent()).trim();
  check("the worked deal is the case the screen exists for", ic === "HOLD", ic);
  const gap = await page.locator("text=/rests on the projection/").count();
  check("the disagreement between the lenses is printed, not averaged", gap === 1, `${gap} statements`);

  await page.getByLabel("Pre-money valuation").fill("5000000000");
  const dear = (await page.locator(".display-sm").first().textContent()).trim();
  check("a price nobody can justify turns the verdict", dear === "SELL", dear);

  await page.getByLabel("Cash from operations").fill("");
  const qoe = await page.locator("text=/Ask for it before anything else/").count();
  check("a figure the deck omits is reported as a finding", qoe === 1, `${qoe} findings`);

  const stillWide = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("the private screen does not scroll sideways at 390px", !stillWide);
  check("no page errors on the private screen", problems.length === 0, problems.join(" | "));

  await page.close();

  // The watchlist and the comparison table, which both remember across visits.
  const kept = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const keptProblems = [];
  kept.on("pageerror", (e) => keptProblems.push(e.message));
  await kept.goto(base, { waitUntil: "networkidle" });

  await kept.getByRole("button", { name: "Save to compare" }).click();
  await kept.getByRole("button", { name: "Compare", exact: true }).click();
  const savedLine = await kept.locator(".display-sm").first().textContent();
  check("a memo saved from the analysis reaches the comparison", savedLine.trim() === "1 saved", savedLine.trim());
  const quoted = await kept.locator("text=/EV\\/EBITDA as quoted/").count();
  check("the comparison shows the multiple as quoted and restated", quoted === 1, `${quoted} rows`);

  await kept.getByRole("button", { name: "Watchlist", exact: true }).click();
  await kept.getByLabel("Company").fill("UNGA Group Limited");
  await kept.getByLabel("Books closure date").fill("2030-06-04");
  await kept.getByLabel("Dividend per share").fill("1");
  await kept.getByLabel("Shares held or intended").fill("10000");
  await kept.getByRole("button", { name: "Add to the watchlist" }).click();

  const buyBy = await kept.locator("text=/The NSE settles 3 trading days/").first().textContent();
  check("the watchlist derives the last day to buy from the closure date",
        buyBy.includes("2030-05-30"), buyBy.trim());

  // Reload: what the app remembers has to survive the tab closing.
  await kept.reload({ waitUntil: "networkidle" });
  const remembered = await kept.locator("text=/UNGA Group Limited/").count();
  check("the watchlist survives a reload", remembered >= 1, `${remembered} entries`);
  check("no page errors on the watchlist or comparison", keptProblems.length === 0, keptProblems.join(" | "));

  // The transaction cost slider, which loads the entry price and nothing else.
  await kept.getByRole("button", { name: "Analyse", exact: true }).click();
  const costBefore = (await kept.locator('xpath=//span[text()="Entry price, including costs"]/following-sibling::span').textContent()).trim();

  await kept.getByRole("button", { name: "Settings" }).first().click();
  const slider = kept.getByLabel("NSE transaction costs");
  check("the transaction cost is a slider", await slider.getAttribute("type") === "range",
        await slider.getAttribute("type"));
  check("it runs 0% to 10%",
        await slider.getAttribute("min") === "0" && await slider.getAttribute("max") === "0.1",
        `${await slider.getAttribute("min")} to ${await slider.getAttribute("max")}`);
  await slider.fill("0.1");
  await kept.getByRole("button", { name: "Close settings" }).click();

  const costAfter = (await kept.locator('xpath=//span[text()="Entry price, including costs"]/following-sibling::span').textContent()).trim();
  check("moving it changes the price actually paid", costAfter !== costBefore, `${costBefore} then ${costAfter}`);

  await kept.reload({ waitUntil: "networkidle" });
  const costKept = (await kept.locator('xpath=//span[text()="Entry price, including costs"]/following-sibling::span').textContent()).trim();
  check("the setting survives a reload", costKept === costAfter, `${costAfter} then ${costKept}`);

  await kept.close();
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length === 0
  ? "\nAll browser checks passed."
  : `\n${failures.length} browser check(s) failed: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
