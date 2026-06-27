export async function onRequestGet() {
  return Response.json({
    models: [
      {
        id: "@cf/myshell-ai/melotts",
        name: "MeloTTS (Cloudflare Workers AI)",
        languages: [
          { code: "EN", label: "English" },
          { code: "ZH", label: "Chinese" },
          { code: "ES", label: "Spanish" },
          { code: "FR", label: "French" },
          { code: "JP", label: "Japanese" },
          { code: "KR", label: "Korean" },
        ],
      },
    ],
  });
}
