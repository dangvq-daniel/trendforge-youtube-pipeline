"use client";

import { useMemo, useState, type CSSProperties } from "react";

const pipelineStages = [
  {
    id: "bronze",
    number: "01",
    name: "Bronze",
    eyebrow: "Raw capture",
    service: "Amazon S3",
    metric: "52 objects",
    detail:
      "YouTube API payloads and the Kaggle archive land unchanged, partitioned by region and ingestion time.",
    artifact: "545.3 MB retained",
  },
  {
    id: "silver",
    number: "02",
    name: "Silver",
    eyebrow: "Clean & typed",
    service: "AWS Glue + Lambda",
    metric: "68 objects",
    detail:
      "Schema-aware transforms normalize dates, enrich categories, and convert the raw layer to compressed Parquet.",
    artifact: "100.8 MB optimized",
  },
  {
    id: "quality",
    number: "03",
    name: "Quality gate",
    eyebrow: "Trust before scale",
    service: "Lambda + SNS",
    metric: "Passed",
    detail:
      "Validation checks completeness, validity, and freshness before downstream business aggregates are allowed to run.",
    artifact: "0 failed checks",
  },
  {
    id: "gold",
    number: "04",
    name: "Gold",
    eyebrow: "Decision ready",
    service: "AWS Glue + Athena",
    metric: "3 marts",
    detail:
      "Trending, channel, and category analytics are materialized for fast exploration in Athena and dashboards.",
    artifact: "108 Parquet objects",
  },
];

const regionData = [
  {
    code: "IN",
    name: "India",
    views: 124.8,
    observations: 129832,
    engagement: 2.58,
    topChannel: "T-Series",
  },
  {
    code: "GB",
    name: "United Kingdom",
    views: 21.4,
    observations: 9740,
    engagement: 4.04,
    topChannel: "xxxtentacion",
  },
  {
    code: "US",
    name: "United States",
    views: 11.9,
    observations: 7620,
    engagement: 3.37,
    topChannel: "Marvel Entertainment",
  },
  {
    code: "CA",
    name: "Canada",
    views: 7.7,
    observations: 11012,
    engagement: 2.99,
    topChannel: "Entertainment",
  },
];

const channels = [
  { name: "T-Series", region: "IN", views: "6.31B", appearances: 688 },
  { name: "xxxtentacion", region: "GB", views: "4.21B", appearances: 88 },
  { name: "Marvel Entertainment", region: "IN", views: "4.07B", appearances: 196 },
  { name: "FoxStarHindi", region: "IN", views: "3.21B", appearances: 152 },
  { name: "Amit Bhadana", region: "IN", views: "3.06B", appearances: 428 },
];

const categories = [
  { name: "Entertainment", share: 35.2, color: "var(--coral)" },
  { name: "Music", share: 25.9, color: "var(--gold)" },
  { name: "Film & Animation", share: 9.2, color: "var(--sage)" },
  { name: "Comedy", share: 7.1, color: "var(--bronze)" },
  { name: "People & Blogs", share: 7.1, color: "var(--ink-soft)" },
  { name: "News & Politics", share: 4.2, color: "var(--blue)" },
  { name: "Other", share: 11.3, color: "var(--line-strong)" },
];

const compact = new Intl.NumberFormat("en", { notation: "compact" });

export default function Home() {
  const [activeStage, setActiveStage] = useState("bronze");
  const [activeRegion, setActiveRegion] = useState("IN");

  const selectedStage = useMemo(
    () => pipelineStages.find((stage) => stage.id === activeStage) ?? pipelineStages[0],
    [activeStage],
  );
  const selectedRegion = useMemo(
    () => regionData.find((region) => region.code === activeRegion) ?? regionData[0],
    [activeRegion],
  );
  const maxViews = Math.max(...regionData.map((region) => region.views));

  return (
    <main>
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="wordmark" href="#top" aria-label="TrendForge home">
          <span className="wordmark-mark" aria-hidden="true">
            <span />
          </span>
          <span>TrendForge</span>
        </a>
        <div className="nav-links">
          <a href="#pipeline">Pipeline</a>
          <a href="#analytics">Analytics</a>
          <a href="#proof">Run proof</a>
        </div>
        <a className="nav-status" href="#proof">
          <span className="status-dot" aria-hidden="true" />
          Production healthy
        </a>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">
            <span>Live product demo</span>
            <span className="kicker-rule" />
            <span>us-east-1</span>
          </p>
          <h1>
            From viral signals
            <br />
            <em>to decisions.</em>
          </h1>
          <p className="hero-intro">
            A production data pipeline that refines raw YouTube activity into
            trusted, query-ready intelligence—automatically.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#analytics">
              Explore the data
              <span aria-hidden="true">↘</span>
            </a>
            <a className="button button-secondary" href="#pipeline">
              Follow the pipeline
            </a>
          </div>
        </div>

        <aside className="run-card" id="proof" aria-label="Latest production run">
          <div className="run-card-head">
            <div>
              <p className="eyebrow">Latest production run</p>
              <h2>All stages cleared</h2>
            </div>
            <span className="health-badge">
              <span className="status-dot" aria-hidden="true" />
              Succeeded
            </span>
          </div>
          <ol className="run-timeline">
            <li>
              <span className="timeline-time">14:01</span>
              <span className="timeline-node" aria-hidden="true" />
              <span>
                <strong>Ingestion</strong>
                <small>YouTube API → Bronze</small>
              </span>
            </li>
            <li>
              <span className="timeline-time">14:07</span>
              <span className="timeline-node" aria-hidden="true" />
              <span>
                <strong>Silver ready</strong>
                <small>Glue transform · 5m 50s</small>
              </span>
            </li>
            <li>
              <span className="timeline-time">14:08</span>
              <span className="timeline-node" aria-hidden="true" />
              <span>
                <strong>Quality passed</strong>
                <small>Validation gate cleared</small>
              </span>
            </li>
            <li>
              <span className="timeline-time">14:10</span>
              <span className="timeline-node" aria-hidden="true" />
              <span>
                <strong>Gold published</strong>
                <small>3 analytics marts refreshed</small>
              </span>
            </li>
          </ol>
          <div className="run-card-foot">
            <span>
              <strong>08:21</strong>
              <small>total duration</small>
            </span>
            <span>
              <strong>3 / 3</strong>
              <small>recent runs passed</small>
            </span>
            <time dateTime="2026-07-18T18:10:05Z">Jul 18, 2026 · 18:10 UTC</time>
          </div>
        </aside>
      </section>

      <section className="snapshot-band" aria-label="Production snapshot">
        <div>
          <strong>158,204</strong>
          <span>trending observations</span>
        </div>
        <div>
          <strong>165.7B</strong>
          <span>views represented</span>
        </div>
        <div>
          <strong>4</strong>
          <span>active Gold regions</span>
        </div>
        <div>
          <strong>3</strong>
          <span>analytics marts</span>
        </div>
        <p>
          Production snapshot
          <br />
          <time dateTime="2026-07-18">18 Jul 2026</time>
        </p>
      </section>

      <section className="pipeline-section" id="pipeline">
        <header className="section-heading">
          <div>
            <p className="eyebrow">A visible path to trust</p>
            <h2>Every signal earns its way to Gold.</h2>
          </div>
          <p>
            Select a stage to see how the architecture changes raw activity into
            a compact analytical product.
          </p>
        </header>

        <div className="pipeline-shell">
          <div className="stage-track" role="group" aria-label="Pipeline stages">
            {pipelineStages.map((stage) => (
              <button
                className={`stage-button stage-${stage.id}`}
                type="button"
                key={stage.id}
                aria-pressed={activeStage === stage.id}
                onClick={() => setActiveStage(stage.id)}
              >
                <span className="stage-number">{stage.number}</span>
                <span className="stage-copy">
                  <small>{stage.eyebrow}</small>
                  <strong>{stage.name}</strong>
                  <em>{stage.metric}</em>
                </span>
                <span className="stage-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            ))}
          </div>

          <div className={`stage-detail detail-${selectedStage.id}`} aria-live="polite">
            <div>
              <p className="eyebrow">
                {selectedStage.number} · {selectedStage.service}
              </p>
              <h3>{selectedStage.name}</h3>
            </div>
            <p>{selectedStage.detail}</p>
            <div className="stage-proof">
              <span>
                <small>Current artifact</small>
                <strong>{selectedStage.artifact}</strong>
              </span>
              <span className="verified-mark" aria-label="Verified in AWS">
                ✓
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="analytics-section" id="analytics">
        <header className="section-heading analytics-heading">
          <div>
            <p className="eyebrow">Gold layer · Athena snapshot</p>
            <h2>The shape of attention.</h2>
          </div>
          <label className="region-control">
            <span>Spotlight region</span>
            <select
              value={activeRegion}
              onChange={(event) => setActiveRegion(event.target.value)}
            >
              {regionData.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className="analytics-grid">
          <article className="regional-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Views represented by region</p>
                <h3>Regional signal</h3>
              </div>
              <span className="unit-label">billions of views</span>
            </div>

            <div
              className="region-chart"
              role="img"
              aria-label="India 124.8 billion views, United Kingdom 21.4 billion, United States 11.9 billion, and Canada 7.7 billion"
            >
              {regionData.map((region) => (
                <button
                  type="button"
                  className="region-row"
                  key={region.code}
                  aria-pressed={activeRegion === region.code}
                  onClick={() => setActiveRegion(region.code)}
                >
                  <span className="region-code">{region.code}</span>
                  <span className="bar-rail">
                    <span
                      className="bar-fill"
                      style={{ "--bar-width": `${(region.views / maxViews) * 100}%` } as CSSProperties}
                    />
                  </span>
                  <strong>{region.views.toFixed(1)}B</strong>
                </button>
              ))}
            </div>

            <div className="region-spotlight" aria-live="polite">
              <div>
                <span className="spotlight-code">{selectedRegion.code}</span>
                <p>
                  <strong>{selectedRegion.name}</strong>
                  <small>Selected region</small>
                </p>
              </div>
              <dl>
                <div>
                  <dt>Observations</dt>
                  <dd>{compact.format(selectedRegion.observations)}</dd>
                </div>
                <div>
                  <dt>Avg. engagement</dt>
                  <dd>{selectedRegion.engagement.toFixed(2)}%</dd>
                </div>
                <div>
                  <dt>Top signal</dt>
                  <dd>{selectedRegion.topChannel}</dd>
                </div>
              </dl>
            </div>
          </article>

          <article className="category-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Share of represented views</p>
                <h3>Category gravity</h3>
              </div>
              <span className="unit-label">all active regions</span>
            </div>
            <div
              className="category-stack"
              role="img"
              aria-label="Entertainment 35.2 percent, Music 25.9 percent, Film and Animation 9.2 percent, Comedy 7.1 percent, People and Blogs 7.1 percent, News and Politics 4.2 percent, Other 11.3 percent"
            >
              {categories.map((category) => (
                <span
                  key={category.name}
                  style={
                    {
                      "--segment-size": category.share,
                      "--segment-color": category.color,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <ul className="category-list">
              {categories.slice(0, 6).map((category) => (
                <li key={category.name}>
                  <span
                    className="legend-dot"
                    style={{ "--dot-color": category.color } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span>{category.name}</span>
                  <strong>{category.share.toFixed(1)}%</strong>
                </li>
              ))}
            </ul>
            <p className="panel-note">
              Entertainment and music account for more than three-fifths of
              represented views in the latest deduplicated Gold snapshot.
            </p>
          </article>
        </div>

        <article className="channels-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Cross-region leaders</p>
              <h3>Channels with staying power</h3>
            </div>
            <span className="unit-label">deduplicated latest aggregates</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Channel</th>
                  <th>Region</th>
                  <th>Views</th>
                  <th>Trending appearances</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((channel, index) => (
                  <tr key={`${channel.name}-${channel.region}`}>
                    <td>{String(index + 1).padStart(2, "0")}</td>
                    <th scope="row">{channel.name}</th>
                    <td>
                      <span className="region-pill">{channel.region}</span>
                    </td>
                    <td>{channel.views}</td>
                    <td>{channel.appearances}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="architecture-proof">
        <div>
          <p className="eyebrow">Built on the deployed architecture</p>
          <h2>Ten AWS capabilities. One observable path.</h2>
        </div>
        <ul className="service-list" aria-label="AWS services used">
          {[
            "S3",
            "Lambda",
            "Glue",
            "Athena",
            "Step Functions",
            "SNS",
            "CloudWatch",
            "IAM",
            "EventBridge",
            "Data Catalog",
          ].map((service, index) => (
            <li key={service}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {service}
            </li>
          ))}
        </ul>
      </section>

      <footer>
        <a className="wordmark wordmark-footer" href="#top">
          <span className="wordmark-mark" aria-hidden="true">
            <span />
          </span>
          <span>TrendForge</span>
        </a>
        <p>
          A live, sanitized product demo of the YouTube Trending Data Pipeline.
          No AWS credentials are exposed to the browser.
        </p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
