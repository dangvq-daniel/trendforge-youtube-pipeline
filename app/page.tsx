"use client";

import { useMemo, useState, type CSSProperties } from "react";

type ArchitectureGroup = "all" | "data" | "orchestration" | "reliability";
type GoldMart = "trending" | "channel" | "category";
type RegionalMetric = "views" | "observations" | "engagement";
type ChannelSort = "views" | "appearances";

const architectureNodes = [
  {
    id: "youtube",
    short: "YT",
    name: "YouTube Data API",
    service: "YouTube Data API v3",
    group: "data",
    stage: "Live source",
    metric: "50 videos per configured region",
    summary:
      "The live source returns most-popular videos and category mappings for each configured region.",
    code: "lambda/youtube_api_ingestion/lambda_function.py",
    contract: "Video statistics + category reference JSON",
  },
  {
    id: "kaggle",
    short: "CSV",
    name: "Kaggle archive",
    service: "Historical CSV dataset",
    group: "data",
    stage: "Batch source",
    metric: "10 regional source files",
    summary:
      "The historical archive provides the full regional backfill used to seed the pipeline and validate multi-schema processing.",
    code: "data/*videos.csv",
    contract: "Regional trending-video CSV",
  },
  {
    id: "ingestion",
    short: "λ",
    name: "API ingestion",
    service: "EventBridge + AWS Lambda",
    group: "orchestration",
    stage: "Capture",
    metric: "Scheduled, partition-aware writes",
    summary:
      "EventBridge starts the Lambda collector, which enriches every API record with pipeline metadata and writes hourly partitions.",
    code: "lambda/youtube_api_ingestion/lambda_function.py",
    contract: "region={code}/date={date}/hour={hour}",
  },
  {
    id: "loader",
    short: "PY",
    name: "Archive loader",
    service: "Python batch script",
    group: "orchestration",
    stage: "Backfill",
    metric: "Repeatable regional upload",
    summary:
      "The batch loader moves historical CSV and category reference files into the same raw storage contract as the live feed.",
    code: "scripts/aws_copy.ps1",
    contract: "CSV + category JSON in Bronze prefixes",
  },
  {
    id: "bronze",
    short: "S3",
    name: "Bronze bucket",
    service: "Amazon S3",
    group: "data",
    stage: "Raw layer",
    metric: "52 objects · 545.3 MB",
    summary:
      "Raw API JSON, historical CSV, and category references remain unchanged so every transformation can be replayed.",
    code: "s3://yt-data-bronze-qd/youtube/",
    contract: "raw_statistics + raw_statistics_reference_data",
  },
  {
    id: "crawler",
    short: "CR",
    name: "Bronze crawler",
    service: "AWS Glue Crawler",
    group: "data",
    stage: "Discover",
    metric: "Schema discovery over raw prefixes",
    summary:
      "The crawler inspects raw partitions and keeps the Bronze metadata available for Glue jobs and lineage.",
    code: "yt_pipeline_bronze_dev.raw_statistics",
    contract: "Bronze tables in Glue Data Catalog",
  },
  {
    id: "reference",
    short: "λ",
    name: "Reference transform",
    service: "Lambda + AWS SDK for pandas",
    group: "data",
    stage: "Silver branch A",
    metric: "Idempotent by region",
    summary:
      "The reference branch normalizes category JSON, removes duplicate IDs, and writes compressed Parquet.",
    code: "lambda/json_to_parquet/lambda_function.py",
    contract: "clean_reference_data by region",
  },
  {
    id: "transform",
    short: "ETL",
    name: "Statistics transform",
    service: "AWS Glue 5.1",
    group: "data",
    stage: "Silver branch B",
    metric: "G.1X · 2 workers",
    summary:
      "Spark detects API or Kaggle schema, casts types, derives engagement metrics, and deduplicates each video-day.",
    code: "glue_jobs/bronze_to_silver_statistics.py",
    contract: "Typed, deduplicated statistics Parquet",
  },
  {
    id: "silver",
    short: "S3",
    name: "Silver bucket",
    service: "S3 + Glue Data Catalog",
    group: "data",
    stage: "Cleansed layer",
    metric: "68 objects · 100.8 MB",
    summary:
      "Both parallel branches land as cataloged Parquet tables ready for validation and business aggregation.",
    code: "yt_pipeline_silver_dev.clean_statistics",
    contract: "clean_statistics + clean_reference_data",
  },
  {
    id: "quality",
    short: "DQ",
    name: "Data quality gate",
    service: "AWS Lambda + Athena",
    group: "reliability",
    stage: "Validate",
    metric: "5 check families · 10K row sample",
    summary:
      "The gate tests volume, critical nulls, schema, view ranges, and 48-hour freshness before Gold is allowed to publish.",
    code: "data_quality/dq_lambda.py",
    contract: "quality_passed → Step Functions choice",
  },
  {
    id: "aggregate",
    short: "ETL",
    name: "Gold aggregation",
    service: "AWS Glue 5.1",
    group: "data",
    stage: "Business logic",
    metric: "3 analytics marts",
    summary:
      "Silver statistics join category names and fan out into daily, channel, and category-level business aggregates.",
    code: "glue_jobs/silver_to_gold_analytics.py",
    contract: "trending + channel + category analytics",
  },
  {
    id: "trending",
    short: "T",
    name: "trending_analytics",
    service: "Gold business mart",
    group: "data",
    stage: "Daily region mart",
    metric: "158,204 observations · 165.7B views",
    summary:
      "Daily regional summaries expose views, interactions, engagement, channels, categories, and peak performance.",
    code: "yt_pipeline_gold_dev.trending_analytics",
    contract: "One regional summary per trending date",
  },
  {
    id: "channel",
    short: "CH",
    name: "channel_analytics",
    service: "Gold business mart",
    group: "data",
    stage: "Channel mart",
    metric: "Ranks + persistence + peak views",
    summary:
      "Channel aggregates capture total reach, engagement, peak performance, trending persistence, and rank inside each region.",
    code: "yt_pipeline_gold_dev.channel_analytics",
    contract: "One row per channel and region",
  },
  {
    id: "category",
    short: "CAT",
    name: "category_analytics",
    service: "Gold business mart",
    group: "data",
    stage: "Category mart",
    metric: "View share by category, region, and day",
    summary:
      "Category aggregates show attention share, videos, engagement, and channel diversity over time.",
    code: "yt_pipeline_gold_dev.category_analytics",
    contract: "One category summary per region and day",
  },
  {
    id: "gold",
    short: "S3",
    name: "Gold bucket",
    service: "S3 + Glue Data Catalog",
    group: "data",
    stage: "Serving layer",
    metric: "108 objects · 1.5 MB",
    summary:
      "Decision-ready Parquet marts are partitioned by region and registered for low-friction analytical access.",
    code: "s3://yt-data-gold-qd/youtube/",
    contract: "Three cataloged, region-partitioned marts",
  },
  {
    id: "athena",
    short: "SQL",
    name: "Amazon Athena",
    service: "Serverless SQL",
    group: "data",
    stage: "Query",
    metric: "Deduplicated latest Gold snapshot",
    summary:
      "Athena reads the Glue Catalog and assembles the regional, channel, and category results shown in this dashboard.",
    code: "demo/data/dashboard.sql",
    contract: "Governed SQL result set",
  },
  {
    id: "quicksight",
    short: "BI",
    name: "Amazon QuickSight",
    service: "Analytics consumption",
    group: "data",
    stage: "Visualize",
    metric: "Dashboard-ready datasets",
    summary:
      "QuickSight is the managed BI destination for the same Gold marts and governed Athena queries.",
    code: "yt_pipeline_gold_dev.*",
    contract: "Interactive business intelligence",
  },
  {
    id: "stepfunctions",
    short: "SFN",
    name: "Pipeline orchestrator",
    service: "AWS Step Functions",
    group: "orchestration",
    stage: "Control plane",
    metric: "Parallel + retry + catch · 08:21",
    summary:
      "The state machine runs ingestion, waits for S3, launches both Silver branches, evaluates quality, builds Gold, and notifies.",
    code: "step_functions/pipeline_orchestration.json",
    contract: "Ingest → wait → parallel → DQ → Gold → notify",
  },
  {
    id: "alerts",
    short: "SNS",
    name: "Pipeline notifications",
    service: "Amazon SNS",
    group: "reliability",
    stage: "Alerts",
    metric: "Success + 4 focused failure paths",
    summary:
      "Each catch path emits a focused alert for ingestion, transformation, quality, or Gold failures; successful runs notify too.",
    code: "yt-data-alerts-dev",
    contract: "Actionable pipeline outcomes",
  },
  {
    id: "monitoring",
    short: "CW",
    name: "Pipeline observability",
    service: "Amazon CloudWatch",
    group: "reliability",
    stage: "Monitoring",
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
    stage: "Security",
    metric: "Role-scoped permissions",
    summary:
      "Service roles constrain reads, writes, queries, catalog actions, notifications, and orchestration to pipeline resources.",
    code: "Execution roles and resource policies",
    contract: "Least-privilege service access",
  },
] as const;

const regionData = [
  {
    code: "IN",
    name: "India",
    views: 124.8,
    observations: 129832,
    engagement: 2.58,
    topSignal: "T-Series",
  },
  {
    code: "GB",
    name: "United Kingdom",
    views: 21.4,
    observations: 9740,
    engagement: 4.04,
    topSignal: "xxxtentacion",
  },
  {
    code: "US",
    name: "United States",
    views: 11.9,
    observations: 7620,
    engagement: 3.37,
    topSignal: "Marvel Entertainment",
  },
  {
    code: "CA",
    name: "Canada",
    views: 7.7,
    observations: 11012,
    engagement: 2.99,
    topSignal: "Entertainment",
  },
];

const channels = [
  { name: "T-Series", region: "IN", views: 6.31, appearances: 688 },
  { name: "xxxtentacion", region: "GB", views: 4.21, appearances: 88 },
  { name: "Marvel Entertainment", region: "IN", views: 4.07, appearances: 196 },
  { name: "FoxStarHindi", region: "IN", views: 3.21, appearances: 152 },
  { name: "Amit Bhadana", region: "IN", views: 3.06, appearances: 428 },
];

const categories = [
  { name: "Entertainment", share: 35.2, views: 58.33, color: "var(--coral)" },
  { name: "Music", share: 25.9, views: 42.92, color: "var(--gold)" },
  { name: "Film & Animation", share: 9.2, views: 15.24, color: "var(--sage)" },
  { name: "Comedy", share: 7.1, views: 11.76, color: "var(--bronze)" },
  { name: "People & Blogs", share: 7.1, views: 11.76, color: "var(--ink-soft)" },
  { name: "News & Politics", share: 4.2, views: 6.96, color: "var(--blue)" },
  { name: "Other", share: 11.3, views: 18.73, color: "var(--line-strong)" },
];

const compact = new Intl.NumberFormat("en", { notation: "compact" });
const martDetails: Record<
  GoldMart,
  { label: string; grain: string; question: string; fields: string }
> = {
  trending: {
    label: "trending_analytics",
    grain: "Region × trending date",
    question: "Where is attention concentrating?",
    fields: "Views · videos · interactions · engagement · channel diversity",
  },
  channel: {
    label: "channel_analytics",
    grain: "Channel × region",
    question: "Which publishers sustain momentum?",
    fields: "Reach · persistence · peak views · engagement · regional rank",
  },
  category: {
    label: "category_analytics",
    grain: "Category × region × date",
    question: "Which topics own the largest share?",
    fields: "View share · video volume · engagement · channel diversity",
  },
};

export default function Home() {
  const [activeNode, setActiveNode] = useState("stepfunctions");
  const [architectureGroup, setArchitectureGroup] =
    useState<ArchitectureGroup>("all");
  const [activeRegion, setActiveRegion] = useState("IN");
  const [activeMart, setActiveMart] = useState<GoldMart>("trending");
  const [regionalMetric, setRegionalMetric] =
    useState<RegionalMetric>("views");
  const [activeCategory, setActiveCategory] = useState("Entertainment");
  const [channelSort, setChannelSort] = useState<ChannelSort>("views");

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
  const selectedCategory = useMemo(
    () =>
      categories.find((category) => category.name === activeCategory) ??
      categories[0],
    [activeCategory],
  );
  const sortedChannels = useMemo(
    () =>
      [...channels].sort((a, b) =>
        channelSort === "views"
          ? b.views - a.views
          : b.appearances - a.appearances,
      ),
    [channelSort],
  );
  const maxRegionalMetric = Math.max(
    ...regionData.map((region) => region[regionalMetric]),
  );
  const regionalMetricMeta = {
    views: { label: "Views", unit: "billions", suffix: "B" },
    observations: { label: "Observations", unit: "Gold rows", suffix: "" },
    engagement: { label: "Engagement", unit: "average rate", suffix: "%" },
  }[regionalMetric];

  function formatRegionalMetric(value: number) {
    if (regionalMetric === "observations") return compact.format(value);
    return `${value.toFixed(regionalMetric === "engagement" ? 2 : 1)}${regionalMetricMeta.suffix}`;
  }

  function selectMart(mart: GoldMart) {
    setActiveMart(mart);
    setActiveNode(mart);
  }

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

  function renderArchitectureNode(
    id: (typeof architectureNodes)[number]["id"],
    className = "",
  ) {
    const node = architectureNodes.find((candidate) => candidate.id === id)!;
    const isFiltered =
      architectureGroup !== "all" && architectureGroup !== node.group;

    return (
      <button
        type="button"
        className={`diagram-node ${className} ${
          activeNode === node.id ? "is-active" : ""
        } ${isFiltered ? "is-filtered" : ""}`}
        aria-pressed={activeNode === node.id}
        onClick={() => setActiveNode(node.id)}
      >
        <span className="node-symbol">{node.short}</span>
        <span className="node-copy">
          <strong>{node.name}</strong>
          <small>{node.service}</small>
        </span>
      </button>
    );
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
          Last run succeeded
        </a>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">
            <span>Interactive product demo</span>
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

        <aside className="run-card" id="proof" aria-label="Captured production run">
          <div className="run-card-head">
            <div>
              <p className="eyebrow">Captured production run</p>
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
          Captured snapshot
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
            <div className="support-ribbon" aria-label="Cross-cutting controls">
              <span className="rail-label">Security, alerts & observability</span>
              <div>
                {renderArchitectureNode("iam", "support-card")}
                {renderArchitectureNode("alerts", "support-card")}
                {renderArchitectureNode("monitoring", "support-card")}
              </div>
            </div>

            <div
              className="graph-scroll"
              tabIndex={0}
              aria-label="Scrollable YouTube Trending Data Pipeline"
            >
              <div className="pipeline-diagram">
                <section className="pipeline-layer layer-sources">
                  <header>
                    <span>01</span>
                    <h3>Data sources</h3>
                    <small>Live + historical</small>
                  </header>
                  <div className="layer-stack">
                    {renderArchitectureNode("youtube")}
                    <span className="mini-flow">scheduled capture ↓</span>
                    {renderArchitectureNode("ingestion")}
                    {renderArchitectureNode("kaggle")}
                    <span className="mini-flow">regional backfill ↓</span>
                    {renderArchitectureNode("loader")}
                  </div>
                </section>

                <span className="layer-flow" aria-hidden="true">→</span>

                <section className="pipeline-layer layer-bronze">
                  <header>
                    <span>02</span>
                    <h3>Bronze layer</h3>
                    <small>Raw, replayable</small>
                  </header>
                  <div className="layer-stack layer-stack-center">
                    <span className="edge-label">raw JSON + CSV</span>
                    {renderArchitectureNode("bronze", "storage-node")}
                    <span className="mini-flow">schema discovery ↓</span>
                    {renderArchitectureNode("crawler")}
                    <p className="layer-contract">
                      Immutable source fidelity
                      <br />
                      region / date / hour
                    </p>
                  </div>
                </section>

                <span className="layer-flow" aria-hidden="true">→</span>

                <section className="pipeline-layer layer-silver">
                  <header>
                    <span>03</span>
                    <h3>Silver layer</h3>
                    <small>Cleansed Parquet</small>
                  </header>
                  <div className="parallel-label">Parallel transforms</div>
                  <div className="parallel-nodes">
                    {renderArchitectureNode("reference")}
                    {renderArchitectureNode("transform")}
                  </div>
                  <span className="merge-flow" aria-hidden="true">↘ &nbsp; ↙</span>
                  {renderArchitectureNode("silver", "storage-node")}
                  <p className="layer-contract">
                    clean_reference_data
                    <br />
                    clean_statistics
                  </p>
                </section>

                <span className="layer-flow" aria-hidden="true">→</span>

                <section className="pipeline-layer layer-quality">
                  <header>
                    <span>04</span>
                    <h3>Quality gate</h3>
                    <small>Pass or alert</small>
                  </header>
                  <div className="layer-stack layer-stack-center">
                    <span className="edge-label">Athena validation</span>
                    {renderArchitectureNode("quality", "quality-node")}
                    <ul className="quality-checks" aria-label="Quality checks">
                      <li>Volume</li>
                      <li>Nulls</li>
                      <li>Schema</li>
                      <li>Ranges</li>
                      <li>Freshness</li>
                    </ul>
                    <span className="pass-badge">quality_passed = true</span>
                  </div>
                </section>

                <span className="layer-flow" aria-hidden="true">→</span>

                <section className="pipeline-layer layer-gold">
                  <header>
                    <span>05</span>
                    <h3>Gold layer</h3>
                    <small>Business marts</small>
                  </header>
                  {renderArchitectureNode("aggregate", "gold-builder")}
                  <span className="fanout-label">broadcast join → 3 marts</span>
                  <div className="mart-stack">
                    {renderArchitectureNode("trending", "mart-node")}
                    {renderArchitectureNode("channel", "mart-node")}
                    {renderArchitectureNode("category", "mart-node")}
                  </div>
                  <span className="merge-flow" aria-hidden="true">↘ &nbsp; ↓ &nbsp; ↙</span>
                  {renderArchitectureNode("gold", "storage-node")}
                </section>

                <span className="layer-flow" aria-hidden="true">→</span>

                <section className="pipeline-layer layer-consumption">
                  <header>
                    <span>06</span>
                    <h3>Consumption</h3>
                    <small>Query + decide</small>
                  </header>
                  <div className="layer-stack layer-stack-center">
                    <span className="edge-label">catalog queries</span>
                    {renderArchitectureNode("athena")}
                    <span className="mini-flow">governed result sets ↓</span>
                    {renderArchitectureNode("quicksight")}
                    <a className="dashboard-output" href="#analytics">
                      <span>TF</span>
                      <strong>TrendForge dashboard</strong>
                      <small>Athena snapshot</small>
                    </a>
                  </div>
                </section>
              </div>
            </div>

            <div className="control-flow-rail">
              <span className="rail-label">Step Functions control plane</span>
              {renderArchitectureNode("stepfunctions", "control-node")}
              <ol aria-label="State machine sequence">
                <li>Ingest</li>
                <li>Wait 10s</li>
                <li>Parallel Silver</li>
                <li>DQ choice</li>
                <li>Gold build</li>
                <li>SNS outcome</li>
              </ol>
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
            <p className="eyebrow">Gold layer · sanitized Athena snapshot</p>
            <h2>Three marts. One view of attention.</h2>
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

        <div className="gold-mart-switcher">
          <div className="mart-tabs" role="group" aria-label="Inspect a Gold mart">
            {(Object.entries(martDetails) as [GoldMart, (typeof martDetails)[GoldMart]][]).map(
              ([mart, details], index) => (
                <button
                  type="button"
                  key={mart}
                  aria-pressed={activeMart === mart}
                  onClick={() => selectMart(mart)}
                >
                  <span>0{index + 1}</span>
                  <strong>{details.label}</strong>
                </button>
              ),
            )}
          </div>
          <div className="mart-summary" aria-live="polite">
            <div>
              <span>Gold question</span>
              <strong>{martDetails[activeMart].question}</strong>
            </div>
            <div>
              <span>Grain</span>
              <strong>{martDetails[activeMart].grain}</strong>
            </div>
            <p>{martDetails[activeMart].fields}</p>
          </div>
        </div>

        <div className="analytics-kpis" aria-label={`${selectedRegion.name} Gold metrics`}>
          <article>
            <span>Views represented</span>
            <strong>{selectedRegion.views.toFixed(1)}B</strong>
            <small>{((selectedRegion.views / 165.7) * 100).toFixed(1)}% of snapshot</small>
          </article>
          <article>
            <span>Trending observations</span>
            <strong>{compact.format(selectedRegion.observations)}</strong>
            <small>summed Gold video rows</small>
          </article>
          <article>
            <span>Average engagement</span>
            <strong>{selectedRegion.engagement.toFixed(2)}%</strong>
            <small>likes + comments per view</small>
          </article>
          <article>
            <span>Leading signal</span>
            <strong className="kpi-text">{selectedRegion.topSignal}</strong>
            <small>top channel or category</small>
          </article>
        </div>

        <div className="analytics-grid">
          <article
            className={`regional-panel ${activeMart === "trending" ? "is-mart-active" : ""}`}
          >
            <div className="panel-head">
              <div>
                <p className="eyebrow">trending_analytics</p>
                <h3>Regional signal</h3>
              </div>
              <div
                className="metric-toggle"
                role="group"
                aria-label="Regional chart metric"
              >
                {(
                  [
                    ["views", "Views"],
                    ["observations", "Volume"],
                    ["engagement", "Engagement"],
                  ] as [RegionalMetric, string][]
                ).map(([metric, label]) => (
                  <button
                    type="button"
                    key={metric}
                    aria-pressed={regionalMetric === metric}
                    onClick={() => setRegionalMetric(metric)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="chart-context">
              {regionalMetricMeta.label} by region · {regionalMetricMeta.unit}
            </p>

            <div
              className="region-chart"
              aria-label={`${regionalMetricMeta.label} by region`}
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
                      style={{
                        "--bar-width": `${(region[regionalMetric] / maxRegionalMetric) * 100}%`,
                      } as CSSProperties}
                    />
                  </span>
                  <strong>{formatRegionalMetric(region[regionalMetric])}</strong>
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
                  <dd>{selectedRegion.topSignal}</dd>
                </div>
              </dl>
            </div>
          </article>

          <article
            className={`category-panel ${activeMart === "category" ? "is-mart-active" : ""}`}
          >
            <div className="panel-head">
              <div>
                <p className="eyebrow">category_analytics</p>
                <h3>Category gravity</h3>
              </div>
              <span className="unit-label">all active regions</span>
            </div>
            <div
              className="category-stack"
              aria-label="Entertainment 35.2 percent, Music 25.9 percent, Film and Animation 9.2 percent, Comedy 7.1 percent, People and Blogs 7.1 percent, News and Politics 4.2 percent, Other 11.3 percent"
            >
              {categories.map((category) => (
                <button
                  type="button"
                  key={category.name}
                  aria-label={`${category.name}, ${category.share.toFixed(1)} percent`}
                  aria-pressed={activeCategory === category.name}
                  onClick={() => setActiveCategory(category.name)}
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
                  <button
                    type="button"
                    aria-pressed={activeCategory === category.name}
                    onClick={() => setActiveCategory(category.name)}
                  >
                    <span
                      className="legend-dot"
                      style={{ "--dot-color": category.color } as CSSProperties}
                      aria-hidden="true"
                    />
                    <span>{category.name}</span>
                    <strong>{category.share.toFixed(1)}%</strong>
                  </button>
                </li>
              ))}
            </ul>
            <div className="category-detail" aria-live="polite">
              <span
                className="category-swatch"
                style={{ "--dot-color": selectedCategory.color } as CSSProperties}
                aria-hidden="true"
              />
              <p>
                <span>Selected category</span>
                <strong>{selectedCategory.name}</strong>
              </p>
              <p>
                <span>Views represented</span>
                <strong>{selectedCategory.views.toFixed(2)}B</strong>
              </p>
              <p>
                <span>Snapshot share</span>
                <strong>{selectedCategory.share.toFixed(1)}%</strong>
              </p>
            </div>
          </article>
        </div>

        <article
          className={`channels-panel ${activeMart === "channel" ? "is-mart-active" : ""}`}
        >
          <div className="panel-head">
            <div>
              <p className="eyebrow">channel_analytics</p>
              <h3>Channels with staying power</h3>
            </div>
            <div className="metric-toggle" role="group" aria-label="Sort channels">
              <button
                type="button"
                aria-pressed={channelSort === "views"}
                onClick={() => setChannelSort("views")}
              >
                Rank by views
              </button>
              <button
                type="button"
                aria-pressed={channelSort === "appearances"}
                onClick={() => setChannelSort("appearances")}
              >
                Rank by persistence
              </button>
            </div>
          </div>
          <p className="chart-context">
            Latest deduplicated cross-region leaders · click a Gold mart above to
            trace its architecture node.
          </p>
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
                {sortedChannels.map((channel, index) => (
                  <tr key={`${channel.name}-${channel.region}`}>
                    <td data-label="Rank">{String(index + 1).padStart(2, "0")}</td>
                    <th scope="row">{channel.name}</th>
                    <td data-label="Region">
                      <span className="region-pill">{channel.region}</span>
                    </td>
                    <td data-label="Views">{channel.views.toFixed(2)}B</td>
                    <td data-label="Appearances">{channel.appearances}</td>
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
