import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function PersonalizationPage() {
  const [peakStart, setPeakStart] = useState("09:00");
  const [peakEnd, setPeakEnd] = useState("12:00");
  const [breakStyle, setBreakStyle] = useState("pomodoro");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted personalization on mount
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoaded(true); return; }
      const { data } = await supabase.from("profiles")
        .select("peak_start, peak_end, break_style")
        .eq("id", user.id).single();
      if (data) {
        if (data.peak_start) setPeakStart(data.peak_start);
        if (data.peak_end) setPeakEnd(data.peak_end);
        if (data.break_style) setBreakStyle(data.break_style);
      }
      setLoaded(true);
    })();
  }, []);

  // Auto-save (debounced) whenever fields change after initial load
  useEffect(() => {
    if (!loaded) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        peak_start: peakStart,
        peak_end: peakEnd,
        break_style: breakStyle,
      });
      setSaving(false);
      if (error) toast.error(error.message);
      else setSavedAt(Date.now());
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [peakStart, peakEnd, breakStyle, loaded]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Personalization</h1>
          <p className="text-muted-foreground">Customize how the AI adapts your schedule. Changes save automatically.</p>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-2 shrink-0">
          {saving ? (<><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>)
            : savedAt ? (<><CheckCircle2 className="h-3 w-3 text-success" /> Saved</>)
            : null}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Preferred Working Times</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Peak Start</Label>
              <Input type="time" value={peakStart} onChange={(e) => setPeakStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Peak End</Label>
              <Input type="time" value={peakEnd} onChange={(e) => setPeakEnd(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Adaptive scheduling will place high-difficulty tasks inside this window. Used as fallback when behavioral data is sparse.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Break Style</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Select value={breakStyle} onValueChange={setBreakStyle}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pomodoro">Preference: Pomodoro rhythm (preference only)</SelectItem>
              <SelectItem value="long-focus">Preference: Long Focus rhythm (preference only)</SelectItem>
              <SelectItem value="flexible">Preference: Flexible (preference only)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">
            Scheduling always keeps fixed breaks: <strong>9:00 AM Snack</strong>, <strong>12:00 PM Lunch</strong>, and <strong>3:00 PM Snack</strong>.
            Break style is a personal preference label and does not move those fixed breaks.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-6 text-center text-muted-foreground">
          <p className="text-sm">These preferences feed directly into the PSO + AHP scheduler and Smart Suggestions.</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
