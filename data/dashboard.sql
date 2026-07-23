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
    AVG(avg_engagement_rate) AS avg_engagement_rate
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
    first_trending,
    last_trending,
    ROW_NUMBER() OVER (ORDER BY total_views DESC) AS global_rank
  FROM channel_latest
),
top_categories AS (
  SELECT
    category_name,
    SUM(total_views) AS total_views,
    SUM(video_count) AS video_count,
    AVG(view_share_pct) AS avg_view_share_pct,
    ROW_NUMBER() OVER (ORDER BY SUM(total_views) DESC) AS global_rank
  FROM category_latest
  GROUP BY category_name
)
SELECT
  'summary' AS section,
  'All regions' AS label,
  CAST(NULL AS VARCHAR) AS region,
  CAST(SUM(total_videos) AS DOUBLE) AS metric_1,
  CAST(SUM(total_views) AS DOUBLE) AS metric_2,
  CAST(COUNT(DISTINCT region) AS DOUBLE) AS metric_3,
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
  CAST(avg_engagement_rate AS DOUBLE),
  CAST(NULL AS VARCHAR),
  CAST(NULL AS VARCHAR)
FROM regional
UNION ALL
SELECT
  'channel',
  channel_title,
  region,
  CAST(total_views AS DOUBLE),
  CAST(total_videos AS DOUBLE),
  CAST(times_trending AS DOUBLE),
  CAST(first_trending AS VARCHAR),
  CAST(last_trending AS VARCHAR)
FROM top_channels
WHERE global_rank <= 8
UNION ALL
SELECT
  'category',
  category_name,
  CAST(NULL AS VARCHAR),
  CAST(total_views AS DOUBLE),
  CAST(video_count AS DOUBLE),
  CAST(avg_view_share_pct AS DOUBLE),
  CAST(NULL AS VARCHAR),
  CAST(NULL AS VARCHAR)
FROM top_categories
WHERE global_rank <= 6
