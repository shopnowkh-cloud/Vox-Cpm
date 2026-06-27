import { useState, useRef, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import {
  Mic2,
  History,
  Activity,
  Wand2,
  Copy,
  Sparkles,
  Upload,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";

import { useSynthesizeAudio, fileToBase64, type AudioHistoryItem, type TtsMode } from "@/hooks/use-tts";
import { Waveform } from "@/components/waveform";
import { AudioPlayer } from "@/components/audio-player";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const MODE_CONFIG: Record<TtsMode, { label: string; icon: React.ReactNode; description: string; color: string }> = {
  voice_design: {
    label: "Voice Design",
    icon: <Wand2 className="h-4 w-4" />,
    description: "Create any voice from a text description",
    color: "text-violet-400 border-violet-500/40 bg-violet-500/10",
  },
  controllable_cloning: {
    label: "Controllable Cloning",
    icon: <Copy className="h-4 w-4" />,
    description: "Clone a voice timbre with style guidance",
    color: "text-sky-400 border-sky-500/40 bg-sky-500/10",
  },
  ultimate_cloning: {
    label: "Ultimate Cloning",
    icon: <Sparkles className="h-4 w-4" />,
    description: "Maximum fidelity clone with transcript",
    color: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  },
};

const formSchema = z.object({
  text: z.string().min(1, "Text is required").max(2000),
  control_instruction: z.string().default(""),
  prompt_text: z.string().default(""),
  cfg_value: z.number().min(1).max(3).default(2),
  do_normalize: z.boolean().default(false),
  denoise: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

const VOICE_DESIGN_EXAMPLES = [
  "A warm female voice in her 30s, speaks softly and clearly at a moderate pace.",
  "An energetic young male voice, enthusiastic tone, fast-paced and confident.",
  "An elderly gentle voice, calm and wise, slow and deliberate with a deep timbre.",
  "A professional news anchor voice, neutral accent, steady and authoritative.",
];

export default function Studio() {
  const { toast } = useToast();
  const [mode, setMode] = useState<TtsMode>("voice_design");
  const [history, setHistory] = useState<AudioHistoryItem[]>([]);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const synthesize = useSynthesizeAudio();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      text: "",
      control_instruction: "",
      prompt_text: "",
      cfg_value: 2,
      do_normalize: false,
      denoise: false,
    },
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setReferenceFile(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) setReferenceFile(file);
  }, []);

  const onSubmit = async (values: FormValues) => {
    if ((mode === "controllable_cloning" || mode === "ultimate_cloning") && !referenceFile) {
      toast({ title: "Reference audio required", description: "Please upload a reference audio file.", variant: "destructive" });
      return;
    }

    let reference_audio_base64: string | null = null;
    if (referenceFile) {
      reference_audio_base64 = await fileToBase64(referenceFile);
    }

    try {
      const audioUrl = await synthesize.mutateAsync({
        text: values.text,
        control_instruction: mode !== "ultimate_cloning" ? values.control_instruction : "",
        reference_audio_base64,
        reference_audio_name: referenceFile?.name ?? null,
        use_prompt_text: mode === "ultimate_cloning",
        prompt_text: mode === "ultimate_cloning" ? values.prompt_text : "",
        cfg_value: values.cfg_value,
        do_normalize: values.do_normalize,
        denoise: values.denoise,
      });

      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          text: values.text,
          mode,
          controlInstruction: values.control_instruction,
          audioUrl,
          createdAt: new Date(),
        },
        ...prev,
      ]);

      toast({ title: "Generation complete", description: "Your audio is ready." });
    } catch (err) {
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const textValue = form.watch("text");
  const cfgValue = form.watch("cfg_value");

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col md:flex-row overflow-hidden text-white">
      {/* LEFT: STUDIO CONTROLS */}
      <div className="w-full md:w-[62%] border-r border-white/5 flex flex-col h-screen overflow-y-auto">
        {/* Header */}
        <header className="px-8 py-6 border-b border-white/5 flex items-center gap-3 shrink-0">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500/20 to-sky-500/20 border border-violet-500/30 flex items-center justify-center">
            <Mic2 className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Vox Studio</h1>
            <p className="text-[11px] text-white/30 font-mono">Powered by VoxCPM2</p>
          </div>
          <div className="ml-auto">
            <Badge className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-[10px] font-mono">
              LIVE
            </Badge>
          </div>
        </header>

        <div className="flex-1 px-8 py-6 space-y-6">
          {/* Mode Selector */}
          <div>
            <p className="text-[11px] font-mono text-white/30 mb-3 uppercase tracking-widest">Generation Mode</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(MODE_CONFIG) as TtsMode[]).map((m) => {
                const cfg = MODE_CONFIG[m];
                const active = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "relative rounded-xl border p-3 text-left transition-all duration-200",
                      active
                        ? cfg.color
                        : "border-white/5 bg-white/2 text-white/40 hover:border-white/15 hover:text-white/60"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {cfg.icon}
                      <span className="text-[11px] font-semibold">{cfg.label}</span>
                    </div>
                    <p className="text-[10px] leading-snug opacity-70">{cfg.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text Input */}
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-[11px] font-mono text-white/30 uppercase tracking-widest">Target Text</Label>
                <span className="text-[10px] font-mono text-white/20">{textValue.length} / 2000</span>
              </div>
              <Controller
                control={form.control}
                name="text"
                render={({ field, fieldState }) => (
                  <>
                    <Textarea
                      {...field}
                      placeholder="Enter the text you want to synthesize..."
                      className="min-h-[140px] resize-none bg-white/3 border-white/8 text-white/90 placeholder:text-white/20 focus-visible:ring-violet-500/50 focus-visible:border-violet-500/40 rounded-xl text-sm leading-relaxed"
                    />
                    {fieldState.error && (
                      <p className="text-red-400 text-xs mt-1">{fieldState.error.message}</p>
                    )}
                  </>
                )}
              />
            </div>

            {/* Mode-specific controls */}
            {mode === "voice_design" && (
              <div>
                <Label className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-2 block">
                  Voice Description
                </Label>
                <Controller
                  control={form.control}
                  name="control_instruction"
                  render={({ field }) => (
                    <Textarea
                      {...field}
                      placeholder="Describe the voice: e.g. 'A warm female voice in her 30s, speaks softly at a moderate pace...'"
                      className="min-h-[90px] resize-none bg-white/3 border-white/8 text-white/90 placeholder:text-white/20 focus-visible:ring-violet-500/50 focus-visible:border-violet-500/40 rounded-xl text-sm"
                    />
                  )}
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  {VOICE_DESIGN_EXAMPLES.map((ex, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => form.setValue("control_instruction", ex)}
                      className="text-[10px] px-2 py-1 rounded-md bg-violet-500/8 border border-violet-500/20 text-violet-300/60 hover:text-violet-300 hover:bg-violet-500/15 transition-colors truncate max-w-[200px]"
                    >
                      {ex.slice(0, 35)}…
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === "controllable_cloning" && (
              <div className="space-y-4">
                <ReferenceAudioUpload
                  file={referenceFile}
                  onFile={setReferenceFile}
                  onDrop={handleDrop}
                  inputRef={fileInputRef}
                  onBrowse={() => fileInputRef.current?.click()}
                  onChange={handleFileChange}
                  accentClass="border-sky-500/30 hover:border-sky-500/60"
                />
                <div>
                  <Label className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-2 block">
                    Style Instruction <span className="text-white/15">(optional)</span>
                  </Label>
                  <Controller
                    control={form.control}
                    name="control_instruction"
                    render={({ field }) => (
                      <Textarea
                        {...field}
                        placeholder="Guide the style on top of the reference timbre: e.g. 'Speak more slowly and with a calm tone'"
                        className="min-h-[75px] resize-none bg-white/3 border-white/8 text-white/90 placeholder:text-white/20 focus-visible:ring-sky-500/50 rounded-xl text-sm"
                      />
                    )}
                  />
                </div>
              </div>
            )}

            {mode === "ultimate_cloning" && (
              <div className="space-y-4">
                <ReferenceAudioUpload
                  file={referenceFile}
                  onFile={setReferenceFile}
                  onDrop={handleDrop}
                  inputRef={fileInputRef}
                  onBrowse={() => fileInputRef.current?.click()}
                  onChange={handleFileChange}
                  accentClass="border-amber-500/30 hover:border-amber-500/60"
                />
                <div>
                  <Label className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-2 block">
                    Reference Transcript
                    <span className="text-white/30 normal-case font-sans ml-2 text-[10px]">
                      — exact words spoken in the reference audio
                    </span>
                  </Label>
                  <Controller
                    control={form.control}
                    name="prompt_text"
                    render={({ field }) => (
                      <Textarea
                        {...field}
                        placeholder="Type the exact text spoken in the reference audio..."
                        className="min-h-[75px] resize-none bg-white/3 border-white/8 text-white/90 placeholder:text-white/20 focus-visible:ring-amber-500/50 rounded-xl text-sm"
                      />
                    )}
                  />
                </div>
              </div>
            )}

            {/* Advanced Settings */}
            <div className="rounded-xl border border-white/5 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-4 py-3 text-[11px] font-mono text-white/30 hover:text-white/50 uppercase tracking-widest transition-colors"
              >
                Advanced Settings
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showAdvanced && (
                <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label className="text-[11px] font-mono text-white/30 uppercase tracking-widest">
                        CFG Guidance
                      </Label>
                      <span className="text-[11px] font-mono text-white/50">{cfgValue.toFixed(1)}</span>
                    </div>
                    <Controller
                      control={form.control}
                      name="cfg_value"
                      render={({ field: { value, onChange } }) => (
                        <Slider
                          min={1}
                          max={3}
                          step={0.1}
                          value={[value]}
                          onValueChange={(v) => onChange(v[0])}
                          className="py-1"
                        />
                      )}
                    />
                    <div className="flex justify-between text-[10px] text-white/20 mt-1">
                      <span>1.0 free</span>
                      <span>3.0 strict</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Controller
                      control={form.control}
                      name="do_normalize"
                      render={({ field }) => (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="border-white/20 data-[state=checked]:bg-violet-500 data-[state=checked]:border-violet-500"
                          />
                          <span className="text-xs text-white/50">Normalize loudness</span>
                        </label>
                      )}
                    />
                    {(mode === "controllable_cloning" || mode === "ultimate_cloning") && (
                      <Controller
                        control={form.control}
                        name="denoise"
                        render={({ field }) => (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              className="border-white/20 data-[state=checked]:bg-violet-500 data-[state=checked]:border-violet-500"
                            />
                            <span className="text-xs text-white/50">Denoise reference</span>
                          </label>
                        )}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Generate Button */}
            <div className="flex items-center gap-4 pt-2">
              <Button
                type="submit"
                size="lg"
                disabled={synthesize.isPending}
                className="px-10 font-mono tracking-wider bg-gradient-to-r from-violet-600 to-sky-600 hover:from-violet-500 hover:to-sky-500 border-0 text-white shadow-lg shadow-violet-500/20"
              >
                {synthesize.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    GENERATING...
                  </span>
                ) : (
                  "GENERATE"
                )}
              </Button>
              <div className="flex-1">
                <Waveform active={synthesize.isPending} />
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* RIGHT: HISTORY */}
      <div className="w-full md:w-[38%] bg-[#07070d] flex flex-col h-screen">
        <header className="px-6 py-5 border-b border-white/5 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-mono text-white/30 flex items-center gap-2 uppercase tracking-widest">
            <History className="h-3.5 w-3.5" />
            Session History
          </span>
          <Badge variant="outline" className="font-mono text-[10px] border-white/10 text-white/30">
            {history.length}
          </Badge>
        </header>

        <ScrollArea className="flex-1">
          <div className="p-5 space-y-5">
            {history.length === 0 ? (
              <div className="text-center py-24 text-white/20">
                <Activity className="h-7 w-7 mx-auto mb-3 opacity-30" />
                <p className="text-xs font-mono">No generations yet</p>
              </div>
            ) : (
              history.map((item) => {
                const modeCfg = MODE_CONFIG[item.mode];
                return (
                  <div key={item.id} className="rounded-xl border border-white/5 bg-white/2 p-4 space-y-3 group hover:border-white/10 transition-all">
                    <div className="flex items-center justify-between">
                      <Badge className={cn("text-[9px] font-mono border", modeCfg.color)}>
                        {modeCfg.label}
                      </Badge>
                      <span className="text-[10px] font-mono text-white/20">
                        {format(item.createdAt, "HH:mm:ss")}
                      </span>
                    </div>
                    <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">"{item.text}"</p>
                    <AudioPlayer
                      url={item.audioUrl}
                      filename={`voxcpm2-${format(item.createdAt, "HHmmss")}.wav`}
                    />
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function ReferenceAudioUpload({
  file,
  onFile,
  onDrop,
  inputRef,
  onBrowse,
  onChange,
  accentClass,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  onDrop: (e: React.DragEvent) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onBrowse: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  accentClass: string;
}) {
  return (
    <div>
      <Label className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-2 block">
        Reference Audio
      </Label>
      {file ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/80 truncate">{file.name}</p>
            <p className="text-[10px] text-white/30 font-mono mt-0.5">
              {(file.size / 1024).toFixed(0)} KB
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onFile(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="text-white/30 hover:text-white/70 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={onBrowse}
          className={cn(
            "flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed cursor-pointer transition-all bg-white/2 hover:bg-white/4",
            accentClass
          )}
        >
          <Upload className="h-5 w-5 text-white/30" />
          <div className="text-center">
            <p className="text-xs text-white/50">Drop audio file or click to browse</p>
            <p className="text-[10px] text-white/25 mt-0.5">WAV, MP3, FLAC, M4A</p>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onChange}
      />
    </div>
  );
}
