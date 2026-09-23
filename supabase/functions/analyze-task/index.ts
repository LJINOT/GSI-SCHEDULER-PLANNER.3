import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * GSI Schedule Planner
 * Analyze Task — Google AI Studio / Gemini API
 *
 * Required Supabase Edge Function Secret:
 *
 * GEMINI_API_KEY
 *
 * Get the key from:
 * Google AI Studio
 *
 * This function does NOT use:
 * - Lovable AI
 * - OpenAI
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Analysis = {
  duration: number;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  priority: "high" | "medium" | "low";
  corrected_description: string;
};

/**
 * Extract a JSON object from Gemini's response.
 *
 * Handles:
 * {
 *   ...
 * }
 *
 * and:
 *
 * ```json
 * {
 *   ...
 * }
 * ```
 */
function extractJsonObject(text: string): unknown {
  if (!text || !text.trim()) {
    throw new Error("Gemini returned empty content.");
  }

  let cleaned = text.trim();

  // Remove Markdown code fences if Gemini adds them.
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object was found in Gemini response.");
  }

  cleaned = cleaned.slice(start, end + 1);

  return JSON.parse(cleaned);
}

/**
 * Normalize Gemini output so the frontend always receives
 * the exact structure expected by AddTask.tsx.
 */
function normalizeAnalysis(
  raw: Record<string, unknown>,
  userCategory: string | undefined,
  originalDescription: string | undefined,
): Analysis {
  // -----------------------------
  // Duration
  // -----------------------------
  let duration = Number(raw.duration);

  if (!Number.isFinite(duration)) {
    duration = 30;
  }

  duration = Math.round(duration);

  // Minimum 5 minutes
  // Maximum 480 minutes
  duration = Math.min(480, Math.max(5, duration));

  // -----------------------------
  // Difficulty
  // -----------------------------
  const difficultyRaw = String(
    raw.difficulty || "medium",
  ).toLowerCase().trim();

  const difficulty = (
    ["easy", "medium", "hard"].includes(difficultyRaw)
      ? difficultyRaw
      : "medium"
  ) as Analysis["difficulty"];

  // -----------------------------
  // Priority
  // -----------------------------
  const priorityRaw = String(
    raw.priority || "medium",
  ).toLowerCase().trim();

  const priority = (
    ["high", "medium", "low"].includes(priorityRaw)
      ? priorityRaw
      : "medium"
  ) as Analysis["priority"];

  // -----------------------------
  // Category
  // -----------------------------
  let category = "";

  if (userCategory && userCategory.trim()) {
    // User-selected category always wins.
    category = userCategory.trim();
  } else {
    category = String(raw.category || "General").trim();
  }

  if (!category) {
    category = "General";
  }

  // -----------------------------
  // Corrected description
  // -----------------------------
  let correctedDescription = "";

  if (typeof raw.corrected_description === "string") {
    correctedDescription = raw.corrected_description;
  } else {
    correctedDescription = originalDescription || "";
  }

  // If there was no original description,
  // always return an empty string.
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

/**
 * Extract the useful error message from Gemini.
 */
function extractGeminiError(responseText: string): string {
  if (!responseText) {
    return "No error details were returned by Gemini.";
  }

  try {
    const parsed = JSON.parse(responseText);

    const message = parsed?.error?.message;

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }

    return JSON.stringify(parsed).slice(0, 1000);
  } catch {
    return responseText.slice(0, 1000);
  }
}

serve(async (req) => {
  // -----------------------------------------
  // CORS
  // -----------------------------------------
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed. Use POST.",
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  console.log("========================================");
  console.log("analyze-task: STARTED");
  console.log("Provider: Google AI Studio / Gemini");
  console.log("========================================");

  try {
    // -----------------------------------------
    // Read request body
    // -----------------------------------------
    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch (error) {
      console.error("analyze-task: Invalid request JSON", error);

      return new Response(
        JSON.stringify({
          error: "Invalid JSON request body.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
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

    console.log("analyze-task: title received:", title);
    console.log(
      "analyze-task: description provided:",
      Boolean(description.trim()),
    );
    console.log(
      "analyze-task: category:",
      category || "(none)",
    );

    // -----------------------------------------
    // Validate title
    // -----------------------------------------
    if (!title) {
      return new Response(
        JSON.stringify({
          error: "Task title is required.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // -----------------------------------------
    // Get Gemini API key
    // -----------------------------------------
    const GEMINI_API_KEY =
      Deno.env.get("GEMINI_API_KEY");

    console.log(
      "analyze-task: GEMINI_API_KEY configured:",
      Boolean(GEMINI_API_KEY),
    );

    if (!GEMINI_API_KEY) {
      console.error(
        "analyze-task: GEMINI_API_KEY is missing.",
      );

      return new Response(
        JSON.stringify({
          error:
            "Gemini API key is not configured. Please add GEMINI_API_KEY to Supabase Edge Function secrets.",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // -----------------------------------------
    // Gemini models
    // -----------------------------------------
    //
    // The function tries the first model.
    //
    // If Gemini returns 404, it tries the next model.
    //
    // Other errors stop immediately because they
    // usually indicate an API key, quota, request,
    // or permission problem.
    //
    const models = [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
    ];

    // -----------------------------------------
    // AI instructions
    // -----------------------------------------
    const systemPrompt = `
You are an AI task analyzer for the GSI Schedule Planner.

Analyze the task and return ONLY one valid JSON object.

The JSON object MUST contain exactly these fields:

{
  "duration": number,
  "difficulty": "easy" | "medium" | "hard",
  "category": string,
  "priority": "high" | "medium" | "low",
  "corrected_description": string
}

Rules:

1. duration
- Estimate the number of minutes needed to complete the task.
- Must be an integer.
- Minimum: 5.
- Maximum: 480.

2. difficulty
- Must be exactly:
  "easy"
  "medium"
  or
  "hard"

3. category
- Choose a suitable category based on the task.
- If the user already selected a category, KEEP the user's selected category.

4. priority
- Must be exactly:
  "high"
  "medium"
  or
  "low"

5. corrected_description
- Lightly correct spelling and grammar.
- Preserve the user's original meaning.
- Do not rewrite unnecessarily.
- If there is no description, return an empty string.

IMPORTANT:
- Return ONLY JSON.
- Do not use Markdown.
- Do not use code fences.
- Do not provide an explanation.
- Do not add extra fields.
`;

    const userPrompt = `
Task title:
${title}

Task description:
${description.trim() || "(none)"}

User-selected category:
${category?.trim() || "(none)"}
`;

    // -----------------------------------------
    // Gemini request body
    // -----------------------------------------
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${systemPrompt}\n\n${userPrompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    };

    let aiJson: Record<string, unknown> | null = null;
    let lastStatus = 0;
    let lastError = "";

    // -----------------------------------------
    // Call Gemini
    // -----------------------------------------
    for (const model of models) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          GEMINI_API_KEY,
        )}`;

      console.log(
        "analyze-task: Calling Gemini model:",
        model,
      );

      let aiRes: Response;

      try {
        aiRes = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
      } catch (networkError) {
        console.error(
          "analyze-task: Gemini network error:",
          networkError,
        );

        lastStatus = 500;
        lastError =
          networkError instanceof Error
            ? networkError.message
            : "Unable to connect to Gemini.";

        break;
      }

      lastStatus = aiRes.status;

      const responseText = await aiRes.text();

      console.log(
        "analyze-task: Gemini HTTP status:",
        model,
        aiRes.status,
      );

      // -----------------------------------------
      // Gemini returned an error
      // -----------------------------------------
      if (!aiRes.ok) {
        const geminiError =
          extractGeminiError(responseText);

        lastError = geminiError;

        console.error(
          "analyze-task: Gemini API error:",
          {
            model,
            status: aiRes.status,
            error: geminiError,
          },
        );

        // Try another model only if this model
        // does not exist.
        if (aiRes.status === 404) {
          console.log(
            "analyze-task: Model unavailable, trying next model.",
          );

          continue;
        }

        // Stop for authentication,
        // quota, permission, bad request, etc.
        break;
      }

      // -----------------------------------------
      // Parse Gemini response
      // -----------------------------------------
      try {
        aiJson =
          JSON.parse(responseText) as Record<
            string,
            unknown
          >;

        console.log(
          "analyze-task: Gemini response received successfully.",
        );

        break;
      } catch (parseError) {
        console.error(
          "analyze-task: Could not parse Gemini HTTP response.",
          parseError,
        );

        lastError =
          "Gemini returned an invalid JSON response.";

        aiJson = null;
      }
    }

    // -----------------------------------------
    // Gemini failed
    // -----------------------------------------
    if (!aiJson) {
      console.error(
        "========================================",
      );
      console.error(
        "analyze-task: GEMINI REQUEST FAILED",
      );
      console.error(
        "Status:",
        lastStatus,
      );
      console.error(
        "Details:",
        lastError,
      );
      console.error(
        "========================================",
      );

      let userMessage =
        `Gemini API error (${lastStatus || 500}).`;

      if (lastStatus === 400) {
        userMessage =
          "Gemini rejected the request. Check the Gemini API request or model configuration.";
      } else if (
        lastStatus === 401 ||
        lastStatus === 403
      ) {
        userMessage =
          "Gemini API authorization failed. Check that GEMINI_API_KEY is a valid Google AI Studio API key.";
      } else if (lastStatus === 404) {
        userMessage =
          "The requested Gemini models are unavailable for this API key.";
      } else if (lastStatus === 429) {
        userMessage =
          "Gemini rate limit or quota was reached. Please try again later.";
      } else if (lastStatus >= 500) {
        userMessage =
          "Gemini is currently unavailable. Please try again later.";
      }

      return new Response(
        JSON.stringify({
          error: userMessage,
          status: lastStatus || 500,
          details: lastError,
        }),
        {
          status:
            lastStatus >= 400 &&
            lastStatus < 600
              ? lastStatus
              : 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // -----------------------------------------
    // Extract Gemini generated content
    // -----------------------------------------
    const candidates =
      Array.isArray(aiJson.candidates)
        ? aiJson.candidates
        : [];

    const firstCandidate =
      candidates[0] as
        | {
            content?: {
              parts?: Array<{
                text?: string;
              }>;
            };
            finishReason?: string;
          }
        | undefined;

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
      "analyze-task: Gemini generated content length:",
      content.length,
    );

    console.log(
      "analyze-task: Gemini finish reason:",
      firstCandidate?.finishReason || "(unknown)",
    );

    // -----------------------------------------
    // Empty Gemini response
    // -----------------------------------------
    if (!content) {
      console.error(
        "analyze-task: Gemini returned empty content.",
      );

      console.error(
        "analyze-task: Gemini response:",
        JSON.stringify(aiJson).slice(0, 3000),
      );

      return new Response(
        JSON.stringify({
          error:
            "Gemini returned an empty analysis.",
          details:
            "No generated text was returned by Gemini.",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    console.log(
      "analyze-task: Gemini content:",
      content.slice(0, 1000),
    );

    // -----------------------------------------
    // Parse generated JSON
    // -----------------------------------------
    let parsed: Record<string, unknown>;

    try {
      parsed =
        extractJsonObject(content) as Record<
          string,
          unknown
        >;
    } catch (parseError) {
      console.error(
        "analyze-task: Failed to parse generated JSON.",
        parseError,
      );

      console.error(
        "analyze-task: Raw Gemini content:",
        content.slice(0, 2000),
      );

      return new Response(
        JSON.stringify({
          error:
            "Gemini returned an invalid task analysis.",
          details:
            "The AI response could not be converted into the required JSON format.",
          raw:
            content.slice(0, 500),
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // -----------------------------------------
    // Normalize result
    // -----------------------------------------
    const result = normalizeAnalysis(
      parsed,
      category,
      description,
    );

    console.log(
      "========================================",
    );
    console.log(
      "analyze-task: SUCCESS",
    );
    console.log(
      "Duration:",
      result.duration,
    );
    console.log(
      "Difficulty:",
      result.difficulty,
    );
    console.log(
      "Category:",
      result.category,
    );
    console.log(
      "Priority:",
      result.priority,
    );
    console.log(
      "========================================",
    );

    // -----------------------------------------
    // Return result
    // -----------------------------------------
    return new Response(
      JSON.stringify({
        ...result,
        algorithm:
          "llm:google-gemini",
        timestamp:
          new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error(
      "========================================",
    );
    console.error(
      "analyze-task: UNEXPECTED ERROR",
    );
    console.error(
      error,
    );
    console.error(
      "========================================",
    );

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "AI analysis failed.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
