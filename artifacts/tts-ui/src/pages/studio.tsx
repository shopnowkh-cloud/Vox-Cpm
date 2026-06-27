import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { Mic2, Settings2, History, Activity, PlaySquare } from "lucide-react";

import { useGetTtsModels } from "@workspace/api-client-react";
import { useSynthesizeAudio, type AudioHistoryItem } from "@/hooks/use-tts";
import { Waveform } from "@/components/waveform";
import { AudioPlayer } from "@/components/audio-player";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  text: z.string().min(1, "Text is required").max(2000, "Text is too long"),
  lang: z.string().min(1, "Language is required"),
  speed: z.number().min(0.5).max(2.0),
});

type FormValues = z.infer<typeof formSchema>;

export default function Studio() {
  const { toast } = useToast();
  const [history, setHistory] = useState<AudioHistoryItem[]>([]);
  
  const { data: modelsData, isLoading: isLoadingModels } = useGetTtsModels();
  const synthesize = useSynthesizeAudio();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      text: "",
      lang: "EN",
      speed: 1.0,
    },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      const audioUrl = await synthesize.mutateAsync({
        text: values.text,
        lang: values.lang,
        speed: values.speed,
      });

      const newItem: AudioHistoryItem = {
        id: crypto.randomUUID(),
        text: values.text,
        lang: values.lang,
        speed: values.speed,
        audioUrl,
        createdAt: new Date(),
      };

      setHistory((prev) => [newItem, ...prev]);
      
      toast({
        title: "Synthesis Complete",
        description: "Your audio is ready for playback.",
      });
    } catch (error) {
      toast({
        title: "Synthesis Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    }
  };

  // Get flat list of languages from the models
  const languages = modelsData?.models.flatMap((m) => m.languages) || [];
  const uniqueLanguages = Array.from(new Map(languages.map((l) => [l.code, l])).values());

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row overflow-hidden">
      {/* LEFT PANEL: STUDIO CONTROLS */}
      <div className="w-full md:w-[60%] lg:w-[65%] border-r border-border p-6 md:p-10 flex flex-col h-screen overflow-y-auto">
        <header className="mb-10 flex items-center gap-3">
          <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center border border-primary/30">
            <Mic2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
              Vox Studio
            </h1>
            <p className="text-sm text-muted-foreground font-mono">
              TTS Synthesizer // v1.0
            </p>
          </div>
        </header>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 flex-1 flex flex-col">
            <FormField
              control={form.control}
              name="text"
              render={({ field }) => (
                <FormItem className="flex-1 flex flex-col min-h-[300px]">
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-sm font-mono text-muted-foreground flex items-center gap-2">
                      <PlaySquare className="h-4 w-4" />
                      INPUT SCRIPT
                    </FormLabel>
                    <span className="text-xs text-muted-foreground font-mono">
                      {field.value.length} / 2000
                    </span>
                  </div>
                  <FormControl>
                    <Textarea
                      placeholder="Enter script to synthesize..."
                      className="flex-1 resize-none bg-card border-card-border font-sans text-lg p-6 focus-visible:ring-primary shadow-inner"
                      {...field}
                      data-testid="input-tts-text"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-card border border-card-border p-6 rounded-lg">
              <FormField
                control={form.control}
                name="lang"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-mono text-muted-foreground flex items-center gap-2">
                      <Settings2 className="h-4 w-4" />
                      LANGUAGE
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoadingModels}>
                      <FormControl>
                        <SelectTrigger className="bg-background border-border" data-testid="select-language">
                          <SelectValue placeholder="Select a language" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {uniqueLanguages.map((lang) => (
                          <SelectItem key={lang.code} value={lang.code} data-testid={`select-language-${lang.code}`}>
                            {lang.label} ({lang.code})
                          </SelectItem>
                        ))}
                        {uniqueLanguages.length === 0 && (
                          <SelectItem value="EN" data-testid="select-language-EN-fallback">English (EN)</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="speed"
                render={({ field: { value, onChange } }) => (
                  <FormItem>
                    <div className="flex justify-between items-center mb-4">
                      <FormLabel className="text-sm font-mono text-muted-foreground flex items-center gap-2">
                        <Activity className="h-4 w-4" />
                        SPEED
                      </FormLabel>
                      <span className="font-mono text-primary bg-primary/10 px-2 py-1 rounded text-xs">
                        {value.toFixed(1)}x
                      </span>
                    </div>
                    <FormControl>
                      <Slider
                        min={0.5}
                        max={2.0}
                        step={0.1}
                        value={[value]}
                        onValueChange={(vals) => onChange(vals[0])}
                        className="py-2"
                        data-testid="slider-speed"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex items-center gap-6 pt-4">
              <Button
                type="submit"
                size="lg"
                className="w-48 font-mono tracking-wider"
                disabled={synthesize.isPending || !form.formState.isValid}
                data-testid="button-synthesize"
              >
                {synthesize.isPending ? "SYNTHESIZING..." : "GENERATE AUDIO"}
              </Button>
              <div className="flex-1">
                <Waveform active={synthesize.isPending} />
              </div>
            </div>
          </form>
        </Form>
      </div>

      {/* RIGHT PANEL: SESSION HISTORY */}
      <div className="w-full md:w-[40%] lg:w-[35%] bg-card flex flex-col h-screen">
        <header className="p-6 border-b border-card-border flex items-center justify-between">
          <h2 className="text-sm font-mono text-muted-foreground flex items-center gap-2">
            <History className="h-4 w-4" />
            SESSION HISTORY
          </h2>
          <Badge variant="outline" className="font-mono bg-background">
            {history.length} ITEMS
          </Badge>
        </header>

        <ScrollArea className="flex-1 p-6">
          <div className="space-y-6">
            {history.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground border-2 border-dashed border-card-border rounded-lg">
                <Activity className="h-8 w-8 mx-auto mb-3 opacity-20" />
                <p className="font-mono text-sm">No audio generated yet</p>
                <p className="text-xs mt-1 opacity-50">Generate speech to start your session</p>
              </div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="group relative" data-testid={`history-item-${item.id}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex gap-2">
                      <Badge variant="secondary" className="font-mono text-[10px] text-primary bg-primary/10 border-primary/20">
                        {item.lang}
                      </Badge>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {item.speed.toFixed(1)}x
                      </Badge>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {format(item.createdAt, "HH:mm:ss")}
                    </span>
                  </div>
                  
                  <div className="text-sm text-foreground/90 line-clamp-2 mb-3 leading-relaxed">
                    "{item.text}"
                  </div>
                  
                  <AudioPlayer 
                    url={item.audioUrl} 
                    filename={`vox-${item.lang}-${format(item.createdAt, "HHmmss")}.wav`} 
                  />
                  
                  <div className="absolute -left-2 top-0 bottom-0 w-0.5 bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
