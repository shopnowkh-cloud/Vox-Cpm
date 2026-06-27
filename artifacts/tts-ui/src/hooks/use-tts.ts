import { useMutation } from "@tanstack/react-query";
import { TtsInput } from "@workspace/api-client-react";

export type AudioHistoryItem = {
  id: string;
  text: string;
  lang: string;
  speed: number;
  audioUrl: string;
  createdAt: Date;
};

export function useSynthesizeAudio() {
  return useMutation({
    mutationFn: async (data: TtsInput) => {
      const response = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        let errorMsg = "Failed to synthesize speech";
        try {
          const errData = await response.json();
          if (errData.error) errorMsg = errData.error;
        } catch (e) {
          // ignore
        }
        throw new Error(errorMsg);
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    },
  });
}
