export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { text, lang = "EN", speed = 1.0 } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return Response.json({ error: "text is required" }, { status: 400 });
    }

    if (text.length > 2000) {
      return Response.json(
        { error: "text must be 2000 characters or less" },
        { status: 400 }
      );
    }

    const response = await context.env.AI.run("@cf/myshell-ai/melotts", {
      text,
      lang,
      speed,
    });

    return new Response(response, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("TTS synthesis error:", err);
    return Response.json(
      { error: err?.message ?? "TTS synthesis failed" },
      { status: 500 }
    );
  }
}
