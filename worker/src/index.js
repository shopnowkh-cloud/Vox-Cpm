import OpusScript from "opusscript";

const TG_API = "https://api.telegram.org";
const HF_SPACE = "https://openbmb-voxcpm-demo.hf.space";

// ── Audio format detection ────────────────────────────────────────────────────

function detectAudioFormat(buf) {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if ((b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ||
      (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x44)) return "mp3";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "wav";
  return "unknown";
}

// ── WAV → OGG Opus conversion ─────────────────────────────────────────────────

function parseWav(buf) {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Verify RIFF/WAVE magic
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== "RIFF" || wave !== "WAVE") {
    const preview = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2,"0")).join(" ");
    throw new Error(`Not a WAV file (bytes: ${preview})`);
  }

  // Walk all chunks to find fmt and data
  let audioFormat = 1, numChannels = 1, sampleRate = 48000, bitsPerSample = 16;
  let dataOffset = null, dataSize = null;
  let off = 12;

  while (off + 8 <= buf.byteLength) {
    const id = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]);
    const size = v.getUint32(off + 4, true);

    if (id === "fmt ") {
      audioFormat  = v.getUint16(off + 8,  true); // 1=PCM int, 3=IEEE float
      numChannels  = v.getUint16(off + 10, true);
      sampleRate   = v.getUint32(off + 12, true);
      bitsPerSample = v.getUint16(off + 22, true);
    } else if (id === "data") {
      dataOffset = off + 8;
      dataSize   = size;
      break;
    }

    // Chunks are padded to 2-byte boundaries
    off += 8 + size + (size & 1);
  }

  if (dataOffset === null) throw new Error("WAV data chunk not found");
  return { audioFormat, sampleRate, numChannels, bitsPerSample, dataOffset, dataSize };
}

function toMono48kFloat32(buf, { audioFormat, sampleRate, numChannels, bitsPerSample, dataOffset, dataSize }) {
  const v = new DataView(buf);
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / bytesPerSample);
  const frames = Math.floor(totalSamples / numChannels);

  // Convert to mono Float32
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < numChannels; c++) {
      const o = dataOffset + (i * numChannels + c) * bytesPerSample;
      if (audioFormat === 3) {
        s += v.getFloat32(o, true);             // IEEE float32
      } else if (bitsPerSample === 16) {
        s += v.getInt16(o, true) / 32768;       // PCM 16-bit
      } else if (bitsPerSample === 32) {
        s += v.getInt32(o, true) / 2147483648;  // PCM 32-bit int
      } else if (bitsPerSample === 8) {
        s += (v.getUint8(o) - 128) / 128;       // PCM 8-bit
      }
    }
    mono[i] = s / numChannels;
  }

  if (sampleRate === 48000) return mono;

  // Linear resample to 48kHz
  const ratio = sampleRate / 48000;
  const out = new Float32Array(Math.ceil(frames / ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i * ratio;
    const lo = Math.floor(src), hi = Math.min(lo + 1, frames - 1);
    out[i] = mono[lo] * (1 - (src - lo)) + mono[hi] * (src - lo);
  }
  return out;
}

// OGG CRC32 (poly 0x04C11DB7, non-reflected)
const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let h = i << 24;
    for (let j = 0; j < 8; j++) h = (h & 0x80000000) ? ((h << 1) ^ 0x04c11db7) : (h << 1);
    t[i] = h >>> 0;
  }
  return t;
})();

function oggCrc32(data) {
  let crc = 0;
  for (let i = 0; i < data.length; i++) crc = (((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0);
  return crc;
}

function oggPage(flags, granule, serial, seq, packets) {
  const segs = [];
  for (const p of packets) { let r = p.length; while (r >= 255) { segs.push(255); r -= 255; } segs.push(r); }
  const dataLen = packets.reduce((s, p) => s + p.length, 0);
  const hLen = 27 + segs.length;
  const page = new Uint8Array(hLen + dataLen);
  const v = new DataView(page.buffer);
  page[0]=79; page[1]=103; page[2]=103; page[3]=83; // OggS
  page[4]=0; page[5]=flags;
  v.setUint32(6, granule >>> 0, true);
  v.setUint32(10, Math.floor(granule / 0x100000000) >>> 0, true);
  v.setUint32(14, serial >>> 0, true);
  v.setUint32(18, seq >>> 0, true);
  v.setUint32(22, 0, true); // checksum placeholder
  page[26] = segs.length;
  segs.forEach((s, i) => { page[27 + i] = s; });
  let off = hLen;
  for (const p of packets) { page.set(p, off); off += p.length; }
  v.setUint32(22, oggCrc32(page), true);
  return page;
}

function opusHead(channels, origRate) {
  const b = new Uint8Array(19);
  const v = new DataView(b.buffer);
  b.set([79,112,117,115,72,101,97,100], 0); // OpusHead
  b[8]=1; b[9]=channels;
  v.setUint16(10, 312, true); // pre-skip
  v.setUint32(12, origRate, true);
  v.setInt16(16, 0, true); b[18]=0;
  return b;
}

function opusTags() {
  const enc = new TextEncoder(), v = enc.encode("VoxCPM2Bot");
  const b = new Uint8Array(8 + 4 + v.length + 4);
  const dv = new DataView(b.buffer);
  b.set(enc.encode("OpusTags"), 0);
  dv.setUint32(8, v.length, true); b.set(v, 12);
  dv.setUint32(12 + v.length, 0, true);
  return b;
}

// Shared: encode a mono Float32 array (at 48 kHz) to OGG Opus bytes.
// origSampleRate is embedded in the OpusHead for player metadata only.
function monoToOggOpus(pcm48k, origSampleRate) {
  const encoder = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
  const FRAME = 960; // 20 ms @ 48 kHz
  const PRE_SKIP = 312;
  const serial = (Math.random() * 0x7fffffff) | 0;
  let seq = 0, granule = 0;
  const pages = [];

  pages.push(oggPage(0x02, 0, serial, seq++, [opusHead(1, origSampleRate)]));
  pages.push(oggPage(0x00, 0, serial, seq++, [opusTags()]));

  for (let offset = 0; offset < pcm48k.length; offset += FRAME) {
    const chunk = new Float32Array(FRAME);
    chunk.set(pcm48k.subarray(offset, offset + FRAME));
    const pcm16 = new Int16Array(FRAME);
    for (let i = 0; i < FRAME; i++) pcm16[i] = Math.max(-32768, Math.min(32767, (chunk[i] * 32767) | 0));
    granule += FRAME;
    const isLast = offset + FRAME >= pcm48k.length;
    const encoded = encoder.encode(Buffer.from(pcm16.buffer), FRAME);
    pages.push(oggPage(isLast ? 0x04 : 0x00, granule + PRE_SKIP, serial, seq++, [encoded]));
  }

  encoder.delete();
  const total = pages.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of pages) { out.set(p, pos); pos += p.length; }
  return out;
}

function wavToOggOpus(wavBuffer) {
  const info = parseWav(wavBuffer);
  const pcm = toMono48kFloat32(wavBuffer, info);
  return monoToOggOpus(pcm, info.sampleRate);
}

// Fetch audio from HuggingFace and return { bytes, mimeType }.
// WAV is converted to OGG Opus locally (Telegram doesn't accept WAV).
// MP3/M4A are passed through as-is — Telegram's sendVoice accepts them natively.
async function fetchAudioForVoice(audioUrl) {
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Audio fetch failed: ${audioResp.status}`);
  const audioBuffer = await audioResp.arrayBuffer();

  const fmt = detectAudioFormat(audioBuffer);
  if (fmt === "wav") {
    // WAV is not accepted by Telegram — convert to OGG Opus locally
    return { bytes: wavToOggOpus(audioBuffer), mimeType: "audio/ogg", filename: "voice.ogg" };
  }

  // MP3 (and M4A): Telegram's sendVoice accepts these natively — no conversion needed
  return { bytes: new Uint8Array(audioBuffer), mimeType: "audio/mpeg", filename: "voice.mp3" };
}

// ── Telegram helpers ──────────────────────────────────────────────────────────
async function tg(env, method, body) {
  const r = await fetch(`${TG_API}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function sendMessage(env, chat_id, text, extra = {}) {
  return tg(env, "sendMessage", { chat_id, text, parse_mode: "Markdown", ...extra });
}

async function sendSticker(env, chat_id, sticker) {
  return tg(env, "sendSticker", { chat_id, sticker });
}

async function editMessage(env, chat_id, message_id, text, extra = {}) {
  return tg(env, "editMessageText", {
    chat_id, message_id, text, parse_mode: "Markdown", ...extra,
  }).catch(() => {});
}

async function answerCallback(env, callback_query_id, text = "") {
  return tg(env, "answerCallbackQuery", { callback_query_id, text });
}

async function sendVoice(env, chat_id, audioUrl, caption, extra = {}) {
  const { bytes, mimeType, filename } = await fetchAudioForVoice(audioUrl);

  const form = new FormData();
  form.append("chat_id", String(chat_id));
  form.append("caption", caption);
  form.append("parse_mode", "Markdown");
  form.append("voice", new Blob([bytes], { type: mimeType }), filename);
  if (extra.reply_markup) {
    form.append("reply_markup", JSON.stringify(extra.reply_markup));
  }

  const r = await fetch(`${TG_API}/bot${env.BOT_TOKEN}/sendVoice`, {
    method: "POST",
    body: form,
  });
  return r.json();
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
const MAIN_MENU_KB = {
  inline_keyboard: [
    [{ text: "🎨 Voice Design", callback_data: "mode_design" }],
    [{ text: "🎛️ Controllable Cloning", callback_data: "mode_control" }],
    [{ text: "🎙️ Voice Cloning", callback_data: "mode_clone" }],
  ],
};

const BACK_KB = {
  inline_keyboard: [[{ text: "Back", callback_data: "back_menu", icon_custom_emoji_id: "5877629862306385808" }]],
};

const AFTER_AUDIO_KB = {
  inline_keyboard: [
    [{ text: "🔄 Generate Again", callback_data: "back_menu" }],
    [{ text: "🏠 Main Menu", callback_data: "back_menu" }],
  ],
};

// ── State helpers (KV) ────────────────────────────────────────────────────────
async function getState(env, userId) {
  const raw = await env.BOT_KV.get(`state:${userId}`);
  return raw ? JSON.parse(raw) : { step: "menu" };
}

async function setState(env, userId, state) {
  await env.BOT_KV.put(`state:${userId}`, JSON.stringify(state), {
    expirationTtl: 3600,
  });
}

async function clearState(env, userId) {
  await env.BOT_KV.delete(`state:${userId}`);
}

// ── HuggingFace Gradio API ────────────────────────────────────────────────────
async function gradioGenerate(textInput, controlInstruction = "", refFileUrl = null) {
  let uploadedFilePath = null;

  if (refFileUrl) {
    const fileBytes = await fetch(refFileUrl).then((r) => r.arrayBuffer());
    const form = new FormData();
    form.append("files", new Blob([fileBytes], { type: "audio/ogg" }), "ref.ogg");
    const upResp = await fetch(`${HF_SPACE}/gradio_api/upload`, {
      method: "POST",
      body: form,
    }).then((r) => r.json());
    if (Array.isArray(upResp) && upResp[0]) {
      uploadedFilePath = upResp[0];
    }
  }

  const payload = {
    data: [
      textInput,
      controlInstruction,
      uploadedFilePath ? { path: uploadedFilePath } : null,
      false,
      "",
      2.0,
      false,
      false,
    ],
  };

  const initResp = await fetch(`${HF_SPACE}/gradio_api/call/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!initResp.ok) throw new Error(`Gradio init failed: ${initResp.status}`);
  const { event_id } = await initResp.json();
  if (!event_id) throw new Error("No event_id returned from Gradio");

  const sseResp = await fetch(
    `${HF_SPACE}/gradio_api/call/generate/${event_id}`
  );
  if (!sseResp.ok) throw new Error(`SSE stream failed: ${sseResp.status}`);

  const text = await sseResp.text();
  const lines = text.split("\n");
  let eventType = null, dataStr = null, audioUrl = null;

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataStr = line.slice(6).trim();
    } else if (line === "") {
      if (eventType === "complete" && dataStr) {
        const parsed = JSON.parse(dataStr);
        const url = parsed?.[0]?.url;
        if (url) { audioUrl = url; break; }
      } else if (eventType === "error") {
        throw new Error(`Gradio error: ${dataStr ?? "unknown"}`);
      }
      eventType = null;
      dataStr = null;
    }
  }

  if (!audioUrl) throw new Error("No audio URL in Gradio complete event");
  return audioUrl;
}

// ── Download Telegram file URL ────────────────────────────────────────────────
async function getTgFileUrl(env, fileId) {
  const resp = await tg(env, "getFile", { file_id: fileId });
  const path = resp?.result?.file_path;
  if (!path) return null;
  return `${TG_API}/file/bot${env.BOT_TOKEN}/${path}`;
}

// ── Main processing (runs inside waitUntil) ───────────────────────────────────
async function processUpdate(env, update) {
  const msg = update.message;
  const cbq = update.callback_query;
  const userId = msg?.from?.id ?? cbq?.from?.id;
  const chatId = msg?.chat?.id ?? cbq?.message?.chat?.id;
  if (!userId || !chatId) return;

  // ── Callback query (button click) ──────────────────────────────────────────
  if (cbq) {
    await answerCallback(env, cbq.id);
    const data = cbq.data;
    const msgId = cbq.message.message_id;

    if (data === "back_menu" || data === "regen") {
      await clearState(env, userId);
      await editMessage(env, chatId, msgId,
        "👋 ស្វាគមន៍មកកាន់ VoxCPM2 Bot!\n\n🌍 AI Text-to-Speech — 30 ភាសា\nជ្រើសរើស មុខងារ ដែលចង់ប្រើ:",
        { reply_markup: MAIN_MENU_KB }
      );
      return;
    }

    if (data === "help") {
      await editMessage(env, chatId, msgId,
        "❓ *របៀបប្រើ VoxCPM2 Bot*\n\n" +
        "🎨 *Voice Design*\n" +
        "Generate audio ពី text ធម្មតា\n" +
        "ឧទាហរណ៍: `Hello, welcome!`\n\n" +
        "🎛️ *Controllable Cloning*\n" +
        "ជ្រើស style + ផ្ញើ text\n" +
        "Style: `young woman, soft voice`\n\n" +
        "🎙️ *Voice Cloning*\n" +
        "Upload audio → ផ្ញើ text → clone!\n\n" +
        "🌍 30 Languages: EN, KH, ZH, JA, KO, FR ...",
        { reply_markup: BACK_KB }
      );
      return;
    }

    if (data === "mode_design") {
      await setState(env, userId, { step: "design_text" });
      await editMessage(env, chatId, msgId,
        "🎨 *Voice Design*\n\n" +
        "សរសេរ text ដែលចង់ generate audio:\n\n" +
        "✏️ ឧទាហរណ៍:\n" +
        "• `Hello, how are you today?`\n" +
        "• `ស្វាគមន៍មកកាន់ VoxCPM2`\n" +
        "• `你好，欢迎使用语音合成！`",
        { reply_markup: BACK_KB }
      );
      return;
    }

    if (data === "mode_control") {
      await setState(env, userId, { step: "control_style" });
      await editMessage(env, chatId, msgId,
        "🎛️ *Controllable Cloning*\n\n" +
        "*ជំហាន 1:* ពណ៌នា style សំឡេង\n\n" +
        "✏️ ឧទាហរណ៍:\n" +
        "• `young woman, soft and gentle`\n" +
        "• `old man, deep serious voice`\n" +
        "• `excited, fast paced`\n" +
        "• `ស្ដ្រី, ទន់ភ្លន់ និងស្ងប់ស្ងាត់`\n" +
        "• `年轻女性，温柔甜美`",
        { reply_markup: BACK_KB }
      );
      return;
    }

    if (data === "mode_clone") {
      await setState(env, userId, { step: "clone_audio" });
      await editMessage(env, chatId, msgId,
        "🎙️ *Voice Cloning*\n\n" +
        "*ជំហាន 1:* ផ្ញើ voice message ឬ audio file\n" +
        "ដែលចង់ clone សំឡេង\n\n" +
        "💡 Tips:\n" +
        "• Audio ច្បាស់ = clone ល្អ\n" +
        "• យ៉ាងតិច 3-10 វិនាទី",
        { reply_markup: BACK_KB }
      );
      return;
    }
    return;
  }

  // ── Text & media messages ───────────────────────────────────────────────────
  if (!msg) return;

  const text = (msg.text || "").trim();

  // /start command
  if (text === "/start" || text.startsWith("/start ")) {
    await clearState(env, userId);
    await sendMessage(env, chatId,
      "👋 *ស្វាគមន៍មកកាន់ VoxCPM2 Bot!*\n\n" +
      "🌍 AI Text-to-Speech — 30 ភាសា\n" +
      "ជ្រើសរើស មុខងារ ដែលចង់ប្រើ:",
      { reply_markup: MAIN_MENU_KB }
    );
    return;
  }

  const state = await getState(env, userId);

  // ── Voice Design: waiting for text ─────────────────────────────────────────
  if (state.step === "design_text" && text) {
    const status = await sendSticker(env, chatId,
      "CAACAgUAAxkBAAEDu4Zp-rTrlmnphDX-WIT9au-O6aW5CwACLRYAAvgG8VSjN2gKlvlMQTsE"
    );
    try {
      const audioUrl = await gradioGenerate(text);
      const caption =
        `Voice Design`;
      await sendVoice(env, chatId, audioUrl, caption, { reply_markup: AFTER_AUDIO_KB });
    } catch (e) {
      await sendMessage(env, chatId, `❌ Error: ${e.message}`, { reply_markup: BACK_KB });
    }
    await tg(env, "deleteMessage", { chat_id: chatId, message_id: status.result?.message_id }).catch(() => {});
    await clearState(env, userId);
    return;
  }

  // ── Controllable: waiting for style ────────────────────────────────────────
  if (state.step === "control_style" && text) {
    await setState(env, userId, { step: "control_text", style: text });
    await sendMessage(env, chatId,
      `✅ Style: \`${text}\`\n\n` +
      "*ជំហាន 2:* ឥឡូវសរសេរ text ដែលចង់ generate:",
      { reply_markup: BACK_KB }
    );
    return;
  }

  // ── Controllable: waiting for text ─────────────────────────────────────────
  if (state.step === "control_text" && text) {
    const control = state.style || "";
    const status = await sendMessage(env, chatId,
      `⏳ *Controllable Cloning*\n🎛️ \`${control}\`\nកំពុង generate...`
    );
    try {
      const audioUrl = await gradioGenerate(text, control);
      const caption =
        `🎙️ *VoxCPM2 — Controllable*\n🎛️ \`${control}\`\n📝 \`${text.slice(0, 80)}${text.length > 80 ? "..." : ""}\``;
      await sendVoice(env, chatId, audioUrl, caption, { reply_markup: AFTER_AUDIO_KB });
    } catch (e) {
      await sendMessage(env, chatId, `❌ Error: ${e.message}`, { reply_markup: BACK_KB });
    }
    await tg(env, "deleteMessage", { chat_id: chatId, message_id: status.result?.message_id }).catch(() => {});
    await clearState(env, userId);
    return;
  }

  // ── Voice Clone: waiting for audio ─────────────────────────────────────────
  if (state.step === "clone_audio") {
    const audioEnt = msg.voice || msg.audio ||
      (msg.document?.mime_type?.includes("audio") ? msg.document : null);
    if (!audioEnt) {
      await sendMessage(env, chatId,
        "⚠️ សូម upload *voice message* ឬ *audio file*!\nមិនមែន text ទេ។",
        { reply_markup: BACK_KB }
      );
      return;
    }
    const fileUrl = await getTgFileUrl(env, audioEnt.file_id);
    await setState(env, userId, { step: "clone_text", fileUrl });
    await sendMessage(env, chatId,
      "✅ *Audio received!*\n\n" +
      "*ជំហាន 2:* ឥឡូវសរសេរ text ដែលចង់ generate\n" +
      "ដោយប្រើ សំឡេង clone នោះ:\n\n" +
      "✏️ ឧទាហរណ៍: `Hello, this is my cloned voice!`",
      { reply_markup: BACK_KB }
    );
    return;
  }

  // ── Voice Clone: waiting for text ──────────────────────────────────────────
  if (state.step === "clone_text" && text) {
    const fileUrl = state.fileUrl;
    const status = await sendMessage(env, chatId,
      "⏳ *Voice Cloning* — កំពុង clone ហើយ generate..."
    );
    try {
      const audioUrl = await gradioGenerate(text, "", fileUrl);
      const caption =
        `🎙️ *VoxCPM2 — Voice Clone*\n📝 \`${text.slice(0, 100)}${text.length > 100 ? "..." : ""}\``;
      await sendVoice(env, chatId, audioUrl, caption, { reply_markup: AFTER_AUDIO_KB });
    } catch (e) {
      await sendMessage(env, chatId, `❌ Error: ${e.message}`, { reply_markup: BACK_KB });
    }
    await tg(env, "deleteMessage", { chat_id: chatId, message_id: status.result?.message_id }).catch(() => {});
    await clearState(env, userId);
    return;
  }

  // ── Default: show menu ──────────────────────────────────────────────────────
  await clearState(env, userId);
  await sendMessage(env, chatId,
    "👋 ស្វាគមន៍មកកាន់ VoxCPM2 Bot!\n\n🌍 AI Text-to-Speech — 30 ភាសា\nជ្រើសរើស មុខងារ ដែលចង់ប្រើ:",
    { reply_markup: MAIN_MENU_KB }
  );
}

// ── Worker entry point ────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("VoxCPM2 Bot is running ✅", { status: 200 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    ctx.waitUntil(processUpdate(env, update));
    return new Response("OK", { status: 200 });
  },
};
