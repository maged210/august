// ElevenLabs TTS proxy. Reads ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID from
// server env only — the key never reaches the client. Streams the audio through.
import { checkRateLimit, getIp, rateLimitedResponse } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flash v2.5 — ElevenLabs' lowest-latency model (~75ms inference). Replaces the
// now-deprecated eleven_turbo_v2_5 (Flash is "functionally equivalent … except the
// latency on the Flash models is lower on average"). English quality is on par for
// a conversational companion. Verified against elevenlabs.io/docs/overview/models.
const ELEVEN_MODEL = "eleven_flash_v2_5";

export async function POST(req: Request): Promise<Response> {
  const rl = await checkRateLimit("speak", getIp(req));
  if (!rl.ok) return rateLimitedResponse(rl.reset);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  // Not configured → 501 so the client can fall back to the browser voice.
  if (!apiKey || !voiceId) {
    return new Response("ElevenLabs not configured", { status: 501 });
  }

  let text = "";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }
  text = text.trim();
  if (!text) return new Response("No text provided.", { status: 400 });

  // mp3_44100_64: half the bytes/sec of the old _128 → faster first audio, still
  // clean progressive MP3. optimize_streaming_latency=3 = max optimization with the
  // text normalizer ON (NOT 4, which disables it and mispronounces numbers/dates —
  // AUGUST quotes markets, so normalization stays on). Verified vs ElevenLabs docs.
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
    `?output_format=mp3_44100_64&optimize_streaming_latency=3`;

  const t0 = Date.now();
  let elRes: Response;
  try {
    elRes = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return new Response(`ElevenLabs request failed: ${msg}`, { status: 502 });
  }

  if (!elRes.ok || !elRes.body) {
    const detail = await elRes.text().catch(() => "");
    console.error(`[speak] ElevenLabs error ${elRes.status} after ${Date.now() - t0}ms: ${detail}`);
    return new Response(`ElevenLabs error ${elRes.status}: ${detail}`, { status: 502 });
  }

  // upstream-TTFB: time until ElevenLabs returned response headers (first audio is
  // about to stream). The [LAT] client log measures the full picture; this isolates
  // the TTS server leg. ~chars so we can correlate latency with utterance length.
  console.log(`[speak] ${ELEVEN_MODEL} upstream-TTFB=${Date.now() - t0}ms chars=${text.length}`);

  // Pass the audio stream straight through to the client.
  return new Response(elRes.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store, no-transform",
    },
  });
}
