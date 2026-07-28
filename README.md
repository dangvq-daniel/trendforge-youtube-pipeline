# TrendForge — YouTube Trending Data Pipeline

An interactive product demo for a production-style AWS data pipeline that
collects regional YouTube trending data, validates it, builds analytics marts,
and exposes the results through focused dashboards.

[View the live demo](https://trendforge-youtube-pipeline.onrender.com/)

## What the Demo Includes

- A service-level DAG showing ingestion, Bronze, Silver, quality, Gold, and
  consumption dependencies
- AWS product imagery and directional success and failure paths
- A live Step Functions console with graph, table, input, output, and event views
- Server-side execution controls with status polling
- SNS notification branches for ingestion, transformation, data-quality, and
  Gold aggregation failures
- Mart-led dashboards with filters that match each table's grain
- Regional coverage for Canada, France, Germany, India, Japan, Mexico, Russia,
  South Korea, the United Kingdom, and the United States

## Analytics Marts

| Mart | Grain | Primary question |
| --- | --- | --- |
| `trending_analytics` | Region × trending date | Where and when is attention moving? |
| `category_analytics` | Category × region × date | Which topics earn the audience? |
| `channel_analytics` | Channel × region | Which channels combine reach and persistence? |

The included dataset represents 375,942 observations and approximately
498.7 billion views across ten regional partitions.

## Pipeline Flow

1. EventBridge schedules the YouTube Data API ingestion Lambda.
2. Historical Kaggle files can enter the same Bronze storage contract.
3. Two Silver transformations run in parallel for statistics and category
   reference data.
4. Data-quality checks validate the cleansed tables.
5. Glue creates the three Gold analytics marts.
6. Athena and QuickSight consume the published Gold data.
7. SNS publishes success notifications and focused failure alerts.
8. CloudWatch captures operational logs and metrics.

The deployed state machine is named
`yt-data-pipeline-orchestration` in `us-east-1`.

## Technology

- Next.js 16 and React 19
- TypeScript and CSS
- AWS Lambda, Glue, S3, Athena, Step Functions, SNS, EventBridge, CloudWatch,
  IAM, and Glue Data Catalog
- Render for the public web service

## Local Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run render:build
```

## Runtime Configuration

The execution API reads these server-side environment variables:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
STEP_FUNCTION_ARN
```

Use a dedicated least-privilege AWS identity. The included policy at
`infrastructure/web-step-functions-policy.json` limits access to starting,
listing, and reading executions for this project's state machine.

Do not expose AWS credentials through client-side variables or commit them to
source control.

## Key Commands

```bash
npm run dev
npm run build
npm run render:build
npm run render:start
```

## Repository Structure

```text
app/                    Website and execution API
data/                   Regional source samples
infrastructure/         Least-privilege execution policy
public/                 Static assets
tests/                  Rendered-output checks
```

## Deployment

Render uses the settings in `render.yaml`:

- Build: `npm ci && npm run render:build`
- Start: `npm run render:start`
- Health check: `/`

The public service automatically redeploys from the `main` branch.
