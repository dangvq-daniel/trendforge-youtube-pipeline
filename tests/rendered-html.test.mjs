import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete TrendForge product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TrendForge — YouTube Trending Data Pipeline<\/title>/i);
  assert.match(html, /From viral signals/);
  assert.match(html, /Trace every signal, service, and decision/);
  assert.match(html, /Bronze layer/);
  assert.match(html, /Silver layer/);
  assert.match(html, /Data quality gate/);
  assert.match(html, /trending_analytics/);
  assert.match(html, /channel_analytics/);
  assert.match(html, /category_analytics/);
  assert.match(html, /Three marts\. One view of attention\./);
  assert.match(html, /aria-label="Regional chart metric"/);
  assert.match(html, /aria-label="Sort channels"/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("ships product metadata, responsive styles, and the Gold query contract", async () => {
  const [page, layout, css, packageJson, query] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../data/dashboard.sql", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /TrendForge — YouTube Trending Data Pipeline/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /\/og\.png/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.pipeline-diagram/);
  assert.match(css, /\.analytics-kpis/);
  assert.match(query, /weighted_engagement_rate/);
  assert.match(query, /rank_in_region/);
  assert.match(query, /period_view_share_pct/);

  await access(new URL("../public/og.png", import.meta.url));
});
