import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { readFile } from "fs/promises";
import path from "path";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is not configured.");
}

const ai = new GoogleGenAI({ apiKey });

const tools = [
  {
    type: "function" as const,
    name: "search_jobs",
    description:
      "Search for remote job opportunities based on a job role, skills, or keywords.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Job role, skills, or keywords to search for.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function" as const,
    name: "search_resume",
    description:
      "Search the user's uploaded resume for skills, projects, education, and experience.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The information you want to find in the user's resume.",
        },
      },
      required: ["query"],
    },
  },
];

async function searchJobs(query: string) {
  try {
    const url =
      `https://remotive.com/api/remote-jobs?search=` + encodeURIComponent(query);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      return { error: "Job search service returned an error." };
    }

    const data = await response.json();

    const jobs = (data.jobs || []).slice(0, 8).map((job: any) => ({
      title: job.title,
      company: job.company_name,
      location: job.candidate_required_location,
      url: job.url,
      description: job.description,
    }));

    return { query, jobs };
  } catch (error) {
    console.error("Job search error:", error);
    return { error: "Unable to search jobs right now." };
  }
}

/*
 * Reads the most recently uploaded resume's File Search store name
 * from disk. Returns null if no resume has been uploaded yet (the
 * file won't exist), rather than throwing.
 */
async function getStoredResumeStoreName(): Promise<string | null> {
  try {
    const storeFilePath = path.join(process.cwd(), "data", "resume-store.json");
    const raw = await readFile(storeFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.storeName || null;
  } catch {
    return null;
  }
}

async function searchResume(query: string) {
  const storeName = await getStoredResumeStoreName();

  if (!storeName) {
    return {
      error: "Resume knowledge base is not configured. Please upload your resume first.",
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: query,
      config: {
        tools: [{ fileSearch: { fileSearchStoreNames: [storeName] } }],
      },
    });

    return {
      query,
      answer: response.text || "No relevant information was found in the resume.",
    };
  } catch (error) {
    console.error("Resume search error:", error);
    return { error: "Unable to search the resume." };
  }
}

async function executeTool(name: string, arguments_: Record<string, unknown>) {
  if (name === "search_jobs") {
    return await searchJobs(String(arguments_.query || ""));
  }
  if (name === "search_resume") {
    return await searchResume(String(arguments_.query || ""));
  }
  return { error: `Unknown tool: ${name}` };
}

/* ============================================================
   TOOL-CALL STEP SHAPE
   ------------------------------------------------------------
   The SDK's `Step` union doesn't expose a matching type predicate
   for function-call steps, and the exact literal type name isn't
   confirmed against your installed SDK version. Casting through
   `any` here is a deliberate, scoped escape — not a guess dressed
   up as a real type. Verify against node_modules and tighten this
   later (see note at bottom of this file).
   ============================================================ */

function isFunctionCallStep(step: any): boolean {
  return step && step.type === "function_call";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userMessage = body.message;

    if (!userMessage || typeof userMessage !== "string") {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const systemInstruction = `
You are CareerPilot AI, an intelligent AI career assistant.

Your job is to help users understand their resume and find suitable
software engineering and AI engineering opportunities.

You have access to two tools.

TOOL 1: search_jobs
Use this when you need to find job opportunities.

TOOL 2: search_resume
Use this when you need information about the user's resume.

When the user asks for job recommendations:

1. Search for relevant jobs.
2. Search the user's resume for relevant skills and experience.
3. Compare the candidate's background with the job requirements.
4. Recommend the strongest matches.
5. Explain why each recommendation is suitable.
6. Never invent experience, skills, education, or projects that are not present in the resume.

You are an agent.

Decide which tools are necessary to answer the user's request.
Use tools when appropriate.
After receiving tool results, reason over them and provide a useful final response.

Keep your response concise but informative.
`;

    let interaction: any = await ai.interactions.create({
      model: "gemini-3.6-flash",
      input: userMessage,
      system_instruction: systemInstruction,
      tools,
    });

    while (true) {
      const functionCalls: any[] = (interaction.steps as any[]).filter(isFunctionCallStep);

      if (functionCalls.length === 0) {
        break;
      }

      const results: any[] = [];

      for (const call of functionCalls) {
        const toolName = String(call.name);
        const toolArguments =
          typeof call.arguments === "string"
            ? JSON.parse(call.arguments)
            : call.arguments || {};

        console.log(`[AGENT TOOL CALL] ${toolName}`);
        console.log(`[ARGUMENTS]`, toolArguments);

        const toolResult = await executeTool(toolName, toolArguments);

        results.push({
          type: "function_result" as const,
          name: toolName,
          call_id: call.id,
          result: [{ type: "text" as const, text: JSON.stringify(toolResult) }],
        });
      }

      interaction = await ai.interactions.create({
        model: "gemini-3.6-flash",
        previous_interaction_id: interaction.id,
        input: results,
        tools,
      });
    }

    return NextResponse.json({
      answer: interaction.output_text || "I was unable to generate a response.",
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong while processing your request.",
      },
      { status: 500 }
    );
  }
}