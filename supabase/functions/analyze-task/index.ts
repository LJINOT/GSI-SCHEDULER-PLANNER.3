import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

type Analysis = {
  duration: number;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  priority: "high" | "medium" | "low";
  corrected_description: string;
};

function jsonResponse(
  data: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    },
  );
}

function extractJsonObject(
  text: string,
): unknown {
  if (!text) {
    throw new Error(
      "Empty AI response",
    );
  }

  let s = text.trim();

  // Remove markdown code fences
  if (s.startsWith("```")) {
    s = s
      .replace(
        /^```(?:json)?\s*/i,
        "",
      )
      .replace(
        /\s*```$/i,
        "",
      )
      .trim();
  }

  // Find the JSON object
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");

  if (start >= 0 && end > start) {
    s = s.slice(
      start,
      end + 1,
    );
  }

  return JSON.parse(s);
}

function normalizeAnalysis(
  raw: Record<string, unknown>,
  userCategory?: string,
  originalDescription?: string,
): Analysis {
  // -----------------------------
  // Duration
  // -----------------------------

  let duration = Number(
    raw.duration,
  );

  if (!Number.isFinite(duration)) {
    duration = 30;
  }

  duration = Math.round(duration);

  duration = Math.min(
    480,
    Math.max(5, duration),
  );

  // -----------------------------
  // Difficulty
  // -----------------------------

  const diffRaw = String(
    raw.difficulty ||
      "medium",
  ).toLowerCase();

  const difficulty =
    (
      [
        "easy",
        "medium",
        "hard",
      ].includes(diffRaw)
        ? diffRaw
        : "medium"
    ) as Analysis["difficulty"];

  // -----------------------------
  // Priority
  // -----------------------------

  const priorityRaw = String(
    raw.priority ||
      "medium",
  ).toLowerCase();

  const priority =
    (
      [
        "high",
        "medium",
        "low",
      ].includes(priorityRaw)
        ? priorityRaw
        : "medium"
    ) as Analysis["priority"];

  // -----------------------------
  // Category
  // -----------------------------

  let category =
    userCategory &&
    userCategory.trim()
      ? userCategory.trim()
      : String(
          raw.category ||
            "General",
        ).trim();

  if (!category) {
    category = "General";
  }

  // -----------------------------
  // Corrected description
  // -----------------------------

  let correctedDescription =
    typeof raw.corrected_description ===
    "string"
      ? raw.corrected_description
      : originalDescription ||
        "";

  if (
    !originalDescription ||
    !originalDescription.trim()
  ) {
    correctedDescription = "";
  }

  return {
    duration,
    difficulty,
    category,
    priority,
    corrected_description:
      correctedDescription,
  };
}

/**
 * Get available Gemini models for
 * the current API key.
 *
 * This prevents the function from
 * depending on an old model name.
 */
async function getAvailableModel(
  apiKey: string,
): Promise<string> {
  const response =
    await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
      {
        method: "GET",
        headers: {
          "x-goog-api-key":
            apiKey,
        },
      },
    );

  const text =
    await response.text();

  if (!response.ok) {
    console.error(
      "Gemini models.list failed:",
      response.status,
      text.slice(0, 1000),
    );

    throw new Error(
      `Unable to retrieve Gemini models (${response.status}).`,
    );
  }

  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Gemini returned an invalid model list.",
    );
  }

  const models =
    Array.isArray(data?.models)
      ? data.models
      : [];

  const supported =
    models.filter(
      (model: any) =>
        Array.isArray(
          model.supportedGenerationMethods,
        ) &&
        model.supportedGenerationMethods.includes(
          "generateContent",
        ),
    );

  if (supported.length === 0) {
    throw new Error(
      "Your Gemini API key has no available model that supports generateContent.",
    );
  }

  /*
   * Prefer current stable Flash models.
   *
   * The exact model available depends
   * on the API key/project.
   */
  const preferredModels = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
  ];

  for (
    const preferred of preferredModels
  ) {
    const found =
      supported.find(
        (model: any) =>
          model.name ===
          `models/${preferred}`,
      );

    if (found) {
      console.log(
        "Selected preferred Gemini model:",
        found.name,
      );

      return found.name.replace(
        /^models\//,
        "",
      );
    }
  }

  /*
   * If none of the preferred models
   * are available, use the first model
   * Google says supports
   * generateContent.
   */
  const fallback =
    supported[0];

  console.log(
    "Selected fallback Gemini model:",
    fallback.name,
  );

  return String(
    fallback.name,
  ).replace(
    /^models\//,
    "",
  );
}

serve(async (req) => {
  // --------------------------------
  // CORS
  // --------------------------------

  if (req.method === "OPTIONS") {
    return new Response(
      null,
      {
        status: 204,
        headers:
          corsHeaders,
      },
    );
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error:
          "Method not allowed",
      },
      405,
    );
  }

  console.log(
    "analyze-task: started",
  );

  try {
    // --------------------------------
    // Read request
    // --------------------------------

    let body: Record<
      string,
      unknown
    >;

    try {
      body =
        await req.json();
    } catch {
      return jsonResponse(
        {
          error:
            "Invalid JSON body.",
        },
        400,
      );
    }

    const title =
      typeof body.title ===
      "string"
        ? body.title.trim()
        : "";

    const description =
      typeof body.description ===
      "string"
        ? body.description.trim()
        : "";

    const userCategory =
      typeof body.category ===
      "string"
        ? body.category.trim()
        : "";

    if (!title) {
      return jsonResponse(
        {
          error:
            "Task title is required.",
        },
        400,
      );
    }

    // --------------------------------
    // Gemini API key
    // --------------------------------

    const GEMINI_API_KEY =
      Deno.env.get(
        "GEMINI_API_KEY",
      );

    if (!GEMINI_API_KEY) {
      console.error(
        "GEMINI_API_KEY is missing.",
      );

      return jsonResponse(
        {
          error:
            "Gemini API key is not configured. Add GEMINI_API_KEY to Supabase Edge Function secrets.",
        },
        500,
      );
    }

    console.log(
      "analyze-task: Gemini API key configured:",
      Boolean(
        GEMINI_API_KEY,
      ),
    );

    // --------------------------------
    // Find available model
    // --------------------------------

    const model =
      await getAvailableModel(
        GEMINI_API_KEY,
      );

    console.log(
      "analyze-task: using model:",
      model,
    );

    // --------------------------------
    // Prompt
    // --------------------------------

    const systemPrompt = `
You are the AI task analyzer for the GSI Schedule Planner.

Analyze the user's task based ONLY on the information provided.

Return ONLY one valid JSON object.

Required fields:

duration:
- Estimated time needed to complete the task.
- Integer number of minutes.
- Minimum 5.
- Maximum 480.
- Base the estimate on the actual task.

difficulty:
- Must be exactly:
  "easy"
  "medium"
  "hard"
- Judge the difficulty from the actual task.

category:
- Choose the most suitable category for the task.
- If the user already selected a category, KEEP THAT CATEGORY.
- Do not replace a user-selected category.

priority:
- Must be exactly:
  "high"
  "medium"
  "low"
- Judge priority from the task's urgency, importance, and wording.
- Do not automatically make every task high priority.

corrected_description:
- Correct spelling and grammar lightly.
- Keep the user's original meaning.
- Do not add information.
- If no description was provided, return an empty string.

IMPORTANT:
- Different tasks must produce different analysis when appropriate.
- Do not use fixed example values.
- Do not always return 180 minutes.
- Do not always return hard.
- Do not always return high priority.
- Do not return Markdown.
- Do not return an explanation.

Return ONLY JSON.
`;

    const userPrompt = `
TASK TITLE:
${title}

TASK DESCRIPTION:
${description || "(No description provided)"}

USER SELECTED CATEGORY:
${userCategory || "(No category selected)"}
`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `${systemPrompt}\n\n${userPrompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    };

    // --------------------------------
    // Call Gemini
    // --------------------------------

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    console.log(
      "analyze-task: calling Gemini:",
      model,
    );

    const aiResponse =
      await fetch(url, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            GEMINI_API_KEY,
        },

        body: JSON.stringify(
          requestBody,
        ),
      });

    const responseText =
      await aiResponse.text();

    console.log(
      "analyze-task: Gemini status:",
      aiResponse.status,
    );

    if (!aiResponse.ok) {
      console.error(
        "analyze-task: Gemini error:",
        responseText.slice(
          0,
          1500,
        ),
      );

      if (
        aiResponse.status ===
        400
      ) {
        return jsonResponse(
          {
            error:
              "Gemini rejected the request.",
            details:
              responseText.slice(
                0,
                500,
              ),
            model,
          },
          502,
        );
      }

      if (
        aiResponse.status ===
          401 ||
        aiResponse.status ===
          403
      ) {
        return jsonResponse(
          {
            error:
              "Gemini API authorization failed. Check GEMINI_API_KEY.",
          },
          502,
        );
      }

      if (
        aiResponse.status ===
        429
      ) {
        return jsonResponse(
          {
            error:
              "Gemini rate limit reached. Please try again shortly.",
          },
          429,
        );
      }

      return jsonResponse(
        {
          error:
            `Gemini API failed (${aiResponse.status}).`,
          details:
            responseText.slice(
              0,
              500,
            ),
          model,
        },
        502,
      );
    }

    // --------------------------------
    // Parse Gemini response
    // --------------------------------

    let aiJson: any;

    try {
      aiJson =
        JSON.parse(
          responseText,
        );
    } catch {
      console.error(
        "Gemini returned invalid JSON:",
        responseText.slice(
          0,
          1000,
        ),
      );

      return jsonResponse(
        {
          error:
            "Gemini returned an invalid response.",
        },
        502,
      );
    }

    // --------------------------------
    // Extract generated text
    // --------------------------------

    const candidates =
      Array.isArray(
        aiJson?.candidates,
      )
        ? aiJson.candidates
        : [];

    const parts =
      candidates?.[0]?.content
        ?.parts;

    let content = "";

    if (
      Array.isArray(parts)
    ) {
      content = parts
        .map(
          (part: any) =>
            typeof part?.text ===
            "string"
              ? part.text
              : "",
        )
        .join("");
    }

    console.log(
      "analyze-task: Gemini content:",
      content.slice(0, 1000),
    );

    if (!content.trim()) {
      console.error(
        "Gemini returned no text:",
        JSON.stringify(
          aiJson,
        ).slice(0, 2000),
      );

      return jsonResponse(
        {
          error:
            "Gemini returned an empty analysis.",
        },
        502,
      );
    }

    // --------------------------------
    // Parse AI JSON
    // --------------------------------

    let parsed: Record<
      string,
      unknown
    >;

    try {
      parsed =
        extractJsonObject(
          content,
        ) as Record<
          string,
          unknown
        >;
    } catch (error) {
      console.error(
        "AI JSON parsing failed:",
        error,
      );

      console.error(
        "Raw Gemini content:",
        content.slice(
          0,
          1500,
        ),
      );

      return jsonResponse(
        {
          error:
            "Gemini returned an invalid task analysis.",
        },
        502,
      );
    }

    // --------------------------------
    // Normalize
    // --------------------------------

    const result =
      normalizeAnalysis(
        parsed,
        userCategory ||
          undefined,
        description ||
          undefined,
      );

    console.log(
      "analyze-task: success:",
      result,
    );

    // --------------------------------
    // Return result to AddTask.tsx
    // --------------------------------

    return jsonResponse({
      ok: true,

      duration:
        result.duration,

      difficulty:
        result.difficulty,

      category:
        result.category,

      priority:
        result.priority,

      corrected_description:
        result.corrected_description,

      algorithm:
        `llm:${model}`,

      timestamp:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "analyze-task fatal error:",
      error,
    );

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "AI analysis failed.",
      },
      500,
    );
  }
});
