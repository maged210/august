// AUGUST Market Intel — shared types. The contract every other intel module builds
// on. Mirrors the strict structured-output schema in the spec; every extracted item
// keeps its source evidence (segment ids + timestamps) so nothing is unattributable.

// --- confidence ------------------------------------------------------------
// Documented scale, 0..1:
//   >= 0.85  explicit, specific, recent, corroborated
//   0.5..0.85 explicit but partial / single-source
//   < 0.5    inferred, vague, or stale
// Confidence is NOT a probability of profit and NEVER derives from view count.
export type Confidence = number;

export type Explicitness = "explicit" | "inferred";

// --- sources (monitored channels / videos) --------------------------------
export type SourceType = "channel" | "video";
export type SourceStatus = "active" | "error" | "disabled";

export type IntelSource = {
  id: string; // stable id (channel id, or v_<videoId> for a one-off video)
  type: SourceType;
  channelId?: string;
  channelTitle?: string;
  videoId?: string; // for type "video"
  title: string;
  thumbnail?: string;
  url: string;
  enabled: boolean;
  uploadsPlaylistId?: string; // for channels, when resolved via Data API
  templateId?: string; // recurring-structure template (e.g. "stockedup")
  created: number;
  lastChecked: number; // last discovery attempt
  lastProcessed: number; // last successful video processed
  status: SourceStatus;
  error?: string;
};

// --- videos ---------------------------------------------------------------
export type LiveState = "none" | "upcoming" | "live" | "archived_live" | "uploaded";
export type TranscriptStatus =
  | "available"
  | "pending"
  | "unavailable"
  | "permission_required"
  | "provider_error"
  | "live_caption_pending";
export type VideoStatus =
  | "discovered"
  | "metadata_saved"
  | "transcript_pending"
  | "transcript_ready"
  | "analyzing"
  | "preliminary" // fast-pass (priority chapters) done, full pass pending
  | "analyzed"
  | "failed";

export type IntelVideo = {
  videoId: string;
  sourceId: string;
  channelId?: string;
  channelTitle?: string;
  title: string;
  thumbnail?: string;
  publishedAt: number; // ms epoch
  durationSeconds?: number;
  liveState: LiveState;
  status: VideoStatus;
  transcriptStatus: TranscriptStatus;
  transcriptSource?: "manual" | "timedtext" | "external";
  analysisVersion?: string;
  marketDate?: string; // YYYY-MM-DD (ET) the analysis pertains to
  tickers?: string[]; // normalized symbols mentioned
  ideaCount?: number;
  levelCount?: number;
  summary?: string;
  stale?: boolean;
  created: number;
  updated: number;
  error?: string;
};

// --- transcript + chapters ------------------------------------------------
export type TranscriptSegment = {
  id: string; // s0001 …
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type ChapterCategory =
  | "market_outlook"
  | "market_recap"
  | "overnight_news"
  | "macro_news"
  | "economic_calendar"
  | "earnings"
  | "technical_analysis"
  | "favorite_setups"
  | "predictions"
  | "watchlist"
  | "options_flow"
  | "trade_management"
  | "risk_management"
  | "closing_comments"
  | "advertisement"
  | "unrelated";

export type ChapterPriority = "high" | "medium" | "low";
export type ChapterDetection = "youtube" | "description" | "transcript_cue";

export type Chapter = {
  title: string; // ORIGINAL creator title — never overwritten
  normalizedCategory: ChapterCategory;
  startSeconds: number;
  endSeconds: number;
  order: number;
  priority: ChapterPriority;
  detection: ChapterDetection;
  detectionConfidence: Confidence;
  creatorDefined: boolean; // true only for youtube/description chapters
};

// --- the structured analysis schema (per video) ---------------------------
export type ClaimCategory =
  | "macro"
  | "technical"
  | "fundamental"
  | "catalyst"
  | "sentiment"
  | "risk";

// Evidence attached to every extracted item.
export type Evidence = {
  videoId?: string; // stamped at assembly so items keep their source video when aggregated
  sourceSegmentIds: string[];
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  chapter?: {
    title: string;
    normalizedCategory: ChapterCategory;
    startSeconds: number;
    endSeconds: number;
    priority: ChapterPriority;
    creatorDefined: boolean;
  };
};

export type CreatorDesignation = {
  isFavoriteSetup: boolean;
  isPrediction: boolean;
  isWatchlistMention: boolean;
};

export type Claim = {
  claim: string;
  category: ClaimCategory;
  explicitness: Explicitness;
  confidence: Confidence;
} & Evidence;

export type AssetType = "equity" | "option" | "index" | "future" | "crypto" | "etf" | "other";
export type Direction = "bullish" | "bearish" | "neutral" | "watch";
export type TimeHorizon = "intraday" | "next_session" | "swing" | "long_term" | "unspecified";

// Value fields are nullable on purpose — never invented. text carries the verbatim
// phrasing or "Not specified".
export type ValueField = {
  value: number | null;
  type?: "price" | "range" | "condition" | "unspecified";
  text: string;
};

export type TradeIdea = {
  id: string;
  ticker: string;
  assetName: string | null;
  assetType: AssetType;
  direction: Direction;
  timeHorizon: TimeHorizon;
  thesis: string;
  catalysts: string[];
  entry: ValueField;
  invalidation: ValueField;
  targets: ValueField[];
  risks: string[];
  confidence: Confidence;
  explicitness: Explicitness;
  creatorDesignation: CreatorDesignation;
  // enrichment (kept SEPARATE from creator-quoted values; may be absent)
  enriched?: {
    price: number | null;
    priceAsOf: number | null;
    chgPct: number | null;
    triggered?: boolean | null;
    invalidated?: boolean | null;
  };
} & Evidence;

export type LevelType =
  | "support"
  | "resistance"
  | "breakout"
  | "breakdown"
  | "target"
  | "invalidation"
  | "reference";

export type IntelLevel = {
  id: string;
  instrument: string;
  level: number | null;
  levelText: string;
  type: LevelType;
  explanation: string;
  crossed?: boolean | null; // computed against enrichment when possible
} & Evidence;

export type IntelCatalyst = {
  name: string;
  eventTime: string | null; // ISO
  importance: "high" | "medium" | "low";
  affectedTickers: string[];
  creatorMentioned: boolean;
  externallyVerified: boolean;
  explanation: string;
  sourceSegmentIds: string[];
};

export type MarketRegime = {
  label: "risk_on" | "risk_off" | "mixed" | "uncertain";
  explanation: string;
  confidence: Confidence;
};

export type VideoAnalysis = {
  videoId: string;
  analysisVersion: string;
  marketDate: string; // YYYY-MM-DD
  publishedAt: string; // ISO
  pass: "preliminary" | "full"; // fast-pass vs full-transcript
  overallSummary: string;
  marketRegime: MarketRegime;
  claims: Claim[];
  tradeIdeas: TradeIdea[];
  levels: IntelLevel[];
  catalysts: IntelCatalyst[];
  risks: string[];
  watchItems: string[];
  openQuestions: string[];
  warnings: string[]; // e.g. "stale", "low transcript quality"
  generatedAt: number;
};

// --- daily brief (cross-video synthesis) ----------------------------------
export type ConsensusItem = {
  ticker: string;
  direction: Direction;
  sources: { channelTitle: string; videoId: string; startSeconds: number; explicitness: Explicitness }[];
  agreement: "agree" | "conflict" | "single";
  note: string;
};

export type RankFactor = { factor: string; weight: number; note: string };

export type BriefIdea = TradeIdea & {
  channelTitle: string;
  videoId: string;
  videoTitle: string;
  rankScore: number;
  rankFactors: RankFactor[];
};

export type DailyBrief = {
  date: string; // YYYY-MM-DD ET
  generatedAt: number;
  marketSession: MarketSession;
  posture: string; // overall market posture
  whatChanged: string;
  whatMattersTomorrow: string;
  read60: string; // "Read in 60 seconds"
  bullCase: string;
  bearCase: string;
  watchAtOpen: string;
  invalidation: string;
  topIdeas: BriefIdea[];
  creatorFavorites: BriefIdea[];
  consensus: ConsensusItem[];
  levels: IntelLevel[];
  catalysts: IntelCatalyst[];
  risks: string[];
  sourceVideoIds: string[];
  grounded: boolean; // synthesized by the model from real analyses
};

export type MarketSession = "premarket" | "regular" | "afterhours" | "closed";

// --- jobs -----------------------------------------------------------------
export type JobState =
  | "discovered"
  | "metadata_saved"
  | "transcript_pending"
  | "transcript_fetching"
  | "transcript_ready"
  | "chunking"
  | "extracting"
  | "validating"
  | "enriching"
  | "brief_ready"
  | "failed"
  | "retry_scheduled";

export type IntelJob = {
  id: string;
  videoId: string;
  state: JobState;
  attempts: number;
  version: string;
  error?: string;
  created: number;
  updated: number;
  nextRetryAt?: number;
};

// --- settings -------------------------------------------------------------
export type IntelSettings = {
  timezone: string; // default America/New_York
  eveningBriefTime: string; // "21:30"
  premarketBriefEnabled: boolean;
  premarketBriefTime: string; // "08:15"
  minConfidence: Confidence; // hide below this
  showInferred: boolean;
  showWatchOnly: boolean;
  notifyEnabled: boolean;
  notifyHighPriorityIdeas: boolean;
  notifyConsensus: boolean;
  notifyBriefReady: boolean;
  retentionDays: number;
};

export const DEFAULT_SETTINGS: IntelSettings = {
  timezone: "America/New_York",
  eveningBriefTime: "21:30",
  premarketBriefEnabled: false,
  premarketBriefTime: "08:15",
  minConfidence: 0,
  showInferred: true,
  showWatchOnly: true,
  notifyEnabled: false,
  notifyHighPriorityIdeas: true,
  notifyConsensus: true,
  notifyBriefReady: true,
  retentionDays: 30,
};

export const ANALYSIS_VERSION = "1";
