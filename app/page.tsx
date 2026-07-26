"use client";

import { useMemo, useState, type CSSProperties } from "react";

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

type ArchitectureNodeId = (typeof architectureNodes)[number]["id"];
type ArchitectureStageId =
  | "sources"
  | "bronze"
  | "silver"
  | "quality"
  | "gold"
  | "consume";

const pipelineStages: Array<{
  id: ArchitectureStageId;
  number: string;
  label: string;
  title: string;
  summary: string;
  metric: string;
  outcome: string;
  contract: string;
  code: string;
  nodeIds: ArchitectureNodeId[];
}> = [
  {
    id: "sources",
    number: "01",
    label: "Capture",
    title: "Sources & ingestion",
    summary:
      "Scheduled API collection and a repeatable historical backfill enter one raw-data contract.",
    metric: "50 videos per configured region",
    outcome: "Live JSON and regional CSV land with replayable lineage.",
    contract: "region / date / hour partitions",
    code: "lambda/youtube_api_ingestion + scripts/aws_copy.ps1",
    nodeIds: ["youtube", "ingestion", "kaggle", "loader"],
  },
  {
    id: "bronze",
    number: "02",
    label: "Land",
    title: "Bronze · raw",
    summary:
      "The raw layer keeps source fidelity intact while the crawler exposes schema for downstream jobs.",
    metric: "52 objects · 545.3 MB",
    outcome: "Every transform remains recoverable from immutable inputs.",
    contract: "raw_statistics + raw reference data",
    code: "s3://yt-data-bronze-qd/youtube/",
    nodeIds: ["bronze", "crawler"],
  },
  {
    id: "silver",
    number: "03",
    label: "Refine",
    title: "Silver · cleansed",
    summary:
      "Two transforms run in parallel: statistics are standardized while category references are normalized.",
    metric: "68 objects · 100.8 MB",
    outcome: "Typed, deduplicated Parquet converges into two trusted tables.",
    contract: "clean_statistics + clean_reference_data",
    code: "glue_jobs/bronze_to_silver_statistics.py",
    nodeIds: ["reference", "transform", "silver"],
  },
  {
    id: "quality",
    number: "04",
    label: "Trust",
    title: "Data quality gate",
    summary:
      "Volume, null, schema, range, and freshness checks decide whether the pipeline may publish Gold.",
    metric: "5 check families · 10K row sample",
    outcome: "Failed runs stop and alert; only trusted data advances.",
    contract: "quality_passed = true",
    code: "data_quality/dq_lambda.py",
    nodeIds: ["quality", "alerts"],
  },
  {
    id: "gold",
    number: "05",
    label: "Serve",
    title: "Gold · business products",
    summary:
      "One aggregation job joins the category lookup once, then produces three purpose-built analytical grains.",
    metric: "3 marts · 108 objects · 1.5 MB",
    outcome: "Region, channel, and category questions share one governed source.",
    contract: "trending + channel + category analytics",
    code: "glue_jobs/silver_to_gold_analytics.py",
    nodeIds: ["aggregate", "trending", "channel", "category", "gold"],
  },
  {
    id: "consume",
    number: "06",
    label: "Decide",
    title: "Analytics consumption",
    summary:
      "Athena queries the Gold Catalog and serves the same governed results to BI and this product demo.",
    metric: "165.7B represented views",
    outcome: "Decision-ready answers replace direct reads from raw storage.",
    contract: "sanitized Athena snapshot",
    code: "demo/data/dashboard.sql",
    nodeIds: ["athena", "quicksight"],
  },
];

const iconBase =
  "https://cdn.jsdelivr.net/npm/aws-icons@3.3.0/icons/architecture-service";

const serviceIcons: Record<ArchitectureNodeId, string> = {
  youtube: "https://cdn.simpleicons.org/youtube/FF0000",
  kaggle: "https://cdn.simpleicons.org/kaggle/20BEFF",
  ingestion: `${iconBase}/AmazonEventBridge.svg`,
  loader: "https://cdn.simpleicons.org/python/3776AB",
  bronze: `${iconBase}/AmazonSimpleStorageService.svg`,
  crawler: `${iconBase}/AWSGlue.svg`,
  reference: `${iconBase}/AWSLambda.svg`,
  transform: `${iconBase}/AWSGlue.svg`,
  silver: `${iconBase}/AmazonSimpleStorageService.svg`,
  quality: `${iconBase}/AWSLambda.svg`,
  aggregate: `${iconBase}/AWSGlue.svg`,
  trending: `${iconBase}/AmazonAthena.svg`,
  channel: `${iconBase}/AmazonAthena.svg`,
  category: `${iconBase}/AmazonAthena.svg`,
  gold: `${iconBase}/AmazonSimpleStorageService.svg`,
  athena: `${iconBase}/AmazonAthena.svg`,
  quicksight: `${iconBase}/AmazonQuickSuite.svg`,
  stepfunctions: `${iconBase}/AWSStepFunctions.svg`,
  alerts: `${iconBase}/AmazonSimpleNotificationService.svg`,
  monitoring: `${iconBase}/AmazonCloudWatch.svg`,
  iam: `${iconBase}/AWSIdentityandAccessManagement.svg`,
};

const dagNodes: Array<{
  nodeId: ArchitectureNodeId;
  stageId: ArchitectureStageId;
  x: number;
  y: number;
  note?: string;
  tone?: "source" | "bronze" | "silver" | "quality" | "gold" | "consume" | "alert";
}> = [
  { nodeId: "youtube", stageId: "sources", x: 42, y: 108, tone: "source" },
  { nodeId: "ingestion", stageId: "sources", x: 230, y: 108, tone: "source" },
  { nodeId: "kaggle", stageId: "sources", x: 42, y: 315, tone: "source" },
  { nodeId: "loader", stageId: "sources", x: 230, y: 315, tone: "source" },
  { nodeId: "bronze", stageId: "bronze", x: 430, y: 210, tone: "bronze", note: "Raw JSON + CSV" },
  { nodeId: "crawler", stageId: "bronze", x: 430, y: 455, tone: "bronze" },
  { nodeId: "reference", stageId: "silver", x: 625, y: 100, tone: "silver" },
  { nodeId: "transform", stageId: "silver", x: 625, y: 315, tone: "silver" },
  { nodeId: "silver", stageId: "silver", x: 820, y: 210, tone: "silver", note: "Trusted Parquet" },
  { nodeId: "quality", stageId: "quality", x: 1015, y: 210, tone: "quality" },
  { nodeId: "alerts", stageId: "quality", x: 1015, y: 455, tone: "alert", note: "Failure path" },
  { nodeId: "aggregate", stageId: "gold", x: 1205, y: 210, tone: "gold" },
  { nodeId: "trending", stageId: "gold", x: 1395, y: 70, tone: "gold" },
  { nodeId: "channel", stageId: "gold", x: 1395, y: 210, tone: "gold" },
  { nodeId: "category", stageId: "gold", x: 1395, y: 350, tone: "gold" },
  { nodeId: "gold", stageId: "gold", x: 1585, y: 210, tone: "gold", note: "Published Parquet" },
  { nodeId: "athena", stageId: "consume", x: 1770, y: 125, tone: "consume" },
  { nodeId: "quicksight", stageId: "consume", x: 1770, y: 300, tone: "consume" },
];

type DagNode = (typeof dagNodes)[number];

const dagEdges: Array<{
  from: ArchitectureNodeId;
  to: ArchitectureNodeId;
  label?: string;
  kind?: "failure";
}> = [
  { from: "youtube", to: "ingestion", label: "scheduled API pull" },
  { from: "kaggle", to: "loader", label: "historical batch" },
  { from: "ingestion", to: "bronze", label: "JSON" },
  { from: "loader", to: "bronze", label: "CSV" },
  { from: "bronze", to: "reference", label: "category JSON" },
  { from: "bronze", to: "transform", label: "statistics" },
  { from: "bronze", to: "crawler", label: "discover schema" },
  { from: "reference", to: "silver", label: "Parquet" },
  { from: "transform", to: "silver", label: "Parquet" },
  { from: "silver", to: "quality", label: "validate" },
  { from: "quality", to: "alerts", label: "checks fail", kind: "failure" },
  { from: "quality", to: "aggregate", label: "checks pass" },
  { from: "aggregate", to: "trending", label: "daily region" },
  { from: "aggregate", to: "channel", label: "channel grain" },
  { from: "aggregate", to: "category", label: "category grain" },
  { from: "trending", to: "gold" },
  { from: "channel", to: "gold" },
  { from: "category", to: "gold" },
  { from: "gold", to: "athena", label: "SQL queries" },
  { from: "gold", to: "quicksight", label: "BI datasets" },
];

function dagPath(from: DagNode, to: DagNode) {
  const nodeWidth = 150;
  const nodeHeight = 82;

  if (from.x === to.x) {
    const startX = from.x + nodeWidth / 2;
    const startY = from.y + nodeHeight;
    const endY = to.y;
    return `M ${startX} ${startY} V ${endY}`;
  }

  const startX = from.x + nodeWidth;
  const startY = from.y + nodeHeight / 2;
  const endX = to.x;
  const endY = to.y + nodeHeight / 2;
  const middleX = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`;
}

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

export default function Home() {
  const [activeStage, setActiveStage] =
    useState<ArchitectureStageId>("sources");
  const [activeRegion, setActiveRegion] = useState("IN");
  const [regionalMetric, setRegionalMetric] =
    useState<RegionalMetric>("views");
  const [channelSort, setChannelSort] = useState<ChannelSort>("views");

  const selectedStage = useMemo(
    () =>
      pipelineStages.find((stage) => stage.id === activeStage) ??
      pipelineStages[0],
    [activeStage],
  );
  const selectedRegion = useMemo(
    () => regionData.find((region) => region.code === activeRegion) ?? regionData[0],
    [activeRegion],
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
  const maxChannelMetric = Math.max(
    ...channels.map((channel) => channel[channelSort]),
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

  function selectStage(stageId: ArchitectureStageId) {
    setActiveStage(stageId);

    if (window.matchMedia("(max-width: 760px)").matches) {
      window.requestAnimationFrame(() => {
        document.getElementById("architecture-stage-detail")?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      });
    }
  }

  function moveStage(direction: -1 | 1) {
    const currentIndex = pipelineStages.findIndex(
      (stage) => stage.id === activeStage,
    );
    const nextIndex =
      (currentIndex + direction + pipelineStages.length) % pipelineStages.length;
    setActiveStage(pipelineStages[nextIndex].id);
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
            Follow the production path from the YouTube API to analytics. Select
            a stage to reveal its systems, evidence, and hand-off contract.
          </p>
        </header>

        <div className="architecture-journey">
          <div className="architecture-guardrails" aria-label="Pipeline guardrails">
            <p>Guardrails across every stage</p>
            <ul>
              <li><span className="product-icon"><img src={serviceIcons.iam} alt="" /></span><strong>AWS IAM</strong><small>Roles &amp; permissions</small></li>
              <li><span className="product-icon"><img src={serviceIcons.alerts} alt="" /></span><strong>Amazon SNS</strong><small>Success &amp; failure alerts</small></li>
              <li><span className="product-icon"><img src={serviceIcons.monitoring} alt="" /></span><strong>CloudWatch</strong><small>Logging &amp; monitoring</small></li>
            </ul>
          </div>

          <div className="dag-shell">
            <div className="dag-toolbar">
              <div>
                <span className="status-dot" aria-hidden="true" />
                <strong>Production lineage</strong>
                <small>Arrows show the exact direction of data movement</small>
              </div>
              <p><span className="dag-legend-line" /> data path <span className="dag-legend-line is-failure" /> failure path</p>
            </div>
            <div className="dag-scroll" role="region" aria-label="Scrollable pipeline DAG" tabIndex={0}>
              <div className="dag-canvas">
                <div className="dag-stage-bands" aria-hidden="true">
                  {pipelineStages.map((stage) => (
                    <div
                      className={`dag-stage-band dag-stage-band-${stage.id} ${activeStage === stage.id ? "is-active" : ""}`}
                      key={stage.id}
                    >
                      <span>{stage.number}</span>
                      <strong>{stage.title}</strong>
                    </div>
                  ))}
                </div>
                <svg className="dag-connectors" viewBox="0 0 1960 620" aria-hidden="true">
                  <defs>
                    <marker id="dag-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M 0 0 L 8 4 L 0 8 z" />
                    </marker>
                    <marker id="dag-arrow-failure" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M 0 0 L 8 4 L 0 8 z" />
                    </marker>
                  </defs>
                  {dagEdges.map((edge) => {
                    const from = dagNodes.find((node) => node.nodeId === edge.from)!;
                    const to = dagNodes.find((node) => node.nodeId === edge.to)!;
                    const labelX = (from.x + 150 + to.x) / 2;
                    const labelY = (from.y + 41 + to.y + 41) / 2 - 8;
                    return (
                      <g className={edge.kind === "failure" ? "is-failure" : ""} key={`${edge.from}-${edge.to}`}>
                        <path d={dagPath(from, to)} />
                        {edge.label && (
                          <text x={labelX} y={labelY} textAnchor="middle">{edge.label}</text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                <div className="dag-nodes" role="list" aria-label="Pipeline services">
                  {dagNodes.map((layoutNode) => {
                    const node = architectureNodes.find(
                      (candidate) => candidate.id === layoutNode.nodeId,
                    )!;
                    return (
                      <button
                        type="button"
                        role="listitem"
                        className={`dag-node dag-node-${layoutNode.tone ?? "source"} ${activeStage === layoutNode.stageId ? "is-active" : ""}`}
                        style={{ left: layoutNode.x, top: layoutNode.y }}
                        onClick={() => selectStage(layoutNode.stageId)}
                        aria-label={`${node.name}. ${node.service}. View ${layoutNode.stageId} stage details.`}
                        key={layoutNode.nodeId}
                      >
                        <span className="product-icon">
                          <img src={serviceIcons[node.id]} alt="" />
                        </span>
                        <span>
                          <strong>{node.name}</strong>
                          <small>{layoutNode.note ?? node.stage}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <section
            className="pipeline-detail"
            id="architecture-stage-detail"
            role="tabpanel"
            aria-labelledby={`stage-tab-${selectedStage.id}`}
          >
            <div className="pipeline-detail-intro">
              <p className="eyebrow">
                Stage {selectedStage.number} · {selectedStage.label}
              </p>
              <h3>{selectedStage.title}</h3>
              <p>{selectedStage.summary}</p>
            </div>
            <dl className="pipeline-detail-facts">
              <div>
                <dt>Run proof</dt>
                <dd>{selectedStage.metric}</dd>
              </div>
              <div>
                <dt>Input → output</dt>
                <dd>{selectedStage.contract}</dd>
              </div>
              <div>
                <dt>Stage outcome</dt>
                <dd>{selectedStage.outcome}</dd>
              </div>
            </dl>
            <div className="pipeline-detail-source">
              <span>Repository source</span>
              <code>{selectedStage.code}</code>
              <div className="stage-controls">
                <button type="button" onClick={() => moveStage(-1)}>
                  <span aria-hidden="true">←</span>
                  Previous
                </button>
                <button type="button" onClick={() => moveStage(1)}>
                  Next stage
                  <span aria-hidden="true">→</span>
                </button>
              </div>
              {selectedStage.id === "gold" && (
                <a href="#analytics">
                  Explore Gold results
                  <span aria-hidden="true">↓</span>
                </a>
              )}
            </div>
          </section>

          <div className="orchestration-rail">
            <span className="product-icon"><img src={serviceIcons.stepfunctions} alt="" /></span>
            <p><strong>AWS Step Functions</strong><small>One observable run from ingestion to notification</small></p>
            <ol aria-label="Step Functions run sequence">
              <li>Ingest</li>
              <li>Wait</li>
              <li>Parallel Silver</li>
              <li>Quality gate</li>
              <li>Gold aggregation</li>
              <li>Notify</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="analytics-section" id="analytics">
        <header className="section-heading analytics-heading story-heading">
          <div>
            <p className="eyebrow">Gold layer · sanitized Athena snapshot</p>
            <h2>Follow the story behind 165.7B views.</h2>
          </div>
          <p>
            Start with where attention concentrates, move into what drives it,
            then finish with the channels that sustain momentum.
          </p>
        </header>

        <div className="gold-story-lead" aria-label="Gold snapshot summary">
          <div className="story-path">
            <span>Read the Gold layer as a decision path</span>
            <strong>Three chapters. One answer.</strong>
            <nav aria-label="Gold story chapters">
              <a href="#chapter-concentration">01 Concentration</a>
              <a href="#chapter-composition">02 Composition</a>
              <a href="#chapter-staying-power">03 Staying power</a>
            </nav>
          </div>
          <dl>
            <div>
              <dt>Views represented</dt>
              <dd>165.7B</dd>
            </div>
            <div>
              <dt>Trending observations</dt>
              <dd>158,204</dd>
            </div>
            <div>
              <dt>Active regions</dt>
              <dd>4</dd>
            </div>
            <div>
              <dt>Top-two category share</dt>
              <dd>61.1%</dd>
            </div>
          </dl>
        </div>

        <div className="gold-story">
          <section
            className="story-chapter"
            id="chapter-concentration"
            aria-labelledby="story-concentration"
          >
            <aside className="story-copy">
              <span className="story-number">01</span>
              <p className="eyebrow">Where attention concentrates</p>
              <h3 id="story-concentration">Attention is highly concentrated.</h3>
              <p className="story-takeaway">
                <strong>{selectedRegion.name}</strong> represents{" "}
                <strong>{((selectedRegion.views / 165.7) * 100).toFixed(1)}%</strong>{" "}
                of snapshot views—{selectedRegion.views.toFixed(1)}B of 165.7B.
              </p>
              <p className="story-note">
                Select a region in the chart and compare reach, observation
                volume, or average engagement without changing the scope of the
                later chapters.
              </p>
              <div className="story-source">
                <span>Gold source</span>
                <code>trending_analytics</code>
                <small>Region × trending date</small>
              </div>
            </aside>

          <article
              className="regional-panel story-visual"
          >
            <div className="panel-head">
              <div>
                  <p className="eyebrow">Regional comparison</p>
                  <h3>{regionalMetricMeta.label} by region</h3>
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
                {regionalMetricMeta.unit} · select a bar to update the reading
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
          </section>

          <section
            className="story-chapter story-chapter-reverse"
            id="chapter-composition"
            aria-labelledby="story-composition"
          >
            <aside className="story-copy">
              <span className="story-number">02</span>
              <p className="eyebrow">What drives it</p>
              <h3 id="story-composition">Two categories shape the market.</h3>
              <p className="story-takeaway">
                <strong>Entertainment and Music</strong> generate{" "}
                <strong>61.1%</strong> of represented views—101.25B combined.
              </p>
              <p className="story-note">
                Entertainment leads Music by 15.41B views, while the remaining
                five groups divide the final 38.9%.
              </p>
              <div className="story-source">
                <span>Gold source</span>
                <code>category_analytics</code>
                <small>Category × region × date</small>
              </div>
            </aside>

            <article className="category-panel story-visual">
            <div className="panel-head">
              <div>
                  <p className="eyebrow">Share of represented views</p>
                  <h3>Category composition</h3>
              </div>
              <span className="unit-label">all active regions</span>
            </div>
            <div
                className="category-ranking"
                role="img"
                aria-label="Entertainment 35.2 percent, Music 25.9 percent, Other 11.3 percent, Film and Animation 9.2 percent, Comedy 7.1 percent, People and Blogs 7.1 percent, and News and Politics 4.2 percent"
            >
                {[...categories]
                  .sort((a, b) => b.share - a.share)
                  .map((category, index) => (
                  <div
                      className={index < 2 ? "is-leading" : ""}
                  key={category.name}
                  >
                    <span className="category-rank">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="category-name">{category.name}</span>
                    <span className="category-bar">
                      <span
                        style={{
                          "--category-width": `${(category.share / 35.2) * 100}%`,
                          "--category-color": category.color,
                        } as CSSProperties}
                      />
                    </span>
                    <strong>{category.share.toFixed(1)}%</strong>
                    <small>{category.views.toFixed(2)}B views</small>
                  </div>
                ))}
            </div>
          </article>
          </section>

          <section
            className="story-chapter"
            id="chapter-staying-power"
            aria-labelledby="story-staying-power"
          >
            <aside className="story-copy">
              <span className="story-number">03</span>
              <p className="eyebrow">Who sustains it</p>
              <h3 id="story-staying-power">Reach and persistence are different.</h3>
              <p className="story-takeaway">
                <strong>T-Series</strong> leads on both: 6.31B views across 688
                trending appearances.
              </p>
              <p className="story-note">
                Amit Bhadana is fifth by views at 3.06B, but second by persistence
                with 428 appearances.
              </p>
              <div className="story-source">
                <span>Gold source</span>
                <code>channel_analytics</code>
                <small>Channel × region</small>
              </div>
            </aside>

            <article className="channels-panel story-visual">
          <div className="panel-head">
            <div>
                  <p className="eyebrow">Cross-region leaders</p>
                  <h3>Reach versus persistence</h3>
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
                {channelSort === "views"
                  ? "Ranked by represented views"
                  : "Ranked by trending appearances"}
          </p>
              <ol className="channel-leaderboard">
                {sortedChannels.map((channel, index) => (
                  <li key={`${channel.name}-${channel.region}`}>
                    <span className="channel-rank">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p>
                      <strong>{channel.name}</strong>
                      <small>{channel.region}</small>
                    </p>
                    <span className="channel-bar">
                      <span
                        style={{
                          "--channel-width": `${(channel[channelSort] / maxChannelMetric) * 100}%`,
                        } as CSSProperties}
                      />
                    </span>
                    <dl>
                      <div>
                        <dt>Views</dt>
                        <dd>{channel.views.toFixed(2)}B</dd>
                      </div>
                      <div>
                        <dt>Appearances</dt>
                        <dd>{channel.appearances}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
        </article>
          </section>
        </div>

        <div className="gold-provenance">
          <p>
            Three Gold grains, read as one story.
            <span>Captured 18 Jul 2026 · deduplicated latest aggregates</span>
          </p>
          <ul aria-label="Gold tables used">
            <li>trending_analytics</li>
            <li>category_analytics</li>
            <li>channel_analytics</li>
          </ul>
        </div>
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
          A sanitized product demo of the YouTube Trending Data Pipeline.
          No AWS credentials are exposed to the browser.
        </p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
