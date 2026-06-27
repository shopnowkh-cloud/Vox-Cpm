import { useMutation } from "@tanstack/react-query";
import type { VoxCpmInput } from "@workspace/api-client-react";

export type TtsMode = "voice_design" | "controllable_cloning" | "ultimate_cloning";

export type AudioHistoryItem = {
  id: string;
  text: string;
  mode: TtsMode;
  controlInstruction: string;
  audioUrl: string;
  createdAt: Date;
};

export function useSynthesizeAudio() {
  return useMutation({
    mutationFn: async (data: VoxCpmInput) => {
      const response = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        let errorMsg = "Failed to synthesize speech";
        try {
          const errData = await response.json();
          if (errData.error) errorMsg = errData.error;
        } catch {
          // ignore
        }
        throw new Error(errorMsg);
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    },
  });
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
