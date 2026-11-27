// Delivery jobs hold the current video in R2 while Instagram or TikTok fetches it.
export const canReplaceVideoAssetSql = `
  NOT EXISTS (
    SELECT 1 FROM instagram_publish_jobs AS job
    JOIN instagram_media_grants AS grant
      ON grant.content_id = job.content_id AND grant.user_id = job.user_id
      AND (grant.job_id = job.id OR grant.job_id IS NULL)
    WHERE job.content_id = content_items.id AND job.user_id = content_items.user_id
      AND job.status IN ('creating', 'processing', 'publishing')
      AND grant.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  AND NOT EXISTS (
    SELECT 1 FROM tiktok_upload_jobs
    WHERE content_id = content_items.id AND user_id = content_items.user_id
      AND media_hash IS NOT NULL AND media_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
`;
