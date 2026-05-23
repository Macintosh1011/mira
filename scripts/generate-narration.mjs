/**
 * Generate the Mira demo narration through the same ElevenLabs pipeline the app
 * uses (server-side key, /v1/text-to-speech). Each line is written to
 * public/narration/<id>.mp3, its duration probed with ffprobe, and the whole
 * set emitted as remotion/narration.json for the composition to lay out.
 *
 * Run:  node --env-file=.env.local scripts/generate-narration.mjs [--force]
 *
 * The narrator uses the configured ELEVENLABS_VOICE_ID. The user's two spoken
 * prompts use a second, contrasting voice picked from the account's voice list
 * so the "person asking" reads as a different speaker than the "engine."
 */
import { writeFile, mkdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "narration");
const MANIFEST = join(ROOT, "remotion", "narration.json");

const API_KEY = process.env.ELEVENLABS_API_KEY;
// Cinematic narrator: George — "Warm, Captivating Storyteller" (the 3B1B /
// Ciechanowski register). The app's default (ELEVENLABS_VOICE_ID) is a youthful
// social-media voice — wrong texture for this. Override via NARRATION_VOICE_OVERRIDE.
const NARRATOR_VOICE =
  process.env.NARRATION_VOICE_OVERRIDE || "JBFqnCBsd6RMkjVDRZzb";
// Higher-fidelity model than the app's turbo (latency doesn't matter offline).
const MODEL_ID = "eleven_multilingual_v2";
const FORCE = process.argv.includes("--force");

if (!API_KEY || !NARRATOR_VOICE) {
  console.error("Missing ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID. Run with --env-file=.env.local");
  process.exit(1);
}

// role: "narrator" = the engine's voice; "user" = the person asking.
const LINES = [
  { id: "a1_1", role: "narrator", text: "Some ideas are impossible to understand from a static image." },
  { id: "a1_2", role: "narrator", text: "Because the process itself is the explanation." },
  { id: "u2",   role: "user",     text: "Mira... show me how a neural network recognizes a handwritten seven." },
  { id: "a3_1", role: "narrator", text: "The model doesn't see a number." },
  { id: "a3_2", role: "narrator", text: "It sees patterns." },
  { id: "a3_3", role: "narrator", text: "Early layers detect simple features. Edges, angles, intersections." },
  { id: "a3_4", role: "narrator", text: "Deeper layers combine them into abstract representations." },
  { id: "a3_5", role: "narrator", text: "Until one interpretation becomes dominant." },
  { id: "u4",   role: "user",     text: "Now show me why the model confuses it with a one." },
  { id: "a4_2", role: "narrator", text: "Small changes reshape the model's internal representation." },
  { id: "a4_3", role: "narrator", text: "The distinction between a seven and a one becomes uncertain." },
  { id: "a4_4", role: "narrator", text: "Ambiguity emerges inside the network itself." },
  { id: "a5_1", role: "narrator", text: "Behind the scenes, four Gemini agents collaborate in parallel. To plan, generate, narrate, and verify the simulation in real time." },
  { id: "a6_1", role: "narrator", text: "Understanding isn't static." },
  { id: "a6_2", role: "narrator", text: "It unfolds." },
  { id: "a6_3", role: "narrator", text: "Mira turns ideas into living simulations." },
];

const VOICE_SETTINGS = {
  narrator: { stability: 0.5, similarity_boost: 0.8, style: 0.18, use_speaker_boost: true },
  user: { stability: 0.4, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
};

async function pickUserVoice() {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": API_KEY },
    });
    if (!res.ok) throw new Error(`voices ${res.status}`);
    const { voices } = await res.json();
    console.log("Available voices:", voices.map((v) => `${v.name} (${v.voice_id})`).join(", "));
    const other = voices.find((v) => v.voice_id !== NARRATOR_VOICE);
    if (other) {
      console.log(`User prompts -> ${other.name} (${other.voice_id})`);
      return other.voice_id;
    }
  } catch (e) {
    console.warn("Could not list voices, reusing narrator voice for user lines:", e.message);
  }
  return NARRATOR_VOICE;
}

async function synth(text, voiceId, settings) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: settings }),
    },
  );
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text().catch(() => "")}`);
  return Buffer.from(await res.arrayBuffer());
}

function probeDuration(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(out.toString().trim());
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const userVoice = await pickUserVoice();
  const manifest = [];
  for (const line of LINES) {
    const file = join(OUT_DIR, `${line.id}.mp3`);
    const voiceId = line.role === "user" ? userVoice : NARRATOR_VOICE;
    if (FORCE || !(await exists(file))) {
      process.stdout.write(`synth ${line.id} (${line.role}) ... `);
      const buf = await synth(line.text, voiceId, VOICE_SETTINGS[line.role]);
      await writeFile(file, buf);
      console.log(`${(buf.length / 1024).toFixed(0)}kb`);
    }
    const duration = probeDuration(file);
    manifest.push({ id: line.id, role: line.role, text: line.text, file: `narration/${line.id}.mp3`, duration });
  }
  await mkdir(dirname(MANIFEST), { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  const total = manifest.reduce((s, m) => s + m.duration, 0);
  console.log(`\nWrote ${manifest.length} clips, ${total.toFixed(1)}s total speech -> ${MANIFEST}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
