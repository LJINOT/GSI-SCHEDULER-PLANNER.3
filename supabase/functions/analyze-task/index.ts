import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Analysis = {
  duration: number;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  priority: "high" | "medium" | "low";
  corrected_description: string;
};

function extractJsonObject(text: string): unknown {
  if (!text) throw new Error("Empty AI content");
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

function normalizeAnalysis(
  raw: Record<string, unknown>,
  userCategory: string | undefined,
  originalDescription: string | undefined,
): Analysis {
  let duration = Number(raw.duration);
  if (!Number.isFinite(duration)) duration = 30;
  duration = Math.min(480, Math.max(5, Math.round(duration)));

  const diffRaw = String(raw.difficulty || "medium").toLowerCase();
  const difficulty = (["easy", "medium", "hard"].includes(diffRaw) ? diffRaw : "medium") as Analysis["difficulty"];

  const priRaw = String(raw.priority || "medium").toLowerCase();
  const priority = (["high", "medium", "low"].includes(priRaw) ? priRaw : "medium") as Analysis["priority"];

  let category = (userCategory && String(userCategory).trim())
    ? String(userCategory).trim()
    : String(raw.category || "General").trim();
  if (!category) category = "General";

  let corrected: string =
    typeof raw.corrected_description === "string" ? raw.corrected_description : (originalDescription || "");
  if (!originalDescription || !String(originalDescription).trim()) corrected = "";

  return { duration, difficulty, category, priority, corrected_description: corrected };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("analyze-task: function started");

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const title = body.title;
    const description = typeof body.description === "string" ? body.description : "";
    const category = typeof body.category === "string" ? body.category : undefined;

    console.log("analyze-task: request received", {
      hasTitle: !!title,
      hasDescription: !!description,
      hasCategory: !!category,
    });

    if (!title || typeof title !== "string" || !title.trim()) {
      return new Response(JSON.stringify({ error: "title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const AI_PROVIDER_KEY = Deno.env.get("LOVABLE_API_KEY");
    const AI_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
    console.log("analyze-task: LOVABLE_API_KEY configured:", Boolean(AI_PROVIDER_KEY));

    if (!AI_PROVIDER_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "AI provider key is not configured. Set LOVABLE_API_KEY (sk_…) in Supabase Edge Function secrets for this project.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `You are an AI task analyzer for the GSI Schedule Planner.
Analyze the given task and return ONLY valid JSON.
Required fields:
duration: integer from 5 to 480
difficulty: exactly one of easy, medium, hard
category: best-fit task category string
priority: exactly one of high, medium, low
corrected_description: lightly fix spelling/grammar; empty string if no description
If the user already selected a category, keep it.
Return ONLY the JSON object. No markdown.`;

    const userPrompt = `Title: ${title.trim()}
Description: ${description.trim() || "(none)"}
User-provided category: ${category?.trim() || "(none)"}`;

    console.log("analyze-task: calling AI gateway");
    const aiRes = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_PROVIDER_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    console.log("analyze-task: AI status:", aiRes.status);

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      console.error("analyze-task: AI gateway response:", aiRes.status, errText.slice(0, 500));
      if (aiRes.status === 401 || aiRes.status === 403) {
        return new Response(
          JSON.stringify({
            error:
              "AI provider authorization failed. LOVABLE_API_KEY must be a valid key starting with sk_.",
          }),
          { status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "AI rate limit reached. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ error: `AI gateway error (${aiRes.status}). Please try again.` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiRes.json();
    const message = aiJson?.choices?.[0]?.message;
    let parsed: Record<string, unknown> | null = null;

    const content = message?.content;
    if (typeof content === "string" && content.trim()) {
      try {
        parsed = extractJsonObject(content) as Record<string, unknown>;
      } catch (e) {
        console.error("analyze-task: content parse failed", String(e), String(content).slice(0, 300));
      }
    } else if (Array.isArray(content)) {
      const textPart = content.map((p: { text?: string }) => p.text || "").join("");
      try {
        if (textPart.trim()) parsed = extractJsonObject(textPart) as Record<string, unknown>;
      } catch { /* continue */ }
    }

    if (!parsed && message?.tool_calls?.[0]?.function?.arguments) {
      try {
        const args = message.tool_calls[0].function.arguments;
        parsed = typeof args === "string" ? JSON.parse(args) : args;
      } catch (e) {
        console.error("analyze-task: tool_calls parse failed", e);
      }
    }

    if (!parsed || typeof parsed !== "object") {
      console.error("analyze-task: no usable AI payload");
      return new Response(
        JSON.stringify({ error: "AI returned an invalid analysis. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = normalizeAnalysis(parsed, category, description);
    console.log("analyze-task: success", {
      duration: result.duration,
      difficulty: result.difficulty,
      category: result.category,
      priority: result.priority,
    });

    return new Response(
      JSON.stringify({
        ...result,
        algorithm: "llm:google/gemini-2.5-flash",
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("analyze-task error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || "AI analysis failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
