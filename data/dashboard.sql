-- Sanitized TrendForge snapshot over all three Gold marts.
-- The generic metric columns keep the UNION result exportable as one dataset.
WITH trending_latest AS (
  SELECT *
  FROM (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY region, trending_date_parsed
        ORDER BY _aggregated_at DESC
      ) AS snapshot_rank
    FROM yt_pipeline_gold_dev.trending_analytics
  )
  WHERE snapshot_rank = 1
),
channel_latest AS (
  SELECT *
  FROM (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY region, channel_title
        ORDER BY _aggregated_at DESC
      ) AS snapshot_rank
    FROM yt_pipeline_gold_dev.channel_analytics
  )
  WHERE snapshot_rank = 1
),
category_latest AS (
  SELECT *
  FROM (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY region, category_id, trending_date_parsed
        ORDER BY _aggregated_at DESC
      ) AS snapshot_rank
    FROM yt_pipeline_gold_dev.category_analytics
  )
  WHERE snapshot_rank = 1
),
regional AS (
  SELECT
    region,
    SUM(total_views) AS total_views,
    SUM(total_videos) AS total_videos,
    SUM(avg_engagement_rate * total_videos) / NULLIF(SUM(total_videos), 0)
      AS weighted_engagement_rate,
    AVG(unique_channels) AS avg_daily_channels,
    AVG(unique_categories) AS avg_daily_categories,
    MAX(max_views) AS peak_video_views,
    MIN(trending_date_parsed) AS first_date,
    MAX(trending_date_parsed) AS last_date
  FROM trending_latest
  GROUP BY region
),
top_channels AS (
  SELECT
    channel_title,
    region,
    total_views,
    total_videos,
    times_trending,
    avg_engagement_rate,
    peak_views,
    rank_in_region,
    first_trending,
    last_trending,
    ROW_NUMBER() OVER (ORDER BY total_views DESC) AS global_rank
  FROM channel_latest
),
category_rollup AS (
  SELECT
    category_name,
    region,
    SUM(total_views) AS total_views,
    SUM(video_count) AS video_count,
    SUM(avg_engagement_rate * video_count) / NULLIF(SUM(video_count), 0)
      AS weighted_engagement_rate,
    AVG(unique_channels) AS avg_daily_channels
  FROM category_latest
  GROUP BY category_name, region
),
top_categories AS (
  SELECT
    *,
    total_views / NULLIF(SUM(total_views) OVER (PARTITION BY region), 0) * 100
      AS period_view_share_pct,
    ROW_NUMBER() OVER (
      PARTITION BY region
      ORDER BY total_views DESC
    ) AS rank_in_region
  FROM category_rollup
)
SELECT
  'summary' AS section,
  'All regions' AS label,
  CAST(NULL AS VARCHAR) AS region,
  CAST(SUM(total_videos) AS DOUBLE) AS metric_1,
  CAST(SUM(total_views) AS DOUBLE) AS metric_2,
  CAST(COUNT(DISTINCT region) AS DOUBLE) AS metric_3,
  CAST(
    SUM(avg_engagement_rate * total_videos) / NULLIF(SUM(total_videos), 0)
    AS DOUBLE
  ) AS metric_4,
  CAST(AVG(unique_channels) AS DOUBLE) AS metric_5,
  CAST(AVG(unique_categories) AS DOUBLE) AS metric_6,
  CAST(MIN(trending_date_parsed) AS VARCHAR) AS detail_1,
  CAST(MAX(trending_date_parsed) AS VARCHAR) AS detail_2
FROM trending_latest

UNION ALL

SELECT
  'region',
  region,
  region,
  CAST(total_views AS DOUBLE),
  CAST(total_videos AS DOUBLE),
  CAST(weighted_engagement_rate AS DOUBLE),
  CAST(avg_daily_channels AS DOUBLE),
  CAST(avg_daily_categories AS DOUBLE),
  CAST(peak_video_views AS DOUBLE),
  CAST(first_date AS VARCHAR),
  CAST(last_date AS VARCHAR)
FROM regional

UNION ALL

SELECT
  'channel',
  channel_title,
  region,
  CAST(total_views AS DOUBLE),
  CAST(total_videos AS DOUBLE),
  CAST(times_trending AS DOUBLE),
  CAST(avg_engagement_rate AS DOUBLE),
  CAST(peak_views AS DOUBLE),
  CAST(rank_in_region AS DOUBLE),
  CAST(first_trending AS VARCHAR),
  CAST(last_trending AS VARCHAR)
FROM top_channels
WHERE global_rank <= 8

UNION ALL

SELECT
  'category',
  category_name,
  region,
  CAST(total_views AS DOUBLE),
  CAST(video_count AS DOUBLE),
  CAST(period_view_share_pct AS DOUBLE),
  CAST(weighted_engagement_rate AS DOUBLE),
  CAST(avg_daily_channels AS DOUBLE),
  CAST(rank_in_region AS DOUBLE),
  CAST(NULL AS VARCHAR),
  CAST(NULL AS VARCHAR)
FROM top_categories
WHERE rank_in_region <= 6;
