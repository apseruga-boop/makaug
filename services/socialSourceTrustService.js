function cleanText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function firstPresent(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (Array.isArray(value) && value.length) return value;
    const text = cleanText(value);
    if (text) return value;
  }
  return '';
}

function sourcePlatformFor(source = {}) {
  const explicit = cleanText(source.source_platform || source.platform || source.sourcePlatform).toLowerCase();
  if (explicit) return explicit === 'twitter' ? 'x' : explicit;
  const url = cleanText(firstPresent(source.source_url, source.sourceUrl, source.videoUrl, source.tiktokUrl, source.instagramReelUrl, source.youtubeUrl)).toLowerCase();
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
  if (url.includes('x.com') || url.includes('twitter.com')) return 'x';
  return '';
}

function hasExactSocialPostUrl(source = {}) {
  const url = cleanText(firstPresent(source.source_url, source.sourceUrl, source.source_post_url, source.videoUrl, source.tiktokUrl, source.instagramReelUrl, source.youtubeUrl));
  if (!/^https?:\/\//i.test(url)) return false;
  return /(?:tiktok\.com\/@[^/]+\/video\/\d+|youtube\.com\/watch\?|youtu\.be\/|instagram\.com\/(?:p|reel)\/|facebook\.com\/.+\/(?:posts|videos|reel)|fb\.watch\/|(?:x|twitter)\.com\/[^/]+\/status\/\d+)/i.test(url);
}

function hasAudienceMetric(source = {}) {
  const raw = source.raw_source_post || source.rawSourcePost || {};
  const metrics = raw.public_metrics || raw.author?.public_metrics || source.public_metrics || source.author_public_metrics || {};
  const label = cleanText(firstPresent(source.source_followers_label, source.source_audience_label, source.audienceLabel, source.audience_label));
  if (label && !/confirm|unknown|pending/i.test(label)) return true;
  return ['followers_count', 'following_count', 'subscriber_count'].some((key) => Number(metrics[key]) > 0);
}

function hasAccountHistoryEvidence(source = {}) {
  const raw = source.raw_source_post || source.rawSourcePost || {};
  const created = firstPresent(
    source.source_account_created_at,
    source.account_created_at,
    source.channel_created_at,
    raw.author?.created_at,
    raw.channel?.created_at
  );
  const ageLabel = firstPresent(source.source_account_age_label, source.account_age_label, raw.author?.age_label, raw.channel?.age_label);
  return Boolean(cleanText(created) || cleanText(ageLabel));
}

function hasPostingVolumeEvidence(source = {}) {
  const raw = source.raw_source_post || source.rawSourcePost || {};
  const metrics = raw.public_metrics || raw.author?.public_metrics || raw.channel?.public_metrics || source.public_metrics || source.author_public_metrics || {};
  const count = Number(firstPresent(source.source_video_count, source.source_post_count, metrics.video_count, metrics.tweet_count, metrics.post_count, metrics.media_count));
  const label = firstPresent(source.source_video_count_label, source.source_post_count_label, source.posting_volume_label);
  return count > 0 || Boolean(cleanText(label));
}

function hasEngagementEvidence(source = {}) {
  const raw = source.raw_source_post || source.rawSourcePost || {};
  const metrics = raw.public_metrics || source.public_metrics || {};
  const comments = firstPresent(source.comment_evidence, source.commentEvidence, raw.comments, raw.comment_evidence);
  const replyCount = Number(metrics.reply_count || metrics.comment_count || raw.reply_count || raw.comment_count || 0);
  const ownerReplies = Number(raw.owner_reply_count || source.owner_reply_count || 0);
  return replyCount > 0 || ownerReplies > 0 || (Array.isArray(comments) && comments.length > 0) || Boolean(cleanText(comments));
}

function check(key, label, passed, evidence, action = '') {
  return {
    key,
    label,
    status: passed ? 'pass' : 'needs_evidence',
    points: passed ? 10 : 0,
    max_points: 10,
    evidence: cleanText(evidence) || (passed ? 'Captured' : 'Not captured yet'),
    action: cleanText(action)
  };
}

function buildSocialSourceTrustReview(source = {}) {
  const platform = sourcePlatformFor(source);
  const sourceUrl = cleanText(firstPresent(source.source_url, source.sourceUrl, source.source_post_url, source.videoUrl, source.tiktokUrl, source.instagramReelUrl, source.youtubeUrl));
  const sourceContactUrl = cleanText(firstPresent(source.source_contact_url, source.sourceContactUrl, source.channelUrl, source.source_channel_url));
  const sourceName = cleanText(firstPresent(source.source_name, source.source_agent_name, source.owner_or_agent_name, source.lister_name, source.agent?.name));
  const publishedAt = cleanText(firstPresent(source.first_posted_online_at, source.source_published_at, source.sourcePublishedAt, source.publishedAt, source.postedAt));
  const location = cleanText([source.area, source.district, source.address].filter(Boolean).join(', '));
  const priceEvidence = cleanText(firstPresent(source.price_label, source.source_price_label, source.price, source.priceText));
  const contactEvidence = cleanText(firstPresent(source.contact_phone, source.phone, source.lister_phone, source.email, source.source_contact_label, sourceContactUrl, sourceUrl));
  const propertyFactsEvidence = [location, priceEvidence || (source.price_upon_application ? 'Price upon application' : '')].filter(Boolean).join(' | ');
  const accountHistoryEvidence = firstPresent(
    source.source_account_age_label,
    source.source_account_created_at,
    source.account_created_at,
    source.channel_created_at,
    source.raw_source_post?.author?.created_at,
    source.rawSourcePost?.author?.created_at
  );
  const postingVolumeEvidence = firstPresent(
    source.source_video_count_label,
    source.source_post_count_label,
    source.source_video_count,
    source.source_post_count,
    source.raw_source_post?.author?.public_metrics?.video_count,
    source.rawSourcePost?.author?.public_metrics?.video_count
  );

  const checks = [
    check('exact_post_url', 'Exact social post URL', hasExactSocialPostUrl({ ...source, source_url: sourceUrl }), sourceUrl, 'Capture the exact video/post URL, not only a hashtag or profile page.'),
    check('recognised_platform', 'Recognised social platform', Boolean(platform), platform, 'Confirm whether the source is TikTok, YouTube, Instagram, Facebook, or X.'),
    check('poster_identity', 'Poster name or handle captured', Boolean(sourceName), sourceName, 'Capture the public poster name or handle for attribution.'),
    check('account_history', 'Account age/history evidence', hasAccountHistoryEvidence(source), accountHistoryEvidence, 'Capture when the account/channel was created or how long it has been active.'),
    check('posting_volume', 'Posting/video volume evidence', hasPostingVolumeEvidence(source), postingVolumeEvidence, 'Capture public post count, video count, or upload history where visible.'),
    check('audience_metrics', 'Followers/following/subscriber metrics', hasAudienceMetric(source), firstPresent(source.source_followers_label, source.source_audience_label, source.audienceLabel), 'Capture followers, following, subscribers, or public account metrics when available.'),
    check('platform_posted_date', 'Platform posted date captured', Boolean(publishedAt), publishedAt, 'Capture the original platform date or mark it for manual confirmation.'),
    check('property_facts', 'Property facts captured', Boolean(location && (priceEvidence || source.price_upon_application)), propertyFactsEvidence, 'Location is non-negotiable; capture price when visible, otherwise use Price upon application.'),
    check('public_contact_path', 'Public contact path captured', Boolean(contactEvidence), contactEvidence, 'Capture a lawful public contact route: phone, email, profile, source link, or source contact page.'),
    check('engagement_responsiveness', 'Engagement/comment responsiveness evidence', hasEngagementEvidence(source), 'Comments/replies evidence', 'Capture comments, owner replies, or engagement metrics when available.')
  ];
  const score = checks.reduce((sum, item) => sum + item.points, 0);
  return {
    score,
    max_score: 100,
    level: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'needs_review',
    generated_at: new Date().toISOString(),
    checks
  };
}

module.exports = {
  buildSocialSourceTrustReview,
};
