// YouTubeProvider — SERVER ONLY. Compliant discovery + metadata.
//   - URL parsing (video / channel id / @handle / custom / youtu.be / bare ids).
//   - oEmbed: KEYLESS title/author/thumbnail for any public video (works today).
//   - Data API v3 (YOUTUBE_API_KEY, OPTIONAL): channel resolution, uploads-playlist
//     discovery, video details + LIVE status, chapter metadata.
// Never scrapes protected media. Without a key, you can still add a VIDEO by URL and
// process its transcript (manual paste); channel AUTO-discovery needs the key.

export type ParsedUrl =
  | { kind: "video"; videoId: string }
  | { kind: "channelId"; channelId: string }
  | { kind: "handle"; handle: string }
  | { kind: "custom"; name: string }
  | { kind: "user"; user: string }
  | { kind: "unknown"; raw: string };

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

/** Parse any YouTube URL or bare id/handle into a typed reference. */
export function parseYouTubeUrl(input: string): ParsedUrl {
  const raw = (input || "").trim();
  if (!raw) return { kind: "unknown", raw };

  // Bare ids / handle (no scheme).
  if (CHANNEL_ID_RE.test(raw)) return { kind: "channelId", channelId: raw };
  if (VIDEO_ID_RE.test(raw) && !raw.includes("/")) return { kind: "video", videoId: raw };
  if (raw.startsWith("@")) return { kind: "handle", handle: raw.replace(/^@/, "") };

  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return { kind: "unknown", raw };
  }
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" && parts[0] && VIDEO_ID_RE.test(parts[0])) {
    return { kind: "video", videoId: parts[0] };
  }
  if (host.endsWith("youtube.com")) {
    const v = u.searchParams.get("v");
    if (v && VIDEO_ID_RE.test(v)) return { kind: "video", videoId: v };
    if (parts[0] === "watch" && v && VIDEO_ID_RE.test(v)) return { kind: "video", videoId: v };
    if ((parts[0] === "live" || parts[0] === "shorts" || parts[0] === "embed") && parts[1] && VIDEO_ID_RE.test(parts[1])) {
      return { kind: "video", videoId: parts[1] };
    }
    if (parts[0] === "channel" && parts[1] && CHANNEL_ID_RE.test(parts[1])) {
      return { kind: "channelId", channelId: parts[1] };
    }
    if (parts[0]?.startsWith("@")) return { kind: "handle", handle: parts[0].replace(/^@/, "") };
    if (parts[0] === "c" && parts[1]) return { kind: "custom", name: parts[1] };
    if (parts[0] === "user" && parts[1]) return { kind: "user", user: parts[1] };
  }
  return { kind: "unknown", raw };
}

export type VideoMeta = {
  videoId: string;
  title: string;
  author?: string;
  authorUrl?: string;
  thumbnail?: string;
  publishedAt?: number;
  durationSeconds?: number;
  liveState?: "none" | "upcoming" | "live" | "archived_live" | "uploaded";
  channelId?: string;
  descriptionChapters?: { title: string; startSeconds: number }[];
};

const KEY = () => process.env.YOUTUBE_API_KEY;
export function youtubeApiConfigured(): boolean {
  return !!KEY();
}

// --- oEmbed (keyless) ------------------------------------------------------
export async function oembed(videoId: string): Promise<Partial<VideoMeta> | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      title?: string;
      author_name?: string;
      author_url?: string;
      thumbnail_url?: string;
    };
    return {
      videoId,
      title: j.title ?? "",
      author: j.author_name,
      authorUrl: j.author_url,
      thumbnail: j.thumbnail_url,
    };
  } catch {
    return null;
  }
}

// --- Data API helpers ------------------------------------------------------
function parseISODuration(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

// Pull "00:00 Title" lines out of a description into chapters.
export function parseDescriptionChapters(desc: string): { title: string; startSeconds: number }[] {
  const out: { title: string; startSeconds: number }[] = [];
  for (const line of (desc || "").split("\n")) {
    const m = /^\s*(?:\(?\[?)?(\d{1,2}):(\d{2})(?::(\d{2}))?\)?\]?\s*[-–—:]?\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const h = m[3] ? Number(m[1]) : 0;
    const mm = m[3] ? Number(m[2]) : Number(m[1]);
    const ss = m[3] ? Number(m[3]) : Number(m[2]);
    const start = h * 3600 + mm * 60 + ss;
    const title = m[4].trim();
    if (title && title.length <= 120) out.push({ title, startSeconds: start });
  }
  // chapters must be ordered + start at/near 0 to be trustworthy
  return out.length >= 2 ? out.sort((a, b) => a.startSeconds - b.startSeconds) : [];
}

/** Full video metadata: oEmbed always, enriched by the Data API when a key is set. */
export async function getVideoMeta(videoId: string): Promise<VideoMeta | null> {
  const base = (await oembed(videoId)) ?? { videoId, title: "" };
  const key = KEY();
  if (!key) return { videoId, title: base.title ?? "", ...base, liveState: "uploaded" };
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails&id=${videoId}&key=${key}`,
      { cache: "no-store" },
    );
    if (!res.ok) return { videoId, title: base.title ?? "", ...base };
    const j = (await res.json()) as {
      items?: {
        snippet?: { title?: string; publishedAt?: string; channelId?: string; channelTitle?: string; description?: string; liveBroadcastContent?: string; thumbnails?: Record<string, { url: string }> };
        contentDetails?: { duration?: string };
        liveStreamingDetails?: { actualEndTime?: string; scheduledStartTime?: string };
      }[];
    };
    const it = j.items?.[0];
    if (!it) return { videoId, title: base.title ?? "", ...base };
    const live = it.snippet?.liveBroadcastContent;
    const liveState: VideoMeta["liveState"] =
      live === "live" ? "live" : live === "upcoming" ? "upcoming" : it.liveStreamingDetails?.actualEndTime ? "archived_live" : "uploaded";
    return {
      videoId,
      title: it.snippet?.title ?? base.title ?? "",
      author: it.snippet?.channelTitle ?? base.author,
      channelId: it.snippet?.channelId,
      thumbnail: it.snippet?.thumbnails?.high?.url ?? base.thumbnail,
      publishedAt: it.snippet?.publishedAt ? Date.parse(it.snippet.publishedAt) : undefined,
      durationSeconds: it.contentDetails?.duration ? parseISODuration(it.contentDetails.duration) : undefined,
      liveState,
      descriptionChapters: it.snippet?.description ? parseDescriptionChapters(it.snippet.description) : [],
    };
  } catch {
    return { videoId, title: base.title ?? "", ...base };
  }
}

export type ChannelInfo = { channelId: string; title: string; uploadsPlaylistId?: string; thumbnail?: string };

/** Resolve a channel id + uploads playlist from a parsed ref. Needs the Data API key
 *  for handles/custom/user; a bare channelId works structurally but uploads needs the key. */
export async function resolveChannel(ref: ParsedUrl): Promise<ChannelInfo | null> {
  const key = KEY();
  let channelId: string | undefined;
  let query = "";
  if (ref.kind === "channelId") channelId = ref.channelId;
  else if (ref.kind === "handle") query = `forHandle=@${ref.handle}`;
  else if (ref.kind === "user") query = `forUsername=${ref.user}`;
  else if (ref.kind === "video") {
    const meta = await getVideoMeta(ref.videoId);
    channelId = meta?.channelId;
  } else if (ref.kind === "custom") query = `forHandle=@${ref.name}`;
  if (!key) return channelId ? { channelId, title: "" } : null;
  try {
    const q = channelId ? `id=${channelId}` : query;
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&${q}&key=${key}`,
      { cache: "no-store" },
    );
    if (!res.ok) return channelId ? { channelId, title: "" } : null;
    const j = (await res.json()) as {
      items?: { id?: string; snippet?: { title?: string; thumbnails?: Record<string, { url: string }> }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
    };
    const it = j.items?.[0];
    if (!it?.id) return channelId ? { channelId, title: "" } : null;
    return {
      channelId: it.id,
      title: it.snippet?.title ?? "",
      uploadsPlaylistId: it.contentDetails?.relatedPlaylists?.uploads,
      thumbnail: it.snippet?.thumbnails?.default?.url,
    };
  } catch {
    return channelId ? { channelId, title: "" } : null;
  }
}

/** Recent uploads for a channel (via its uploads playlist). Needs the Data API key. */
export async function listChannelUploads(uploadsPlaylistId: string, max = 10): Promise<VideoMeta[]> {
  const key = KEY();
  if (!key || !uploadsPlaylistId) return [];
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=${max}&key=${key}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string }; snippet?: { title?: string; thumbnails?: Record<string, { url: string }>; channelId?: string; channelTitle?: string } }[];
    };
    return (j.items ?? [])
      .filter((it) => it.contentDetails?.videoId)
      .map((it) => ({
        videoId: it.contentDetails!.videoId!,
        title: it.snippet?.title ?? "",
        channelId: it.snippet?.channelId,
        author: it.snippet?.channelTitle,
        thumbnail: it.snippet?.thumbnails?.high?.url,
        publishedAt: it.contentDetails?.videoPublishedAt ? Date.parse(it.contentDetails.videoPublishedAt) : undefined,
        liveState: "uploaded" as const,
      }));
  } catch {
    return [];
  }
}

export function watchUrl(videoId: string, atSeconds?: number): string {
  return `https://www.youtube.com/watch?v=${videoId}${atSeconds ? `&t=${Math.floor(atSeconds)}s` : ""}`;
}
