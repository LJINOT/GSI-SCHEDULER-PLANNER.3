import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { title, description, category } = await req.json();
    if (!title || typeof title !== "string") {
      return new Response(JSON.stringify({ error: "title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI provider key (system-managed backend secret)
    const AI_PROVIDER_KEY = Deno.env.get("LOVABLE_API_KEY");
    const AI_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
    if (!AI_PROVIDER_KEY) {
      return new Response(JSON.stringify({ error: "AI provider key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an AI task analyzer for a student/professional productivity app.
Analyze the given task and return structured metadata.

Rules:
- duration: estimated minutes to complete (integer, 5-480)
- difficulty: one of "easy" | "medium" | "hard"
- category: best-fit category string (e.g. Assignment, Exam Review, Project, Research, Reading, Lab Work, Presentation, Personal, Health, Errands, Chores, Social, Finance, Fitness, Office Work, Meeting, Construction, Field Work, Freelancing, Virtual Assistant, Client Communication, Email Management, Content Creation, Graphic Design, Video Editing, Data Entry, Bookkeeping, Invoicing, Customer Support, Lead Generation, Transcription, Translation, SEO Optimization, Website Maintenance, Proposal Writing, Meeting Notes, General)
- priority: one of "high" | "medium" | "low"
- corrected_description: the description with spelling/grammar typos lightly corrected (preserve user voice). If no description was given, return an empty string.

If the user already provided a category, keep it.`;

    const userPrompt = `Title: ${title}
Description: ${description || "(none)"}
User-provided category: ${category || "(none)"}`;

    const aiRes = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_PROVIDER_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_task_analysis",
              description: "Return structured task analysis",
              parameters: {
                type: "object",
                properties: {
                  duration: { type: "integer", minimum: 5, maximum: 480 },
                  difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
                  category: { type: "string" },
                  priority: { type: "string", enum: ["high", "medium", "low"] },
                  corrected_description: { type: "string" },
                },
                required: ["duration", "difficulty", "category", "priority", "corrected_description"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_task_analysis" } },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
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
      throw new Error(`AI gateway error ${aiRes.status}: ${errText}`);
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return tool call");
    }
    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({
        duration: parsed.duration,
        difficulty: parsed.difficulty,
        category: parsed.category,
        priority: parsed.priority,
        corrected_description: parsed.corrected_description ?? (description || ""),
        algorithm: "llm:google/gemini-2.5-flash",
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("analyze-task error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
