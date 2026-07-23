"use client";

import { useMemo, useState, type CSSProperties } from "react";

type ArchitectureGroup = "all" | "data" | "orchestration" | "reliability";

const architectureNodes = [
  {
    id: "sources",
    short: "API",
    name: "YouTube sources",
    service: "YouTube Data API v3 + Kaggle",
    group: "data",
    stage: "Input",
    metric: "10 configured regions",
    summary:
      "The live API collects most-popular videos and category mappings while the repository retains the historical CSV archive.",
    code: "data/*videos.csv · youtube_api_ingestion/lambda_function.py",
    contract: "Trending videos + category reference JSON",
  },
  {
    id: "ingestion",
    short: "λ",
    name: "Ingestion",
    service: "AWS Lambda",
    group: "orchestration",
    stage: "Capture",
    metric: "50 videos / region",
    summary:
      "The handler loops through configured regions, attaches pipeline metadata, and writes Hive-style date and hour partitions.",
    code: "lambda/youtube_api_ingestion/lambda_function.py",
    contract: "region={code}/date={date}/hour={hour}",
  },
  {
    id: "bronze",
    short: "S3",
    name: "Bronze store",
    service: "Amazon S3",
    group: "data",
    stage: "Raw",
    metric: "52 objects · 545.3 MB",
    summary:
      "Raw JSON, CSV, and category reference files are retained without business transformation for replay and lineage.",
    code: "scripts/aws_copy.ps1 · s3://yt-data-bronze-qd",
    contract: "raw_statistics + raw_statistics_reference_data",
  },
  {
    id: "transform",
    short: "ETL",
    name: "Statistics ETL",
    service: "AWS Glue 5.1",
    group: "data",
    stage: "Refine",
    metric: "G.1X · 2 workers",
    summary:
      "Spark detects API or Kaggle schema, casts types, standardizes regions, derives engagement metrics, and deduplicates each video-day.",
    code: "glue_jobs/bronze_to_silver_statistics.py",
    contract: "Typed, deduplicated statistics Parquet",
  },
  {
    id: "reference",
    short: "λ",
    name: "Reference transform",
    service: "Lambda + AWS SDK for pandas",
    group: "data",
    stage: "Parallel branch",
    metric: "Idempotent by region",
    summary:
      "The parallel Lambda normalizes category JSON, removes duplicate category IDs, and updates the Silver reference table.",
    code: "lambda/json_to_parquet/lambda_function.py",
    contract: "clean_reference_data partitioned by region",
  },
  {
    id: "silver",
    short: "S3",
    name: "Silver store",
    service: "S3 + Glue Data Catalog",
    group: "data",
    stage: "Cleansed",
    metric: "68 objects · 100.8 MB",
    summary:
      "Clean statistics and reference tables are registered in the catalog as compressed Parquet for downstream reads.",
    code: "yt_pipeline_silver_dev.clean_statistics",
    contract: "clean_statistics + clean_reference_data",
  },
  {
    id: "quality",
    short: "DQ",
    name: "Quality gate",
    service: "AWS Lambda + Athena",
    group: "reliability",
    stage: "Validate",
    metric: "5 check families",
    summary:
      "A 10,000-row sample is checked for volume, critical-column nulls, schema, view ranges, and 48-hour freshness.",
    code: "data_quality/dq_lambda.py",
    contract: "quality_passed → boolean choice",
  },
  {
    id: "aggregate",
    short: "ETL",
    name: "Gold builder",
    service: "AWS Glue 5.1",
    group: "data",
    stage: "Aggregate",
    metric: "3 business marts",
    summary:
      "Silver statistics join category names and fan out into trending, channel, and category-level business aggregates.",
    code: "glue_jobs/silver_to_gold_analytics.py",
    contract: "trending · channel · category analytics",
  },
  {
    id: "gold",
    short: "S3",
    name: "Gold store",
    service: "S3 + Glue Data Catalog",
    group: "data",
    stage: "Serve",
    metric: "108 objects · 1.5 MB",
    summary:
      "Decision-ready Parquet marts are partitioned by region and cataloged for efficient analytical consumption.",
    code: "s3://yt-data-gold-qd/youtube/",
    contract: "Query-ready regional partitions",
  },
  {
    id: "consume",
    short: "SQL",
    name: "Analytics",
    service: "Amazon Athena + QuickSight",
    group: "data",
    stage: "Consume",
    metric: "165.7B views represented",
    summary:
      "Athena queries the Gold catalog directly and provides the governed dataset used by this interactive product demo.",
    code: "demo/data/dashboard.sql",
    contract: "Regional, channel, and category insights",
  },
  {
    id: "stepfunctions",
    short: "SFN",
    name: "Orchestrator",
    service: "AWS Step Functions",
    group: "orchestration",
    stage: "Control plane",
    metric: "Parallel + retry + catch",
    summary:
      "The state machine runs ingestion, waits for S3, launches two Silver branches in parallel, evaluates quality, and publishes Gold.",
    code: "step_functions/pipeline_orchestration.json",
    contract: "8m 21s latest successful execution",
  },
  {
    id: "alerts",
    short: "SNS",
    name: "Notifications",
    service: "Amazon SNS",
    group: "reliability",
    stage: "Recovery",
    metric: "Success + 4 failure paths",
    summary:
      "Each catch path emits a focused alert for ingestion, transformation, quality, or Gold failures; successful runs notify too.",
    code: "yt-data-alerts-dev",
    contract: "Actionable pipeline outcome alerts",
  },
  {
    id: "monitoring",
    short: "CW",
    name: "Observability",
    service: "Amazon CloudWatch",
    group: "reliability",
    stage: "Cross-cutting",
    metric: "Logs at every compute step",
    summary:
      "Structured Lambda and Glue logs expose counts, branch outcomes, data-quality results, and execution timing.",
    code: "CloudWatch log groups + Step Functions history",
    contract: "Operational evidence and debugging trail",
  },
  {
    id: "iam",
    short: "IAM",
    name: "Access boundary",
    service: "AWS IAM",
    group: "reliability",
    stage: "Cross-cutting",
    metric: "Role-scoped permissions",
    summary:
      "Service roles constrain read, write, catalog, query, notification, and orchestration actions to the pipeline resources.",
    code: "Execution roles and resource policies",
    contract: "Least-privilege service access",
  },
] as const;

const mainlineNodeIds = [
  "sources",
  "ingestion",
  "bronze",
  "transform",
  "silver",
  "quality",
  "aggregate",
  "gold",
  "consume",
] as const;

const mainlineNodes = mainlineNodeIds.map(
  (id) => architectureNodes.find((node) => node.id === id)!,
);
const referenceNode = architectureNodes.find((node) => node.id === "reference")!;
const supportNodes = architectureNodes.filter((node) =>
  ["stepfunctions", "alerts", "monitoring", "iam"].includes(node.id),
);

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
  const [activeNode, setActiveNode] = useState("stepfunctions");
  const [architectureGroup, setArchitectureGroup] =
    useState<ArchitectureGroup>("all");
  const [activeRegion, setActiveRegion] = useState("IN");

  const selectedNode = useMemo(
    () =>
      architectureNodes.find((node) => node.id === activeNode) ??
      architectureNodes[0],
    [activeNode],
  );
  const visibleArchitectureNodes = useMemo(
    () =>
      architectureGroup === "all"
        ? architectureNodes
        : architectureNodes.filter((node) => node.group === architectureGroup),
    [architectureGroup],
  );
  const selectedRegion = useMemo(
    () => regionData.find((region) => region.code === activeRegion) ?? regionData[0],
    [activeRegion],
  );
  const maxViews = Math.max(...regionData.map((region) => region.views));

  function chooseArchitectureGroup(group: ArchitectureGroup) {
    setArchitectureGroup(group);
    if (
      group !== "all" &&
      architectureNodes.find((node) => node.id === activeNode)?.group !== group
    ) {
      const firstMatch = architectureNodes.find((node) => node.group === group);
      if (firstMatch) setActiveNode(firstMatch.id);
    }
  }

  function moveArchitectureSelection(direction: -1 | 1) {
    const currentIndex = visibleArchitectureNodes.findIndex(
      (node) => node.id === activeNode,
    );
    const safeIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex =
      (safeIndex + direction + visibleArchitectureNodes.length) %
      visibleArchitectureNodes.length;
    setActiveNode(visibleArchitectureNodes[nextIndex].id);
  }

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
          <a href="#architecture">Architecture</a>
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
            <a className="button button-secondary" href="#architecture">
              Explore the architecture
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

      <section className="architecture-section" id="architecture">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Interactive system map</p>
            <h2>Trace every signal, service, and decision.</h2>
          </div>
          <p>
            Follow the production path from the YouTube API to analytics. Every
            node opens the implementation contract behind it.
          </p>
        </header>

        <div className="architecture-toolbar">
          <div className="architecture-filters" role="group" aria-label="Filter architecture layers">
            {[
              ["all", "Whole system"],
              ["data", "Data path"],
              ["orchestration", "Orchestration"],
              ["reliability", "Reliability"],
            ].map(([group, label]) => (
              <button
                type="button"
                key={group}
                aria-pressed={architectureGroup === group}
                onClick={() => chooseArchitectureGroup(group as ArchitectureGroup)}
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            <span className="status-dot" aria-hidden="true" />
            Built from the deployed code path
          </p>
        </div>

        <div className="architecture-workspace">
          <div className="architecture-map">
            <div className="orchestration-rail">
              <span className="rail-label">Control plane</span>
              <button
                type="button"
                className={`support-node support-orchestrator ${
                  activeNode === "stepfunctions" ? "is-active" : ""
                } ${
                  architectureGroup !== "all" &&
                  architectureGroup !== "orchestration"
                    ? "is-dimmed"
                    : ""
                }`}
                aria-pressed={activeNode === "stepfunctions"}
                onClick={() => setActiveNode("stepfunctions")}
              >
                <span className="node-symbol">SFN</span>
                <span>
                  <small>Step Functions</small>
                  <strong>Orchestrate · retry · catch</strong>
                </span>
                <em>08:21</em>
              </button>
              <div className="rail-steps" aria-hidden="true">
                <span>Ingest</span>
                <span>Wait 10s</span>
                <span>Parallel</span>
                <span>Quality</span>
                <span>Gold</span>
                <span>Notify</span>
              </div>
            </div>

            <div className="graph-scroll" tabIndex={0} aria-label="Scrollable production data path">
              <div className="graph-mainline">
                {mainlineNodes.map((node, index) => (
                  <button
                    type="button"
                    className={`architecture-node node-${node.id} ${
                      activeNode === node.id ? "is-active" : ""
                    } ${
                      architectureGroup !== "all" &&
                      architectureGroup !== node.group
                        ? "is-dimmed"
                        : ""
                    }`}
                    key={node.id}
                    aria-pressed={activeNode === node.id}
                    onClick={() => setActiveNode(node.id)}
                  >
                    <span className="node-sequence">{String(index + 1).padStart(2, "0")}</span>
                    <span className="node-symbol">{node.short}</span>
                    <span className="node-copy">
                      <small>{node.stage}</small>
                      <strong>{node.name}</strong>
                      <em>{node.service}</em>
                    </span>
                    {index < mainlineNodes.length - 1 && (
                      <span className="flow-arrow" aria-hidden="true">
                        →
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="parallel-branch">
                <span className="branch-line" aria-hidden="true" />
                <span className="branch-label">Parallel reference branch</span>
                <button
                  type="button"
                  className={`architecture-node node-reference ${
                    activeNode === "reference" ? "is-active" : ""
                  } ${
                    architectureGroup !== "all" && architectureGroup !== "data"
                      ? "is-dimmed"
                      : ""
                  }`}
                  aria-pressed={activeNode === "reference"}
                  onClick={() => setActiveNode("reference")}
                >
                  <span className="node-sequence">04B</span>
                  <span className="node-symbol">{referenceNode.short}</span>
                  <span className="node-copy">
                    <small>{referenceNode.stage}</small>
                    <strong>{referenceNode.name}</strong>
                    <em>{referenceNode.service}</em>
                  </span>
                </button>
                <span className="branch-output">
                  Category lookup
                  <b aria-hidden="true">↗</b>
                </span>
              </div>
            </div>

            <div className="reliability-lane">
              <span className="rail-label">Cross-cutting reliability</span>
              <div>
                {supportNodes
                  .filter((node) => node.id !== "stepfunctions")
                  .map((node) => (
                    <button
                      type="button"
                      className={`support-node ${
                        activeNode === node.id ? "is-active" : ""
                      } ${
                        architectureGroup !== "all" &&
                        architectureGroup !== node.group
                          ? "is-dimmed"
                          : ""
                      }`}
                      key={node.id}
                      aria-pressed={activeNode === node.id}
                      onClick={() => setActiveNode(node.id)}
                    >
                      <span className="node-symbol">{node.short}</span>
                      <span>
                        <small>{node.service}</small>
                        <strong>{node.name}</strong>
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>

          <aside className="architecture-inspector" aria-live="polite">
            <div className="inspector-topline">
              <span className={`group-tag group-${selectedNode.group}`}>
                {selectedNode.group}
              </span>
              <span>
                {visibleArchitectureNodes.findIndex(
                  (node) => node.id === selectedNode.id,
                ) + 1}
                /{visibleArchitectureNodes.length}
              </span>
            </div>
            <p className="eyebrow">{selectedNode.stage}</p>
            <h3>{selectedNode.name}</h3>
            <p className="inspector-service">{selectedNode.service}</p>
            <p className="inspector-summary">{selectedNode.summary}</p>

            <dl className="inspector-facts">
              <div>
                <dt>Live signal</dt>
                <dd>{selectedNode.metric}</dd>
              </div>
              <div>
                <dt>Output contract</dt>
                <dd>{selectedNode.contract}</dd>
              </div>
            </dl>

            <div className="code-reference">
              <span>Repository source</span>
              <code>{selectedNode.code}</code>
            </div>

            <div className="inspector-controls">
              <button
                type="button"
                aria-label="Previous architecture node"
                onClick={() => moveArchitectureSelection(-1)}
              >
                ←
              </button>
              <button
                type="button"
                className="inspector-next"
                onClick={() => moveArchitectureSelection(1)}
              >
                Next node
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </aside>
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
