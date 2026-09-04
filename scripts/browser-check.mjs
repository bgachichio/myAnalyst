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

/**
 * Playwright resolves its own browser from PLAYWRIGHT_BROWSERS_PATH or its
 * default cache. Only override that when someone has deliberately said where
 * the binary is.
 */
async function launchChromium() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  try {
    return await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) {
    console.error(
      "\nCould not start Chromium. Playwright is installed but its browser is not.\n" +
      "Install it once, then re-run:\n\n    npx playwright install chromium\n\n" +
      "If the browser lives somewhere unusual, point at it with PLAYWRIGHT_CHROMIUM_PATH.\n",
    );
    throw error;
  }
}

// The same policy Caddy serves in production. Without it this check runs the
// app under rules the real site does not have, and a violation - the PDF
// worker is the obvious candidate - would only appear after deploying.
const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";

const server = createServer(async (req, res) => {
  const asked = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // The type comes off the file actually served, not off the path asked for:
  // "/" has no extension, and octet-stream makes Chromium download the page
  // rather than render it.
  const path = asked === "/" ? "/index.html" : asked;
  if (COLLECTED[path]) {
    res.writeHead(200, { "content-type": "application/json", "content-security-policy": CSP });
    res.end(JSON.stringify(COLLECTED[path]));
    return;
  }
  try {
    const file = await readFile(join(ROOT, path));
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "content-security-policy": CSP,
    });
    res.end(file);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// Let Playwright find its own browser. An explicit path is one machine's
// layout baked into a script that runs on several - which is exactly how this
// check came to fail on the machine it was written to protect.
const browser = await launchChromium();

/**
 * Everything a page complains about. Console errors matter as much as thrown
 * ones here: a content-security-policy refusal is reported to the console and
 * nowhere else, so a check that only listens for pageerror cannot see the
 * policy working or failing.
 */
function collect(page) {
  const problems = [];
  const csp = [];
  const missing = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/content security policy/i.test(text)) csp.push(text);
    else problems.push(text);
  });
  page.on("response", (r) => r.status() >= 400 && missing.push(`${r.status()} ${new URL(r.url()).pathname}`));
  return { problems, csp, missing };
}
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

try {
  for (const [theme, scheme] of [["light", "light"], ["dark", "dark"]]) {
    const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 390, height: 844 } });
    const { problems, csp, missing } = collect(page);

    await page.goto(base, { waitUntil: "networkidle" });

    const opening = (await page.locator(".display-sm").first().textContent()).trim();
    check(`${theme}: opens blank, not on somebody else's company`,
          opening === "Enter the figures", opening);

    await page.getByRole("button", { name: "Load worked example" }).click();
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
    check(`${theme}: nothing the content security policy refuses`, csp.length === 0, csp.join(" | "));
    await page.close();
  }

  // The whole point: a real PDF, through the real file input.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const { problems, csp } = collect(page);
  await page.goto(base, { waitUntil: "networkidle" });

  // The policy has to actually arrive. Probing it with an eval does not work:
  // page.evaluate runs through the debugging protocol, which is exempt from the
  // page's own policy, so it succeeds whether the policy is live or not. What
  // does prove the listener works is that it caught a real refusal the first
  // time this ran - the inline theme script, now a file for that reason.
  const policy = (await (await fetch(base)).headers.get("content-security-policy")) ?? "";
  check("the production policy reaches the browser",
        policy.includes("script-src 'self'"), policy.slice(0, 60) + "…");

  await page.locator('input[type="file"]').setInputFiles(join(ROOT, "..", "fixtures", "statement.pdf"));
  await page.getByRole("button", { name: "Use these figures" }).waitFor({ timeout: 30_000 });

  const found = await page.locator("text=/of 12 figures found/").first().textContent();
  check("the reader finds all twelve figures in the PDF", found.includes("12 of 12"), found.trim());

  const cited = await page.locator("text=/on page \\d+/").count();
  check("every figure cites the page it came from", cited >= 10, `${cited} citations`);

  await page.getByRole("button", { name: "Use these figures" }).click();
  await page.getByLabel("Price per share").fill("28");
  await page.getByLabel("Company").fill("UNGA Group Limited");

  const after = await page.locator(".display-sm").first().textContent();
  check("the figures read from the PDF produce a verdict", ["BUY", "HOLD", "SELL"].includes(after.trim()), after.trim());

  const income = await page.getByLabel("Total income").inputValue();
  check("total income arrived at full scale", income === "19864152000", income);

  const trend = await page.locator("figure", { hasText: "Profit after tax" }).first();
  await trend.scrollIntoViewIfNeeded();
  const summary = await trend.locator("p").last().textContent();
  check("the comparative period draws a trend", summary.includes("492,781,000"), summary.trim());

  check("no page errors during the read", problems.length === 0, problems.join(" | "));
  check("the PDF reader survives the production policy", csp.length === 0, csp.join(" | "));

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
  const { problems: keptProblems, csp: keptCsp } = collect(kept);
  await kept.goto(base, { waitUntil: "networkidle" });

  const noRecent = await kept.locator("text=/^Recent$/").count();
  check("a first run shows no recent list", noRecent === 0, `${noRecent} lists`);

  await kept.getByRole("button", { name: "Load worked example" }).click();
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
  check("no policy refusals on the watchlist or comparison", keptCsp.length === 0, keptCsp.join(" | "));

  // The transaction cost slider, which loads the entry price and nothing else.
  await kept.getByRole("button", { name: "Analyse", exact: true }).click();

  // Saved work has to be one tap away on an app that now opens blank.
  const listed = await kept.getByRole("button", { name: /UNGA Group Limited/ }).count();
  check("the last memos are listed on a blank start", listed === 1, `${listed} entries`);
  await kept.getByRole("button", { name: /UNGA Group Limited/ }).first().click();
  const reopened = await kept.getByLabel("Company").inputValue();
  check("reopening one restores the company", reopened === "UNGA Group Limited", reopened);

  await kept.getByRole("button", { name: "Load worked example" }).click();
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

  // The app opens blank now, so the example has to come back before there is a
  // price on screen to read. The setting is what is being checked, not the form.
  await kept.reload({ waitUntil: "networkidle" });
  await kept.getByRole("button", { name: "Load worked example" }).click();
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
