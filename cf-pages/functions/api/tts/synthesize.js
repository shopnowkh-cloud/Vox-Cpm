const HF_SPACE = "https://openbmb-voxcpm-demo.hf.space";

async function uploadAudioToGradio(base64, filename) {
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([binary]);
  const form = new FormData();
  form.append("files", blob, filename);

  const uploadId = crypto.randomUUID();
  const res = await fetch(
    `${HF_SPACE}/gradio_api/upload?upload_id=${uploadId}`,
    { method: "POST", body: form }
  );
  if (!res.ok) throw new Error(`HF upload failed: ${res.status}`);
  const paths = await res.json();
  return paths[0];
}

async function callGradioGenerate({
  text,
  control_instruction,
  reference_path,
  use_prompt_text,
  prompt_text,
  cfg_value,
  do_normalize,
  denoise,
}) {
  const referenceData = reference_path
    ? {
        path: reference_path,
        meta: { _type: "gradio.FileData" },
        orig_name: "reference.wav",
      }
    : null;

  const startRes = await fetch(`${HF_SPACE}/gradio_api/call/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        text,
        control_instruction,
        referenceData,
        use_prompt_text,
        prompt_text,
        cfg_value,
        do_normalize,
        denoise,
      ],
    }),
  });

  if (!startRes.ok) {
    const body = await startRes.text();
    throw new Error(`Gradio start failed: ${startRes.status} ${body}`);
  }

  const { event_id } = await startRes.json();

  const sseRes = await fetch(
    `${HF_SPACE}/gradio_api/call/generate/${event_id}`
  );
  if (!sseRes.ok || !sseRes.body) {
    throw new Error(`Gradio SSE failed: ${sseRes.status}`);
  }

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let audioUrl = null;

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let eventType = null;
    let dataLine = null;

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataLine = line.slice(6).trim();
      } else if (line === "" && eventType) {
        if (eventType === "complete" && dataLine) {
          const data = JSON.parse(dataLine);
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

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
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
    } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return Response.json({ error: "text is required" }, { status: 400 });
    }
    if (text.length > 2000) {
      return Response.json(
        { error: "text must be 2000 characters or less" },
        { status: 400 }
      );
    }

    let referencePath = null;
    if (reference_audio_base64) {
      const filename = reference_audio_name ?? "reference.wav";
      referencePath = await uploadAudioToGradio(reference_audio_base64, filename);
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

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("VoxCPM2 synthesis error:", err);
    return Response.json(
      { error: err?.message ?? "TTS synthesis failed" },
      { status: 500 }
    );
  }
}
