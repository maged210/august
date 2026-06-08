// ElevenLabs TTS proxy. Reads ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID from
// server env only — the key never reaches the client. Streams the audio through.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ELEVEN_MODEL = "eleven_turbo_v2_5"; // low-latency

export async function POST(req: Request): Promise<Response> {
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

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
    `?output_format=mp3_44100_128&optimize_streaming_latency=3`;

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
    return new Response(`ElevenLabs error ${elRes.status}: ${detail}`, { status: 502 });
  }

  // Pass the audio stream straight through to the client.
  return new Response(elRes.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store, no-transform",
    },
  });
}
