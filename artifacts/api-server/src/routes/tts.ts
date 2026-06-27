import { Router, type IRouter } from "express";
import { SynthesizeSpeechBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const HF_SPACE = "https://openbmb-voxcpm-demo.hf.space";

async function uploadAudioToGradio(
  base64: string,
  filename: string
): Promise<string> {
  const binary = Buffer.from(base64, "base64");
  const blob = new Blob([binary]);
  const form = new FormData();
  form.append("files", blob, filename);

  const uploadId = crypto.randomUUID();
  const res = await fetch(
    `${HF_SPACE}/gradio_api/upload?upload_id=${uploadId}`,
    { method: "POST", body: form }
  );
  if (!res.ok) {
    throw new Error(`HF upload failed: ${res.status}`);
  }
  const paths: string[] = await res.json();
  return paths[0];
}

async function callGradioGenerate(params: {
  text: string;
  control_instruction: string;
  reference_path: string | null;
  use_prompt_text: boolean;
  prompt_text: string;
  cfg_value: number;
  do_normalize: boolean;
  denoise: boolean;
}): Promise<ArrayBuffer> {
  const referenceData = params.reference_path
    ? {
        path: params.reference_path,
        meta: { _type: "gradio.FileData" },
        orig_name: "reference.wav",
      }
    : null;

  const startRes = await fetch(`${HF_SPACE}/gradio_api/call/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        params.text,
        params.control_instruction,
        referenceData,
        params.use_prompt_text,
        params.prompt_text,
        params.cfg_value,
        params.do_normalize,
        params.denoise,
      ],
    }),
  });

  if (!startRes.ok) {
    const body = await startRes.text();
    throw new Error(`Gradio generate failed: ${startRes.status} ${body}`);
  }

  const { event_id } = (await startRes.json()) as { event_id: string };

  const sseRes = await fetch(
    `${HF_SPACE}/gradio_api/call/generate/${event_id}`
  );
  if (!sseRes.ok || !sseRes.body) {
    throw new Error(`Gradio SSE failed: ${sseRes.status}`);
  }

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let audioUrl: string | null = null;

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let eventType: string | null = null;
    let dataLine: string | null = null;

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataLine = line.slice(6).trim();
      } else if (line === "" && eventType) {
        if (eventType === "complete" && dataLine) {
          const data = JSON.parse(dataLine) as Array<{ url?: string }>;
          const url = data[0]?.url;
          if (url) {
            audioUrl = url;
            break outer;
          }
        } else if (eventType === "error") {
          throw new Error(`VoxCPM2 error: ${dataLine ?? "unknown"}`);
        }
        eventType = null;
        dataLine = null;
      }
    }
  }

  if (!audioUrl) throw new Error("No audio URL in Gradio response");

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Audio fetch failed: ${audioRes.status}`);
  return audioRes.arrayBuffer();
}

const VOXCPM_MODES = [
  {
    id: "voice_design",
    label: "Voice Design",
    description: "Describe a voice from scratch — gender, age, tone, emotion, pace.",
  },
  {
    id: "controllable_cloning",
    label: "Controllable Cloning",
    description: "Upload a reference audio and guide the style via instructions.",
  },
  {
    id: "ultimate_cloning",
    label: "Ultimate Cloning",
    description: "Upload a reference audio with its transcript for maximum fidelity.",
  },
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
  { code: "hi", label: "Hindi" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "tr", label: "Turkish" },
  { code: "pl", label: "Polish" },
  { code: "km", label: "Khmer" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
];

router.get("/tts/models", (_req, res): void => {
  res.json({
    models: [
      {
        id: "voxcpm2",
        name: "VoxCPM2 (HuggingFace)",
        modes: VOXCPM_MODES,
        languages: LANGUAGES,
      },
    ],
  });
});

router.post("/tts/synthesize", async (req, res): Promise<void> => {
  const parsed = SynthesizeSpeechBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid TTS request body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    text,
    control_instruction = "",
    reference_audio_base64 = null,
    reference_audio_name = null,
    use_prompt_text = false,
    prompt_text = "",
    cfg_value = 2.0,
    do_normalize = false,
    denoise = false,
  } = parsed.data;

  req.log.info(
    { textLength: text.length, hasReference: !!reference_audio_base64 },
    "Synthesizing via VoxCPM2 (HuggingFace)"
  );

  let referencePath: string | null = null;
  if (reference_audio_base64) {
    const filename = reference_audio_name ?? "reference.wav";
    referencePath = await uploadAudioToGradio(reference_audio_base64, filename);
    req.log.info({ referencePath }, "Reference audio uploaded to HF");
  }

  const audioBuffer = await callGradioGenerate({
    text,
    control_instruction,
    reference_path: referencePath,
    use_prompt_text,
    prompt_text,
    cfg_value,
    do_normalize,
    denoise,
  });

  req.log.info({ bytes: audioBuffer.byteLength }, "VoxCPM2 synthesis complete");

  res.set("Content-Type", "audio/wav");
  res.set("Content-Length", String(audioBuffer.byteLength));
  res.set("Cache-Control", "no-store");
  res.send(Buffer.from(audioBuffer));
});

export default router;
