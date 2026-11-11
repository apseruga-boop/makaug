'use strict';

// Staff-desk and intake previews for found-online stays.
// Image-rights policy: do not rehost downloaded social photos unless the
// listing already has a copy on media.makaug.com. Official YouTube
// i.ytimg.com hqdefault thumbs are allowed as a staff preview. Signed
// TikTok CDN URLs (tiktokcdn *-sign* with expiry params) are not stored
// or shown; they expire and 403.

const OUR_MEDIA_HOST = /(?:^|\.)media\.makaug\.com$/i;
const YOUTUBE_HOST = /(?:^|\.)i\.ytimg\.com$/i;
const TIKTOK_CDN_HOST = /tiktokcdn|byteimg|ibytedtos/i;
const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const YOUTUBE_THUMB_ID_RE = /\/vi\/([A-Za-z0-9_-]{11})\//i;

function asUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return new URL(text);
  } catch (_) {
    return null;
  }
}

function youtubeVideoIdFrom(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const fromWatch = text.match(YOUTUBE_ID_RE);
  if (fromWatch) return fromWatch[1];
  const fromThumb = text.match(YOUTUBE_THUMB_ID_RE);
  if (fromThumb) return fromThumb[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  return '';
}

function youtubeHqDefaultUrl(value = '') {
  const id = youtubeVideoIdFrom(value);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

function isOurMediaHostUrl(value = '') {
  const url = asUrl(value);
  return Boolean(url && OUR_MEDIA_HOST.test(url.hostname));
}

function isSignedTikTokCdnUrl(value = '') {
  const url = asUrl(value);
  if (!url) return false;
  if (!TIKTOK_CDN_HOST.test(url.hostname)) return false;
  const haystack = `${url.hostname}${url.pathname}${url.search}`;
  if (/-sign/i.test(haystack)) return true;
  if (/(?:^|[?&])(?:x-expires|x-signature|x-orig-authkey|expires|signature|sig)=/i.test(url.search)) return true;
  return false;
}

function isUnusableTikTokThumb(value = '') {
  const url = asUrl(value);
  if (!url) return false;
  if (!TIKTOK_CDN_HOST.test(url.hostname)) return false;
  if (/\.mp4(?:$|\?)/i.test(url.pathname + url.search)) return false;
  return isSignedTikTokCdnUrl(value) || TIKTOK_CDN_HOST.test(url.hostname);
}

function stableStaffImageUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isOurMediaHostUrl(raw)) return raw;
  if (isUnusableTikTokThumb(raw)) return '';
  const url = asUrl(raw);
  if (url && YOUTUBE_HOST.test(url.hostname)) return youtubeHqDefaultUrl(raw) || raw;
  return '';
}

function staffPreviewImage(row = {}, media = []) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' && !Array.isArray(row.extra_fields)
    ? row.extra_fields
    : {};
  const mediaUrls = (Array.isArray(media) ? media : [])
    .map((item) => (typeof item === 'string' ? item : item && item.url))
    .filter(Boolean);
  const hosted = [row.cover_url, extra.staff_preview_image_url, extra.rehosted_cover_url, ...mediaUrls]
    .find((url) => isOurMediaHostUrl(url));
  if (hosted) {
    return { cover_url: hosted, cover_kind: 'rehosted', preview_placeholder: false };
  }

  const youtubeSource = [
    extra.youtube_hqdefault_url,
    extra.youtube_video_id,
    extra.youtube_url,
    extra.source_url,
    extra.source_post_url,
    row.source_url,
    row.cover_url,
    ...mediaUrls,
  ].find((value) => youtubeVideoIdFrom(value));
  if (youtubeSource) {
    return {
      cover_url: youtubeHqDefaultUrl(youtubeSource),
      cover_kind: 'youtube_hqdefault',
      preview_placeholder: false,
    };
  }

  return { cover_url: null, cover_kind: 'source_link', preview_placeholder: true };
}

function sanitizeStaffPhotos(photos = [], row = {}) {
  const list = Array.isArray(photos) ? photos : [];
  const kept = list
    .map((photo) => {
      const url = stableStaffImageUrl(photo && photo.url);
      if (!url) return null;
      return { ...photo, url };
    })
    .filter(Boolean);
  const preview = staffPreviewImage(row, kept.length ? kept : list);
  if (!kept.length && preview.cover_url) {
    kept.push({
      url: preview.cover_url,
      caption: preview.cover_kind === 'youtube_hqdefault' ? 'YouTube source cover' : 'Source cover',
      is_primary: true,
      sort_order: 0,
      preview_only: true,
    });
  }
  return kept;
}

function youtubePreviewFields(item = {}, sourceUrl = '') {
  const id = youtubeVideoIdFrom(
    item.youtubeId || item.youtube_video_id || item.youtube_url || item.source_url || sourceUrl
  );
  if (!id) return {};
  const thumb = youtubeHqDefaultUrl(id);
  return {
    youtube_video_id: id,
    youtube_hqdefault_url: thumb,
    staff_preview_image_url: thumb,
    staff_preview_image_kind: 'youtube_hqdefault',
  };
}

function publicSafeStayImages(images = []) {
  return (Array.isArray(images) ? images : []).filter((item) => {
    const url = typeof item === 'string' ? item : item && item.url;
    return url && !isUnusableTikTokThumb(url) && !isSignedTikTokCdnUrl(url);
  });
}

module.exports = {
  isOurMediaHostUrl,
  isSignedTikTokCdnUrl,
  youtubeVideoIdFrom,
  youtubeHqDefaultUrl,
  youtubePreviewFields,
  stableStaffImageUrl,
  staffPreviewImage,
  sanitizeStaffPhotos,
  publicSafeStayImages,
};
