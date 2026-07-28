"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

type RegionalMetric = "views" | "observations" | "engagement";
type ChannelSort = "views" | "appearances";
type GoldMart = "trending" | "category" | "channel";
type CategoryMetric = "share" | "views";

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
    metric: "375,942 observations · 498.7B views",
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
    metric: "498.7B represented views",
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
  { code: "CA", name: "Canada", views: 46.9, observations: 40881, engagement: 3.89, topSignal: "Marvel Entertainment" },
  { code: "DE", name: "Germany", views: 24.6, observations: 40840, engagement: 4.09, topSignal: "Marvel Entertainment" },
  { code: "FR", name: "France", views: 17.1, observations: 40724, engagement: 4.58, topSignal: "Dude Perfect" },
  { code: "GB", name: "United Kingdom", views: 230.1, observations: 38916, engagement: 2.5, topSignal: "NickyJamTV" },
  { code: "IN", name: "India", views: 39.6, observations: 37352, engagement: 2.81, topSignal: "T-Series" },
  { code: "JP", name: "Japan", views: 5.4, observations: 20523, engagement: 3.53, topSignal: "ibighit" },
  { code: "KR", name: "South Korea", views: 14.7, observations: 34567, engagement: 3.34, topSignal: "Marvel Entertainment" },
  { code: "MX", name: "Mexico", views: 13.8, observations: 40451, engagement: 5.23, topSignal: "Marvel Entertainment" },
  { code: "RU", name: "Russia", views: 9.8, observations: 40739, engagement: 5.9, topSignal: "ibighit" },
  { code: "US", name: "United States", views: 96.7, observations: 40949, engagement: 3.5, topSignal: "ChildishGambinoVEVO" },
];

const channels = [
  { name: "Marvel Entertainment", region: "CA", views: 1.01, appearances: 39 },
  { name: "T-Series", region: "CA", views: 0.8, appearances: 81 },
  { name: "Dude Perfect", region: "CA", views: 0.73, appearances: 70 },
  { name: "YouTube Spotlight", region: "CA", views: 0.64, appearances: 13 },
  { name: "ibighit", region: "CA", views: 0.51, appearances: 19 },
  { name: "Marvel Entertainment", region: "DE", views: 0.59, appearances: 20 },
  { name: "Dude Perfect", region: "DE", views: 0.41, appearances: 44 },
  { name: "ibighit", region: "DE", views: 0.37, appearances: 15 },
  { name: "YouTube Spotlight", region: "DE", views: 0.37, appearances: 6 },
  { name: "PewDiePie", region: "DE", views: 0.31, appearances: 85 },
  { name: "Dude Perfect", region: "FR", views: 0.31, appearances: 34 },
  { name: "ibighit", region: "FR", views: 0.29, appearances: 15 },
  { name: "YouTube Spotlight", region: "FR", views: 0.25, appearances: 5 },
  { name: "PewDiePie", region: "FR", views: 0.24, appearances: 71 },
  { name: "Marvel Entertainment", region: "FR", views: 0.22, appearances: 16 },
  { name: "NickyJamTV", region: "GB", views: 8.52, appearances: 56 },
  { name: "Ozuna", region: "GB", views: 8.31, appearances: 85 },
  { name: "Bad Bunny", region: "GB", views: 6.89, appearances: 36 },
  { name: "DrakeVEVO", region: "GB", views: 6.58, appearances: 62 },
  { name: "ChildishGambinoVEVO", region: "GB", views: 6.1, appearances: 36 },
  { name: "T-Series", region: "IN", views: 2.12, appearances: 221 },
  { name: "Marvel Entertainment", region: "IN", views: 1.28, appearances: 65 },
  { name: "FoxStarHindi", region: "IN", views: 1.26, appearances: 56 },
  { name: "Amit Bhadana", region: "IN", views: 1.02, appearances: 140 },
  { name: "Speed Records", region: "IN", views: 0.8, appearances: 197 },
  { name: "ibighit", region: "JP", views: 0.34, appearances: 14 },
  { name: "Marvel Entertainment", region: "JP", views: 0.15, appearances: 15 },
  { name: "MLG Highlights", region: "JP", views: 0.11, appearances: 56 },
  { name: "Sony Pictures Entertainment", region: "JP", views: 0.09, appearances: 6 },
  { name: "SpaceX", region: "JP", views: 0.08, appearances: 8 },
  { name: "Marvel Entertainment", region: "KR", views: 0.95, appearances: 29 },
  { name: "ibighit", region: "KR", views: 0.89, appearances: 33 },
  { name: "jypentertainment", region: "KR", views: 0.36, appearances: 38 },
  { name: "YouTube Spotlight", region: "KR", views: 0.34, appearances: 4 },
  { name: "ChildishGambinoVEVO", region: "KR", views: 0.24, appearances: 6 },
  { name: "Marvel Entertainment", region: "MX", views: 0.38, appearances: 19 },
  { name: "YouTube Spotlight", region: "MX", views: 0.26, appearances: 7 },
  { name: "ibighit", region: "MX", views: 0.25, appearances: 13 },
  { name: "MalumaVEVO", region: "MX", views: 0.23, appearances: 20 },
  { name: "Dude Perfect", region: "MX", views: 0.17, appearances: 25 },
  { name: "ibighit", region: "RU", views: 0.24, appearances: 11 },
  { name: "Трум Трум", region: "RU", views: 0.18, appearances: 144 },
  { name: "PewDiePie", region: "RU", views: 0.15, appearances: 50 },
  { name: "вДудь", region: "RU", views: 0.13, appearances: 55 },
  { name: "Алексей Навальный", region: "RU", views: 0.13, appearances: 102 },
  { name: "ChildishGambinoVEVO", region: "US", views: 3.76, appearances: 25 },
  { name: "ibighit", region: "US", views: 2.24, appearances: 80 },
  { name: "Dude Perfect", region: "US", views: 1.87, appearances: 131 },
  { name: "Marvel Entertainment", region: "US", views: 1.81, appearances: 125 },
  { name: "ArianaGrandeVevo", region: "US", views: 1.58, appearances: 43 },
];

const categoryColors = [
  "var(--coral)",
  "var(--gold)",
  "var(--sage)",
  "var(--bronze)",
  "var(--ink-soft)",
  "var(--blue)",
  "var(--line-strong)",
];

const categorySharesByRegion: Record<string, Array<[string, number]>> = {
  ALL: [["Music", 51.3], ["Entertainment", 21], ["Other", 8.9], ["Film & Animation", 5.4], ["People & Blogs", 4.5], ["Comedy", 4.4], ["Sports", 3.6]],
  CA: [["Entertainment", 29.2], ["Music", 28.1], ["Comedy", 7.9], ["People & Blogs", 6.9], ["Sports", 6.4], ["Film & Animation", 6.3], ["Other", 15.3]],
  DE: [["Entertainment", 32.9], ["Music", 23.1], ["People & Blogs", 8.9], ["Sports", 7.9], ["Film & Animation", 7.1], ["Comedy", 6.7], ["Other", 13.5]],
  FR: [["Music", 29.4], ["Entertainment", 22.1], ["Sports", 11.7], ["Comedy", 11.1], ["People & Blogs", 7.5], ["Film & Animation", 5.4], ["Other", 12.9]],
  GB: [["Music", 74.4], ["Entertainment", 12.9], ["Film & Animation", 3.6], ["People & Blogs", 2.5], ["Comedy", 1.7], ["Sports", 1.5], ["Other", 3.3]],
  IN: [["Entertainment", 40.7], ["Music", 25.6], ["Film & Animation", 9.7], ["Comedy", 7.3], ["News & Politics", 5], ["Sports", 3.5], ["Other", 8.2]],
  JP: [["Entertainment", 32.8], ["Music", 19.9], ["People & Blogs", 10.9], ["Sports", 10.8], ["Film & Animation", 5.8], ["Comedy", 5.2], ["Other", 14.5]],
  KR: [["Entertainment", 31.1], ["Music", 25.8], ["People & Blogs", 10.1], ["Film & Animation", 8.1], ["News & Politics", 8], ["Comedy", 5], ["Other", 11.8]],
  MX: [["Music", 30], ["Entertainment", 29.1], ["Sports", 10], ["People & Blogs", 8.9], ["Comedy", 5.7], ["News & Politics", 3.5], ["Other", 12.7]],
  RU: [["Entertainment", 21.3], ["Music", 16.4], ["People & Blogs", 16], ["Comedy", 10.4], ["News & Politics", 7.5], ["Film & Animation", 5.5], ["Other", 22.9]],
  US: [["Music", 41.5], ["Entertainment", 21.3], ["Film & Animation", 7.5], ["Comedy", 5.3], ["People & Blogs", 5.1], ["Sports", 4.6], ["Other", 14.7]],
};

const totalRegionalViews = regionData.reduce((sum, region) => sum + region.views, 0);
const categoriesByRegion = Object.fromEntries(
  Object.entries(categorySharesByRegion).map(([regionCode, rows]) => {
    const regionViews =
      regionCode === "ALL"
        ? totalRegionalViews
        : regionData.find((region) => region.code === regionCode)?.views ?? 0;
    return [
      regionCode,
      rows.map(([name, share], index) => ({
        name,
        share,
        views: Number(((regionViews * share) / 100).toFixed(2)),
        color: categoryColors[index],
      })),
    ];
  }),
);
const categories = categoriesByRegion.ALL;

type ExecutionNodeStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
type ExecutionStatus =
  | "IDLE"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "ABORTED";
type ExecutionView = "graph" | "table" | "io";

type StepExecution = {
  configured?: boolean;
  executionArn?: string;
  name?: string;
  status?: ExecutionStatus;
  startedAt?: string;
  stoppedAt?: string;
  input?: string;
  output?: string;
  states?: Record<string, ExecutionNodeStatus>;
  events?: Array<{
    id?: number;
    timestamp?: string;
    type?: string;
    state?: string;
  }>;
  error?: string;
};

const stepGraphNodes = [
  { id: "IngestFromYouTubeAPI", label: "IngestFromYouTubeAPI", type: "Task", icon: "λ", x: 44, y: 72 },
  { id: "WaitForS3Consistency", label: "WaitForS3Consistency", type: "Wait", icon: "◷", x: 254, y: 72 },
  { id: "ProcessInParallel", label: "ProcessInParallel", type: "Parallel", icon: "⇉", x: 464, y: 72 },
  { id: "TransformReferenceData", label: "TransformReferenceData", type: "Lambda invoke", icon: "λ", x: 674, y: 18 },
  { id: "RunBronzeToSilverGlueJob", label: "RunBronzeToSilverGlueJob", type: "Glue .sync", icon: "◆", x: 674, y: 126 },
  { id: "RunDataQualityChecks", label: "RunDataQualityChecks", type: "Task", icon: "λ", x: 884, y: 72 },
  { id: "EvaluateDataQuality", label: "EvaluateDataQuality", type: "Choice", icon: "◇", x: 1094, y: 72 },
  { id: "RunSilverToGoldGlueJob", label: "RunSilverToGoldGlueJob", type: "Glue .sync", icon: "◆", x: 1304, y: 72 },
  { id: "NotifySuccess", label: "NotifySuccess", type: "SNS publish", icon: "✉", x: 1514, y: 72 },
  { id: "NotifyIngestionFailure", label: "NotifyIngestionFailure", type: "SNS publish", icon: "✉", x: 44, y: 222, path: "failure" },
  { id: "NotifyTransformFailure", label: "NotifyTransformFailure", type: "SNS publish", icon: "✉", x: 464, y: 222, path: "failure" },
  { id: "NotifyDQFailure", label: "NotifyDQFailure", type: "SNS publish", icon: "✉", x: 1094, y: 222, path: "failure" },
  { id: "NotifyGoldFailure", label: "NotifyGoldFailure", type: "SNS publish", icon: "✉", x: 1304, y: 222, path: "failure" },
] as const;

const stepGraphEdges: Array<{
  from: string;
  to: string;
  kind?: "failure";
}> = [
  { from: "IngestFromYouTubeAPI", to: "WaitForS3Consistency" },
  { from: "WaitForS3Consistency", to: "ProcessInParallel" },
  { from: "ProcessInParallel", to: "TransformReferenceData" },
  { from: "ProcessInParallel", to: "RunBronzeToSilverGlueJob" },
  { from: "TransformReferenceData", to: "RunDataQualityChecks" },
  { from: "RunBronzeToSilverGlueJob", to: "RunDataQualityChecks" },
  { from: "RunDataQualityChecks", to: "EvaluateDataQuality" },
  { from: "EvaluateDataQuality", to: "RunSilverToGoldGlueJob" },
  { from: "RunSilverToGoldGlueJob", to: "NotifySuccess" },
  { from: "IngestFromYouTubeAPI", to: "NotifyIngestionFailure", kind: "failure" },
  { from: "ProcessInParallel", to: "NotifyTransformFailure", kind: "failure" },
  { from: "RunDataQualityChecks", to: "NotifyDQFailure", kind: "failure" },
  { from: "EvaluateDataQuality", to: "NotifyDQFailure", kind: "failure" },
  { from: "RunSilverToGoldGlueJob", to: "NotifyGoldFailure", kind: "failure" },
] as const;

function stepEdgePath(fromId: string, toId: string, kind?: string) {
  const from = stepGraphNodes.find((node) => node.id === fromId)!;
  const to = stepGraphNodes.find((node) => node.id === toId)!;
  if (kind === "failure") {
    const startX = from.x + 85;
    const startY = from.y + 68;
    const endX = to.x + 85;
    const endY = to.y;
    const middleY = startY + (endY - startY) / 2;
    return `M ${startX} ${startY} V ${middleY} H ${endX} V ${endY}`;
  }
  const startX = from.x + 170;
  const startY = from.y + 34;
  const endX = to.x;
  const endY = to.y + 34;
  const middleX = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact" });

export default function Home() {
  const [activeStage, setActiveStage] =
    useState<ArchitectureStageId>("sources");
  const [activeMart, setActiveMart] = useState<GoldMart>("trending");
  const [activeRegion, setActiveRegion] = useState("ALL");
  const [regionalMetric, setRegionalMetric] =
    useState<RegionalMetric>("views");
  const [channelSort, setChannelSort] = useState<ChannelSort>("views");
  const [channelRegion, setChannelRegion] = useState("ALL");
  const [channelQuery, setChannelQuery] = useState("");
  const [categoryRegion, setCategoryRegion] = useState("ALL");
  const [categoryMetric, setCategoryMetric] =
    useState<CategoryMetric>("share");
  const [categoryFocus, setCategoryFocus] = useState("ALL");
  const [stepExecution, setStepExecution] = useState<StepExecution>({
    status: "IDLE",
  });
  const [stepBusy, setStepBusy] = useState(false);
  const [executionView, setExecutionView] =
    useState<ExecutionView>("graph");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/step-functions")
      .then((response) => response.json())
      .then((payload: StepExecution) => {
        if (!cancelled) {
          setStepExecution(
            payload.executionArn
              ? payload
              : (current) => ({
                  ...current,
                  configured: payload.configured,
                }),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStepExecution((current) => ({
            ...current,
            configured: false,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !stepExecution.executionArn ||
      stepExecution.status !== "RUNNING"
    ) {
      return;
    }

    const executionArn = stepExecution.executionArn;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/step-functions?executionArn=${encodeURIComponent(executionArn)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as StepExecution;
        setStepExecution(payload);
      } catch {
        setStepExecution((current) => ({
          ...current,
          error: "The execution is still running, but the latest status could not be loaded.",
        }));
      }
    }, 2500);

    return () => window.clearInterval(poll);
  }, [stepExecution.executionArn, stepExecution.status]);

  const selectedStage = useMemo(
    () =>
      pipelineStages.find((stage) => stage.id === activeStage) ??
      pipelineStages[0],
    [activeStage],
  );
  const visibleRegions = useMemo(
    () =>
      activeRegion === "ALL"
        ? regionData
        : regionData.filter((region) => region.code === activeRegion),
    [activeRegion],
  );
  const selectedRegion =
    regionData.find((region) => region.code === activeRegion) ?? null;
  const sortedChannels = useMemo(
    () =>
      [...channels]
        .filter(
          (channel) =>
            (channelRegion === "ALL" || channel.region === channelRegion) &&
            channel.name.toLowerCase().includes(channelQuery.toLowerCase()),
        )
        .sort((a, b) =>
          channelSort === "views"
            ? b.views - a.views
            : b.appearances - a.appearances,
        ),
    [channelQuery, channelRegion, channelSort],
  );
  const categoryRows = (
    categoriesByRegion[categoryRegion as keyof typeof categoriesByRegion] ??
    categories
  ).filter(
    (category) => categoryFocus === "ALL" || category.name === categoryFocus,
  );
  const maxRegionalMetric = Math.max(
    ...regionData.map((region) => region[regionalMetric]),
  );
  const maxChannelMetric = Math.max(
    ...sortedChannels.map((channel) => channel[channelSort]),
    1,
  );
  const maxCategoryMetric = Math.max(
    ...categoryRows.map((category) => category[categoryMetric]),
    1,
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

  async function startStepExecution() {
    setStepBusy(true);
    setStepExecution((current) => ({
      ...current,
      error: undefined,
    }));
    try {
      const response = await fetch("/api/step-functions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ regions: regionData.map((region) => region.code) }),
      });
      const payload = (await response.json()) as StepExecution;
      if (!response.ok) throw new Error(payload.error ?? "Execution could not be started.");
      setStepExecution(payload);
    } catch (error) {
      setStepExecution((current) => ({
        ...current,
        status: current.status === "RUNNING" ? current.status : "IDLE",
        error:
          error instanceof Error
            ? error.message
            : "Execution could not be started.",
      }));
    } finally {
      setStepBusy(false);
    }
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
          <a href="#executions">Executions</a>
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
          <strong>375,942</strong>
          <span>trending observations</span>
        </div>
        <div>
          <strong>498.7B</strong>
          <span>views represented</span>
        </div>
        <div>
          <strong>10</strong>
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

      <section className="execution-section" id="executions">
        <header className="section-heading execution-heading">
          <div>
            <p className="eyebrow">AWS operations · live control plane</p>
            <h2>Run the state machine. Watch every state change.</h2>
          </div>
          <p>
            This console starts the deployed Step Functions workflow through the
            server-side AWS environment, then polls execution history until the
            run reaches a terminal state.
          </p>
        </header>

        <div className="aws-console">
          <div className="aws-console-topbar">
            <div className="aws-console-brand">
              <span className="aws-cube" aria-hidden="true">◆</span>
              <strong>Step Functions</strong>
            </div>
            <div className="aws-console-context">
              <span>State machines</span>
              <span aria-hidden="true">›</span>
              <strong>yt-data-pipeline-orchestration</strong>
            </div>
            <span className="aws-region">N. Virginia</span>
          </div>

          <div className="aws-execution-header">
            <div>
              <p className="aws-breadcrumb">Executions / {stepExecution.name ?? "New execution"}</p>
              <h3>{stepExecution.name ?? "yt-data-pipeline-orchestration"}</h3>
              <div className="aws-execution-meta">
                <span
                  className={`aws-status aws-status-${(stepExecution.status ?? "IDLE").toLowerCase()}`}
                >
                  <i aria-hidden="true" />
                  {stepExecution.status === "IDLE"
                    ? "Ready"
                    : stepExecution.status}
                </span>
                <span>
                  {stepExecution.startedAt
                    ? `Started ${new Date(stepExecution.startedAt).toLocaleString()}`
                    : `${regionData.length} configured regions`}
                </span>
                <span>Standard workflow</span>
              </div>
            </div>
            <div className="aws-execution-actions">
              <a
                href="https://console.aws.amazon.com/states/home?region=us-east-1#/statemachines"
                target="_blank"
                rel="noreferrer"
              >
                Open in AWS
              </a>
              <button
                type="button"
                onClick={startStepExecution}
                disabled={stepBusy || stepExecution.status === "RUNNING"}
              >
                <span aria-hidden="true">▶</span>
                {stepBusy
                  ? "Starting…"
                  : stepExecution.status === "RUNNING"
                    ? "Execution running"
                    : "Start new execution"}
              </button>
            </div>
          </div>

          {stepExecution.error && (
            <div className="aws-alert" role="alert">
              <strong>Execution request was not completed.</strong>
              <span>{stepExecution.error}</span>
            </div>
          )}

          <div className="aws-console-tabs" role="tablist" aria-label="Execution views">
            {([
              ["graph", "Graph view"],
              ["table", "Table view"],
              ["io", "Execution input and output"],
            ] as const).map(([view, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={executionView === view}
                aria-controls={`execution-${view}-panel`}
                onClick={() => setExecutionView(view)}
                key={view}
              >
                {label}
              </button>
            ))}
          </div>

          {executionView === "graph" && (
            <div
              className="aws-console-workspace"
              id="execution-graph-panel"
              role="tabpanel"
            >
              <aside className="aws-state-list" aria-label="Execution states">
                <div>
                  <strong>States</strong>
                  <span>{stepGraphNodes.length}</span>
                </div>
                <ol>
                  {stepGraphNodes.map((node, index) => {
                    const status =
                      stepExecution.states?.[node.id] ??
                      ("PENDING" as ExecutionNodeStatus);
                    return (
                      <li className={`is-${status.toLowerCase()}`} key={node.id}>
                        <span>{index + 1}</span>
                        <p><strong>{node.label}</strong><small>{node.type}</small></p>
                        <i aria-label={status} />
                      </li>
                    );
                  })}
                </ol>
              </aside>

              <div className="aws-graph-scroll" role="region" aria-label="AWS Step Functions execution graph" tabIndex={0}>
                <div className="aws-graph-canvas">
                  <svg viewBox="0 0 1730 330" aria-hidden="true">
                    <defs>
                      <marker id="step-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                        <path d="M 0 0 L 8 4 L 0 8 z" />
                      </marker>
                      <marker id="step-arrow-failure" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                        <path d="M 0 0 L 8 4 L 0 8 z" />
                      </marker>
                    </defs>
                    {stepGraphEdges.map((edge) => (
                      <path
                        className={edge.kind === "failure" ? "is-failure" : ""}
                        d={stepEdgePath(edge.from, edge.to, edge.kind)}
                        key={`${edge.from}-${edge.to}`}
                      />
                    ))}
                  </svg>
                  {stepGraphNodes.map((node) => {
                    const status =
                      stepExecution.states?.[node.id] ??
                      ("PENDING" as ExecutionNodeStatus);
                    return (
                      <article
                        className={`aws-state-node is-${status.toLowerCase()} ${"path" in node && node.path === "failure" ? "is-notification" : ""}`}
                        style={{ left: node.x, top: node.y }}
                        key={node.id}
                      >
                        <span>{node.icon}</span>
                        <p><strong>{node.label}</strong><small>{node.type}</small></p>
                        <i aria-label={status} />
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {executionView === "table" && (
            <div
              className="aws-state-table-panel"
              id="execution-table-panel"
              role="tabpanel"
            >
              <div className="aws-state-table-row is-heading">
                <span>#</span><span>State name</span><span>Type</span><span>Path</span><span>Status</span>
              </div>
              {stepGraphNodes.map((node, index) => {
                const status =
                  stepExecution.states?.[node.id] ??
                  ("PENDING" as ExecutionNodeStatus);
                return (
                  <div className="aws-state-table-row" key={node.id}>
                    <span>{index + 1}</span>
                    <strong>{node.label}</strong>
                    <span>{node.type}</span>
                    <span>{"path" in node && node.path === "failure" ? "Failure → SNS" : "Main workflow"}</span>
                    <span className={`aws-table-status is-${status.toLowerCase()}`}>
                      <i aria-hidden="true" />{status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {executionView === "io" && (
            <div
              className="aws-io-panel"
              id="execution-io-panel"
              role="tabpanel"
            >
              <section>
                <h4>Execution input</h4>
                <pre>{stepExecution.input ?? "Input appears after an execution starts."}</pre>
              </section>
              <section>
                <h4>Execution output</h4>
                <pre>{stepExecution.output ?? (stepExecution.status === "RUNNING" ? "Execution is still running." : "Output appears after an execution completes.")}</pre>
              </section>
            </div>
          )}

          <div className="aws-history">
            <div className="aws-history-head">
              <div><h4>Events</h4><span>{stepExecution.events?.length ?? 0} recent</span></div>
              <span>Execution history updates every 2.5 seconds while running</span>
            </div>
            <div className="aws-history-table">
              <div className="aws-history-row is-heading">
                <span>ID</span><span>Timestamp</span><span>Type</span><span>State</span>
              </div>
              {(stepExecution.events?.length
                ? stepExecution.events
                : [
                    {
                      id: 0,
                      timestamp: undefined,
                      type: "Waiting for a new execution",
                      state: "—",
                    },
                  ]
              ).map((event) => (
                <div className="aws-history-row" key={`${event.id}-${event.type}`}>
                  <span>{event.id || "—"}</span>
                  <span>{event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : "—"}</span>
                  <span>{event.type}</span>
                  <span>{event.state ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="analytics-section" id="analytics">
        <header className="section-heading analytics-heading">
          <div>
            <p className="eyebrow">Gold layer · mart-led analytics</p>
            <h2>Three marts. Three focused dashboards.</h2>
          </div>
          <p>
            Choose the business question first. Every filter, metric, and chart
            below stays inside the selected mart&apos;s grain.
          </p>
        </header>

        <div className="mart-switcher" role="tablist" aria-label="Gold marts">
          {([
            {
              id: "trending",
              number: "01",
              table: "trending_analytics",
              title: "Market pulse",
              grain: "Region × trending date",
              question: "Where and when is attention moving?",
            },
            {
              id: "category",
              number: "02",
              table: "category_analytics",
              title: "Content mix",
              grain: "Category × region × date",
              question: "Which topics earn the audience?",
            },
            {
              id: "channel",
              number: "03",
              table: "channel_analytics",
              title: "Channel leaders",
              grain: "Channel × region",
              question: "Who combines reach with persistence?",
            },
          ] as const).map((mart) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeMart === mart.id}
              aria-controls={`mart-panel-${mart.id}`}
              onClick={() => setActiveMart(mart.id)}
              key={mart.id}
            >
              <span>{mart.number}</span>
              <strong>{mart.title}</strong>
              <code>{mart.table}</code>
              <small>{mart.question}</small>
              <em>{mart.grain}</em>
            </button>
          ))}
        </div>

        <div className="mart-dashboard">
          {activeMart === "trending" && (
            <section id="mart-panel-trending" role="tabpanel" className="mart-panel">
              <header className="mart-panel-head">
                <div><p className="eyebrow">Dashboard 01 · market pulse</p><h3>Regional trending performance</h3><p>Compare reach, volume, and engagement without leaving the region-by-date grain.</p></div>
                <div><span>Gold source</span><code>trending_analytics</code><small>region × trending_date_parsed</small></div>
              </header>
              <div className="mart-filters" aria-label="Trending analytics filters">
                <label>Region<select value={activeRegion} onChange={(event) => setActiveRegion(event.target.value)}><option value="ALL">All regions</option>{regionData.map((region) => <option value={region.code} key={region.code}>{region.name}</option>)}</select></label>
                <fieldset><legend>Metric</legend>{([["views","Views"],["observations","Videos"],["engagement","Engagement"]] as [RegionalMetric,string][]).map(([metric,label]) => <button type="button" aria-pressed={regionalMetric === metric} onClick={() => setRegionalMetric(metric)} key={metric}>{label}</button>)}</fieldset>
                <label>Date coverage<span className="filter-static">Captured period · 2017–2018</span></label>
              </div>
              <dl className="mart-kpis">
                <div><dt>Views represented</dt><dd>{visibleRegions.reduce((sum, region) => sum + region.views, 0).toFixed(1)}B</dd></div>
                <div><dt>Trending videos</dt><dd>{compact.format(visibleRegions.reduce((sum, region) => sum + region.observations, 0))}</dd></div>
                <div><dt>Average engagement</dt><dd>{(visibleRegions.reduce((sum, region) => sum + region.engagement, 0) / visibleRegions.length).toFixed(2)}%</dd></div>
                <div><dt>Regions in scope</dt><dd>{visibleRegions.length}</dd></div>
              </dl>
              <div className="mart-visual-grid">
                <article className="mart-chart-card">
                  <div className="panel-head"><div><p className="eyebrow">{regionalMetricMeta.unit}</p><h3>{regionalMetricMeta.label} by region</h3></div></div>
                  <div className="region-chart" aria-label={`${regionalMetricMeta.label} by region`}>
                    {visibleRegions.map((region) => <button type="button" className="region-row" key={region.code} onClick={() => setActiveRegion(region.code)}><span className="region-code">{region.code}</span><span className="bar-rail"><span className="bar-fill" style={{"--bar-width":`${(region[regionalMetric] / maxRegionalMetric) * 100}%`} as CSSProperties} /></span><strong>{formatRegionalMetric(region[regionalMetric])}</strong></button>)}
                  </div>
                </article>
                <aside className="mart-reading" aria-live="polite">
                  <span>What this mart says</span>
                  <h4>{selectedRegion ? `${selectedRegion.name} in focus` : "India carries most represented reach."}</h4>
                  <p>{selectedRegion ? `${selectedRegion.views.toFixed(1)}B views, ${compact.format(selectedRegion.observations)} trending observations, and ${selectedRegion.engagement.toFixed(2)}% average engagement.` : "Use region to isolate one market, then switch the metric without changing the dashboard grain."}</p>
                </aside>
              </div>
            </section>
          )}

          {activeMart === "category" && (
            <section id="mart-panel-category" role="tabpanel" className="mart-panel">
              <header className="mart-panel-head">
                <div><p className="eyebrow">Dashboard 02 · content mix</p><h3>Category attention share</h3><p>See which content categories capture views inside a selected regional market.</p></div>
                <div><span>Gold source</span><code>category_analytics</code><small>category × region × trending date</small></div>
              </header>
              <div className="mart-filters" aria-label="Category analytics filters">
                <label>Region<select value={categoryRegion} onChange={(event) => setCategoryRegion(event.target.value)}><option value="ALL">All regions</option>{regionData.map((region) => <option value={region.code} key={region.code}>{region.name}</option>)}</select></label>
                <label>Category<select value={categoryFocus} onChange={(event) => setCategoryFocus(event.target.value)}><option value="ALL">All categories</option>{categories.map((category) => <option value={category.name} key={category.name}>{category.name}</option>)}</select></label>
                <fieldset><legend>Metric</legend><button type="button" aria-pressed={categoryMetric === "share"} onClick={() => setCategoryMetric("share")}>View share</button><button type="button" aria-pressed={categoryMetric === "views"} onClick={() => setCategoryMetric("views")}>Views</button></fieldset>
              </div>
              <dl className="mart-kpis">
                <div><dt>Leading category</dt><dd>{categoryRows[0]?.name ?? "—"}</dd></div>
                <div><dt>Leading share</dt><dd>{categoryRows[0]?.share.toFixed(1) ?? "0"}%</dd></div>
                <div><dt>Views in scope</dt><dd>{categoryRows.reduce((sum, category) => sum + category.views, 0).toFixed(1)}B</dd></div>
                <div><dt>Categories shown</dt><dd>{categoryRows.length}</dd></div>
              </dl>
              <article className="mart-chart-card mart-chart-wide">
                <div className="panel-head"><div><p className="eyebrow">{categoryRegion === "ALL" ? "All active regions" : regionData.find((region) => region.code === categoryRegion)?.name}</p><h3>{categoryMetric === "share" ? "Share of views" : "Represented views"}</h3></div></div>
                <div className="category-ranking">{[...categoryRows].sort((a,b) => b[categoryMetric] - a[categoryMetric]).map((category,index) => <div className={index < 2 ? "is-leading" : ""} key={category.name}><span className="category-rank">{String(index+1).padStart(2,"0")}</span><span className="category-name">{category.name}</span><span className="category-bar"><span style={{"--category-width":`${(category[categoryMetric] / maxCategoryMetric) * 100}%`,"--category-color":category.color} as CSSProperties}/></span><strong>{categoryMetric === "share" ? `${category.share.toFixed(1)}%` : `${category.views.toFixed(2)}B`}</strong><small>{category.views.toFixed(2)}B views</small></div>)}</div>
              </article>
            </section>
          )}

          {activeMart === "channel" && (
            <section id="mart-panel-channel" role="tabpanel" className="mart-panel">
              <header className="mart-panel-head">
                <div><p className="eyebrow">Dashboard 03 · channel leaders</p><h3>Reach versus persistence</h3><p>Rank channels inside a region by represented views or repeat trending appearances.</p></div>
                <div><span>Gold source</span><code>channel_analytics</code><small>channel_title × region</small></div>
              </header>
              <div className="mart-filters" aria-label="Channel analytics filters">
                <label>Region<select value={channelRegion} onChange={(event) => setChannelRegion(event.target.value)}><option value="ALL">All regions</option>{regionData.map((region) => <option value={region.code} key={region.code}>{region.name}</option>)}</select></label>
                <label>Channel search<input type="search" value={channelQuery} onChange={(event) => setChannelQuery(event.target.value)} placeholder="Search channels" /></label>
                <fieldset><legend>Rank by</legend><button type="button" aria-pressed={channelSort === "views"} onClick={() => setChannelSort("views")}>Views</button><button type="button" aria-pressed={channelSort === "appearances"} onClick={() => setChannelSort("appearances")}>Persistence</button></fieldset>
              </div>
              <dl className="mart-kpis">
                <div><dt>Top channel</dt><dd>{sortedChannels[0]?.name ?? "—"}</dd></div>
                <div><dt>Top views</dt><dd>{sortedChannels[0]?.views.toFixed(2) ?? "0"}B</dd></div>
                <div><dt>Top appearances</dt><dd>{Math.max(...sortedChannels.map((channel) => channel.appearances),0)}</dd></div>
                <div><dt>Channels in scope</dt><dd>{sortedChannels.length}</dd></div>
              </dl>
              <article className="mart-chart-card mart-chart-wide">
                <div className="panel-head"><div><p className="eyebrow">{channelRegion === "ALL" ? "Cross-region leaders" : `${channelRegion} leaders`}</p><h3>{channelSort === "views" ? "Ranked by views" : "Ranked by trending persistence"}</h3></div></div>
                <ol className="channel-leaderboard">{sortedChannels.slice(0,8).map((channel,index) => <li key={`${channel.name}-${channel.region}`}><span className="channel-rank">{String(index+1).padStart(2,"0")}</span><p><strong>{channel.name}</strong><small>{channel.region}</small></p><span className="channel-bar"><span style={{"--channel-width":`${(channel[channelSort] / maxChannelMetric) * 100}%`} as CSSProperties}/></span><dl><div><dt>Views</dt><dd>{channel.views.toFixed(2)}B</dd></div><div><dt>Appearances</dt><dd>{channel.appearances}</dd></div></dl></li>)}</ol>
                {sortedChannels.length === 0 && <p className="mart-empty">No channels match this filter.</p>}
              </article>
            </section>
          )}
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
