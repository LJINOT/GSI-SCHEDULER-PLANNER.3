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
  // Strip markdown fences if present
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  // Prefer first {...} block
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}

function normalizeAnalysis(
  raw: Record<string, unknown>,
  userCategory: string | undefined,
  originalDescription: string | undefined,
): Analysis {
  let duration = Number(raw.duration);
  if (!Number.isFinite(duration)) duration = 30;
  duration = Math.round(duration);
  duration = Math.min(480, Math.max(5, duration));

  const diffRaw = String(raw.difficulty || "medium").toLowerCase();
  const difficulty = (["easy", "medium", "hard"].includes(diffRaw)
    ? diffRaw
    : "medium") as Analysis["difficulty"];

  const priRaw = String(raw.priority || "medium").toLowerCase();
  const priority = (["high", "medium", "low"].includes(priRaw)
    ? priRaw
    : "medium") as Analysis["priority"];

  // Always preserve user-selected category when provided
  let category = (userCategory && String(userCategory).trim())
    ? String(userCategory).trim()
    : String(raw.category || "General").trim();
  if (!category) category = "General";

  let corrected = raw.corrected_description;
  if (typeof corrected !== "string") {
    corrected = originalDescription || "";
  }
  if (!originalDescription || !String(originalDescription).trim()) {
    corrected = "";
  }

  return {
    duration,
    difficulty,
    category,
    priority,
    corrected_description: corrected as string,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    if (!title || typeof title !== "string" || !title.trim()) {
      return new Response(JSON.stringify({ error: "title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const AI_PROVIDER_KEY = Deno.env.get("LOVABLE_API_KEY");
    const AI_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
    if (!AI_PROVIDER_KEY) {
      return new Response(
        JSON.stringify({ error: "AI provider key is not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `You are an AI task analyzer for the GSI Schedule Planner.
Analyze the given task and return ONLY valid JSON.
Required fields:
duration: Estimated minutes to complete the task. Must be an integer from 5 to 480.
difficulty: Must be exactly one of: easy, medium, hard
category: Best-fit task category string.
priority: Must be exactly one of: high, medium, low
corrected_description: Lightly correct spelling and grammar while preserving the user's meaning and writing style. If no description was provided, return an empty string.
If the user already selected a category, keep the user's selected category.
Do not return Markdown.
Do not return an explanation.
Return ONLY the JSON object.`;

    const userPrompt = `Title: ${title.trim()}
Description: ${description.trim() ? description : "(none)"}
User-provided category: ${category?.trim() ? category : "(none)"}`;

    // Request plain JSON content (not tool_calls) for reliability
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

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      console.error("AI gateway error", aiRes.status, errText.slice(0, 500));
      if (aiRes.status === 401 || aiRes.status === 403) {
        return new Response(
          JSON.stringify({ error: "AI provider authorization failed. Check LOVABLE_API_KEY." }),
          { status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI rate limit reached. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: `AI gateway error (${aiRes.status}). Please try again.` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiRes.json();
    const message = aiJson?.choices?.[0]?.message;

    // Prefer message.content JSON; fall back to tool_calls for older gateway behavior
    let parsed: Record<string, unknown> | null = null;

    const content = message?.content;
    if (typeof content === "string" && content.trim()) {
      try {
        parsed = extractJsonObject(content) as Record<string, unknown>;
      } catch (e) {
        console.error("Failed to parse content JSON", e, content.slice(0, 300));
      }
    } else if (Array.isArray(content)) {
      // Some models return content parts
      const textPart = content.map((p: { text?: string; type?: string }) => p.text || "").join("");
      if (textPart.trim()) {
        try {
          parsed = extractJsonObject(textPart) as Record<string, unknown>;
        } catch { /* continue */ }
      }
    }

    if (!parsed && message?.tool_calls?.[0]?.function?.arguments) {
      try {
        const args = message.tool_calls[0].function.arguments;
        parsed = typeof args === "string" ? JSON.parse(args) : args;
      } catch (e) {
        console.error("Failed to parse tool_calls arguments", e);
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return new Response(
        JSON.stringify({ error: "AI returned an invalid analysis. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = normalizeAnalysis(parsed, category, description);

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
    return new Response(
      JSON.stringify({ error: (e as Error).message || "AI analysis failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
