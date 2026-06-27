import { Router, type IRouter } from "express";
import { SynthesizeSpeechBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;

const TTS_MODEL = "@cf/myshell-ai/melotts";

const SUPPORTED_LANGUAGES = [
  { code: "EN", label: "English" },
  { code: "ZH", label: "Chinese" },
  { code: "ES", label: "Spanish" },
  { code: "FR", label: "French" },
  { code: "JP", label: "Japanese" },
  { code: "KR", label: "Korean" },
];

router.get("/tts/models", (_req, res): void => {
  res.json({
    models: [
      {
        id: TTS_MODEL,
        name: "MeloTTS (Cloudflare Workers AI)",
        languages: SUPPORTED_LANGUAGES,
      },
    ],
  });
});

router.post("/tts/synthesize", async (req, res): Promise<void> => {
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
    req.log.error("Cloudflare credentials not configured");
    res.status(500).json({ error: "Cloudflare credentials not configured" });
    return;
  }

  const parsed = SynthesizeSpeechBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid TTS request body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { text, lang = "EN", speed = 1.0 } = parsed.data;

  req.log.info({ lang, textLength: text.length }, "Synthesizing speech via Cloudflare AI");

  const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${TTS_MODEL}`;

  const cfResponse = await fetch(cfUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, lang, speed }),
  });

  if (!cfResponse.ok) {
    let errBody = "";
    try {
      errBody = await cfResponse.text();
    } catch {
      // ignore
    }
    req.log.error(
      { status: cfResponse.status, body: errBody },
      "Cloudflare Workers AI error"
    );
    res.status(502).json({
      error: `Cloudflare AI returned ${cfResponse.status}: ${errBody || cfResponse.statusText}`,
    });
    return;
  }

  const contentType = cfResponse.headers.get("content-type") ?? "audio/wav";
  const audioBuffer = await cfResponse.arrayBuffer();

  req.log.info({ bytes: audioBuffer.byteLength }, "Speech synthesis complete");

  res.set("Content-Type", contentType);
  res.set("Content-Length", String(audioBuffer.byteLength));
  res.set("Cache-Control", "no-store");
  res.send(Buffer.from(audioBuffer));
});

export default router;
