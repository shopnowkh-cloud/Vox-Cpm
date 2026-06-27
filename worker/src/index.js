const TG_API = "https://api.telegram.org";
const HF_SPACE = "https://openbmb-voxcpm-demo.hf.space";

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

async function editMessage(env, chat_id, message_id, text, extra = {}) {
  return tg(env, "editMessageText", {
    chat_id, message_id, text, parse_mode: "Markdown", ...extra,
  }).catch(() => {});
}

async function answerCallback(env, callback_query_id, text = "") {
  return tg(env, "answerCallbackQuery", { callback_query_id, text });
}

async function sendVoice(env, chat_id, audioUrl, caption, extra = {}) {
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Failed to fetch audio: ${audioResp.status}`);
  const audioBytes = await audioResp.arrayBuffer();

  const form = new FormData();
  form.append("chat_id", String(chat_id));
  form.append("caption", caption);
  form.append("parse_mode", "Markdown");
  form.append("voice", new Blob([audioBytes], { type: "audio/ogg" }), "voice.ogg");
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
    [{ text: "❓ Help", callback_data: "help" }],
  ],
};

const BACK_KB = {
  inline_keyboard: [[{ text: "🔙 ត្រឡប់ Menu", callback_data: "back_menu" }]],
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
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) throw new Error("No data in SSE response");

  const parsed = JSON.parse(dataLine.slice(5).trim());
  const filePath = parsed?.[0]?.path || parsed?.[0]?.value || parsed?.[0];
  if (!filePath) throw new Error("No audio path in Gradio response");

  return `${HF_SPACE}/gradio_api/file=${filePath}`;
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
        "🏠 *Main Menu*\n\nជ្រើសរើស មុខងារ ដែលចង់ប្រើ:",
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
    const status = await sendMessage(env, chatId,
      "⏳ *Voice Design* — កំពុង generate audio..."
    );
    try {
      const audioUrl = await gradioGenerate(text);
      const caption =
        `🎙️ *VoxCPM2 — Voice Design*\n📝 \`${text.slice(0, 100)}${text.length > 100 ? "..." : ""}\``;
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
    "🏠 *Main Menu*\n\nជ្រើសរើស មុខងារ ដែលចង់ប្រើ:",
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
