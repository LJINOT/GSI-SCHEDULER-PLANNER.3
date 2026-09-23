import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * GSI Schedule Planner
 * Analyze Task - Google AI Studio Gemini
 *
 * Required Supabase secret:
 * GEMINI_API_KEY
 *
 * This function does NOT use Lovable AI or OpenAI.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
  "Content-Type": "application/json",
};

type Analysis = {
  duration: number;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  priority: "high" | "medium" | "low";
  corrected_description: string;
};

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: corsHeaders,
  });
}

function extractJsonObject(text: string): unknown {
  if (!text || !text.trim()) {
    throw new Error("Gemini returned empty content.");
  }

  let value = text.trim();

  // Remove markdown code fences.
  value = value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      `No JSON object found in Gemini response: ${value.slice(0, 500)}`,
    );
  }

  value = value.slice(start, end + 1);

  return JSON.parse(value);
}

function normalizeAnalysis(
  raw: Record<string, unknown>,
  userCategory?: string,
  originalDescription?: string,
): Analysis {
  let duration = Number(raw.duration);

  if (!Number.isFinite(duration)) {
    duration = 30;
  }

  duration = Math.round(duration);
  duration = Math.min(480, Math.max(5, duration));

  const difficultyValue = String(
    raw.difficulty || "medium",
  )
    .toLowerCase()
    .trim();

  const difficulty = (
    ["easy", "medium", "hard"].includes(difficultyValue)
      ? difficultyValue
      : "medium"
  ) as Analysis["difficulty"];

  const priorityValue = String(
    raw.priority || "medium",
  )
    .toLowerCase()
    .trim();

  const priority = (
    ["high", "medium", "low"].includes(priorityValue)
      ? priorityValue
      : "medium"
  ) as Analysis["priority"];

  let category = "";

  // User-selected category always takes priority.
  if (userCategory && userCategory.trim()) {
    category = userCategory.trim();
  } else {
    category = String(raw.category || "General").trim();
  }

  if (!category) {
    category = "General";
  }

  let correctedDescription = "";

  if (typeof raw.corrected_description === "string") {
    correctedDescription = raw.corrected_description;
  } else {
    correctedDescription = originalDescription || "";
  }

  if (!originalDescription || !originalDescription.trim()) {
    correctedDescription = "";
  }

  return {
    duration,
    difficulty,
    category,
    priority,
    corrected_description: correctedDescription,
  };
}

function getGeminiError(text: string): string {
  if (!text) {
    return "Gemini returned no error details.";
  }

  try {
    const parsed = JSON.parse(text);

    if (
      parsed?.error?.message &&
      typeof parsed.error.message === "string"
    ) {
      return parsed.error.message;
    }

    return JSON.stringify(parsed).slice(0, 1000);
  } catch {
    return text.slice(0, 1000);
  }
}

serve(async (req) => {
  console.log("=================================");
  console.log("ANALYZE-TASK START");
  console.log("=================================");

  // ------------------------------------
  // CORS
  // ------------------------------------

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // ------------------------------------
  // Only POST
  // ------------------------------------

  if (req.method !== "POST") {
    return jsonResponse({
      ok: false,
      error: "Only POST requests are allowed.",
    });
  }

  try {
    // ------------------------------------
    // Read body
    // ------------------------------------

    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      console.error("Invalid JSON request.");

      return jsonResponse({
        ok: false,
        error: "Invalid JSON request body.",
      });
    }

    const title =
      typeof body.title === "string"
        ? body.title.trim()
        : "";

    const description =
      typeof body.description === "string"
        ? body.description
        : "";

    const category =
      typeof body.category === "string"
        ? body.category
        : undefined;

    console.log("Title:", title);
    console.log(
      "Description:",
      description ? "provided" : "none",
    );
    console.log(
      "Category:",
      category || "none",
    );

    // ------------------------------------
    // Validate title
    // ------------------------------------

    if (!title) {
      return jsonResponse({
        ok: false,
        error: "Task title is required.",
      });
    }

    // ------------------------------------
    // Gemini key
    // ------------------------------------

    const GEMINI_API_KEY =
      Deno.env.get("GEMINI_API_KEY");

    console.log(
      "GEMINI_API_KEY exists:",
      Boolean(GEMINI_API_KEY),
    );

    if (!GEMINI_API_KEY) {
      console.error(
        "GEMINI_API_KEY IS MISSING.",
      );

      return jsonResponse({
        ok: false,
        error:
          "GEMINI_API_KEY is missing from Supabase Edge Function secrets.",
      });
    }

    // ------------------------------------
    // Prompt
    // ------------------------------------

    const prompt = `
You are the AI task analyzer for the GSI Schedule Planner.

Analyze this task and return ONLY valid JSON.

Required JSON format:

{
  "duration": 30,
  "difficulty": "medium",
  "category": "School",
  "priority": "medium",
  "corrected_description": ""
}

Rules:

duration:
- integer
- minimum 5
- maximum 480

difficulty:
- exactly "easy", "medium", or "hard"

priority:
- exactly "high", "medium", or "low"

category:
- choose the best category
- if the user already selected a category, keep it exactly

corrected_description:
- lightly correct spelling and grammar
- preserve the user's meaning
- if there is no description, return ""

Do not return Markdown.
Do not return explanations.
Do not return code fences.
Return ONLY the JSON object.

TASK TITLE:
${title}

TASK DESCRIPTION:
${description.trim() || "(none)"}

USER SELECTED CATEGORY:
${category?.trim() || "(none)"}
`;

    // ------------------------------------
    // Models
    // ------------------------------------

    const models = [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
    ];

    let geminiData: Record<string, unknown> | null = null;
    let lastStatus = 0;
    let lastError = "";

    // ------------------------------------
    // Call Gemini
    // ------------------------------------

    for (const model of models) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          GEMINI_API_KEY,
        )}`;

      console.log(
        "Calling Gemini:",
        model,
      );

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json",
            },
          }),
        });

        lastStatus = response.status;

        const responseText =
          await response.text();

        console.log(
          "Gemini HTTP status:",
          response.status,
        );

        if (!response.ok) {
          lastError =
            getGeminiError(responseText);

          console.error(
            "Gemini ERROR:",
            lastError,
          );

          // Only try another model when
          // the model itself is unavailable.
          if (response.status === 404) {
            continue;
          }

          break;
        }

        try {
          geminiData =
            JSON.parse(responseText);

          console.log(
            "Gemini response parsed.",
          );

          break;
        } catch (error) {
          console.error(
            "Could not parse Gemini response:",
            error,
          );

          lastError =
            "Gemini returned invalid JSON.";
        }
      } catch (error) {
        console.error(
          "Network error calling Gemini:",
          error,
        );

        lastError =
          error instanceof Error
            ? error.message
            : "Network error calling Gemini.";

        lastStatus = 500;

        break;
      }
    }

    // ------------------------------------
    // Gemini failed
    //
    // IMPORTANT:
    // We return HTTP 200 intentionally.
    //
    // This prevents Supabase JS from hiding
    // the actual error behind:
    //
    // "Edge Function returned a non-2xx
    // status code"
    // ------------------------------------

    if (!geminiData) {
      console.error(
        "GEMINI FAILED",
      );

      console.error(
        "Status:",
        lastStatus,
      );

      console.error(
        "Error:",
        lastError,
      );

      return jsonResponse({
        ok: false,
        error:
          `Gemini API failed (${lastStatus || 500}).`,
        details:
          lastError ||
          "No error details were returned.",
        gemini_status:
          lastStatus || 500,
      });
    }

    // ------------------------------------
    // Extract Gemini candidates
    // ------------------------------------

    const candidates =
      Array.isArray(geminiData.candidates)
        ? geminiData.candidates
        : [];

    if (!candidates.length) {
      console.error(
        "Gemini returned no candidates.",
      );

      console.error(
        JSON.stringify(geminiData).slice(
          0,
          3000,
        ),
      );

      return jsonResponse({
        ok: false,
        error:
          "Gemini returned no analysis.",
        details:
          "The Gemini response contained no candidates.",
      });
    }

    const firstCandidate =
      candidates[0] as {
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
        finishReason?: string;
      };

    const parts =
      firstCandidate?.content?.parts || [];

    const content = parts
      .map((part) =>
        typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("")
      .trim();

    console.log(
      "Gemini finish reason:",
      firstCandidate?.finishReason ||
        "unknown",
    );

    console.log(
      "Gemini content:",
      content.slice(0, 1000),
    );

    // ------------------------------------
    // Empty content
    // ------------------------------------

    if (!content) {
      return jsonResponse({
        ok: false,
        error:
          "Gemini returned empty content.",
        details:
          `Finish reason: ${
            firstCandidate?.finishReason ||
            "unknown"
          }`,
      });
    }

    // ------------------------------------
    // Parse AI JSON
    // ------------------------------------

    let parsed: Record<string, unknown>;

    try {
      parsed =
        extractJsonObject(content) as Record<
          string,
          unknown
        >;
    } catch (error) {
      console.error(
        "AI JSON parsing failed:",
        error,
      );

      return jsonResponse({
        ok: false,
        error:
          "Gemini returned an invalid task analysis.",
        details:
          error instanceof Error
            ? error.message
            : "Invalid JSON.",
        raw:
          content.slice(0, 500),
      });
    }

    // ------------------------------------
    // Normalize
    // ------------------------------------

    const result =
      normalizeAnalysis(
        parsed,
        category,
        description,
      );

    console.log(
      "=================================",
    );
    console.log(
      "ANALYZE-TASK SUCCESS",
    );
    console.log(
      result,
    );
    console.log(
      "=================================",
    );

    // ------------------------------------
    // SUCCESS
    // ------------------------------------

    return jsonResponse({
      ok: true,
      ...result,
      algorithm:
        "llm:google-gemini",
      timestamp:
        new Date().toISOString(),
    });
  } catch (error) {
    // ------------------------------------
    // Unexpected error
    // ------------------------------------

    console.error(
      "UNEXPECTED ANALYZE-TASK ERROR:",
      error,
    );

    return jsonResponse({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "AI analysis failed.",
    });
  }
});
