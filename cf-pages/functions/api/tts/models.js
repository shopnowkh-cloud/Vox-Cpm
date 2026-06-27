export async function onRequestGet() {
  return Response.json({
    models: [
      {
        id: "voxcpm2",
        name: "VoxCPM2 (HuggingFace)",
        modes: [
          {
            id: "voice_design",
            label: "Voice Design",
            description:
              "Describe a voice from scratch — gender, age, tone, emotion, pace.",
          },
          {
            id: "controllable_cloning",
            label: "Controllable Cloning",
            description:
              "Upload a reference audio and guide the style via instructions.",
          },
          {
            id: "ultimate_cloning",
            label: "Ultimate Cloning",
            description:
              "Upload a reference audio with its transcript for maximum fidelity.",
          },
        ],
        languages: [
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
        ],
      },
    ],
  });
}
