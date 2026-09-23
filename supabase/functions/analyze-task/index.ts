import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Analyze Task — Google AI Studio (Gemini API)
 * Secret (Supabase Edge Function secrets only):
 *   GEMINI_API_KEY=<key from https://aistudio.google.com/apikey>
 *
 * Does NOT use Lovable or OpenAI.
 */

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
  const difficulty = (["easy", "medium", "hard"].includes(diffRaw)
    ? diffRaw
    : "medium") as Analysis["difficulty"];

  const priRaw = String(raw.priority || "medium").toLowerCase();
  const priority = (["high", "medium", "low"].includes(priRaw)
    ? priRaw
    : "medium") as Analysis["priority"];

  let category =
    userCategory && String(userCategory).trim()
      ? String(userCategory).trim()
      : String(raw.category || "General").trim();
  if (!category) category = "General";

  let corrected =
    typeof raw.corrected_description === "string"
      ? raw.corrected_description
      : originalDescription || "";
  if (!originalDescription || !String(originalDescription).trim()) corrected = "";

  return { duration, difficulty, category, priority, corrected_description: corrected };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("analyze-task: started (Google AI Studio / Gemini)");

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

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    console.log("analyze-task: GEMINI_API_KEY configured:", Boolean(GEMINI_API_KEY));

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "Gemini API key is not configured. Set GEMINI_API_KEY in Supabase Edge Function secrets (from Google AI Studio).",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Prefer a widely available flash model; fall back list if one is unavailable
    const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];

    const systemPrompt = `You are an AI task analyzer for the GSI Schedule Planner.
Analyze the given task and return ONLY valid JSON with these fields:
- duration: integer minutes from 5 to 480
- difficulty: exactly one of "easy", "medium", "hard"
- category: best-fit category string
- priority: exactly one of "high", "medium", "low"
- corrected_description: lightly fix spelling/grammar; empty string if no description was provided
If the user already selected a category, keep that category.
No markdown. No explanation. ONLY the JSON object.`;

    const userPrompt = `Title: ${title.trim()}
Description: ${description.trim() || "(none)"}
User-provided category: ${category?.trim() || "(none)"}`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    };

    let lastStatus = 0;
    let lastErr = "";
    let aiJson: Record<string, unknown> | null = null;

    for (const model of models) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

      console.log("analyze-task: calling Gemini model:", model);
      const aiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      lastStatus = aiRes.status;
      const text = await aiRes.text();
      console.log("analyze-task: Gemini status:", model, aiRes.status);

      if (!aiRes.ok) {
        lastErr = text.slice(0, 400);
        console.error("analyze-task: Gemini error:", model, lastErr);
        // Try next model on 404 (model not found)
        if (aiRes.status === 404) continue;
        break;
      }

      try {
        aiJson = JSON.parse(text) as Record<string, unknown>;
      } catch {
        lastErr = "Invalid JSON from Gemini";
        continue;
      }
      break;
    }

    if (!aiJson) {
      if (lastStatus === 400 || lastStatus === 401 || lastStatus === 403) {
        return new Response(
          JSON.stringify({
            error:
              "Gemini authorization failed. Check that GEMINI_API_KEY from Google AI Studio is valid.",
          }),
          { status: lastStatus || 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (lastStatus === 429) {
        return new Response(
          JSON.stringify({ error: "Gemini rate limit reached. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          error: `Gemini API error (${lastStatus || 500}). Please try again.`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Extract text from Gemini response
    const candidates = aiJson.candidates as Array<{
      content?: { parts?: Array<{ text?: string }> };
    }> | undefined;
    const content =
      candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    if (!content.trim()) {
      console.error("analyze-task: empty Gemini content", JSON.stringify(aiJson).slice(0, 300));
      return new Response(
        JSON.stringify({ error: "AI returned an invalid analysis. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonObject(content) as Record<string, unknown>;
    } catch (e) {
      console.error("analyze-task: JSON parse failed", e, content.slice(0, 300));
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
        algorithm: "llm:google/gemini-flash",
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
