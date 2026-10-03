import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { Ratelimit } from "@upstash/ratelimit";
import { getUserId } from "../../../auth";
import { redis, getChat, saveChat, type Chat } from "../../../lib/chats";

export const runtime = "nodejs";
export const maxDuration = 60;

const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  prefix: "rl:chat",
});

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is not configured.");
}
const ai = new GoogleGenAI({ apiKey });

const MODEL = "gemini-3.5-flash-lite";

const tools = [
  {
    type: "function" as const,
    name: "search_jobs",
    description: "Search for remote job opportunities based on a job role, skills, or keywords.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Job role, skills, or keywords to search for." },
      },
      required: ["query"],
    },
  },
  {
    type: "function" as const,
    name: "search_resume",
    description: "Search the user's uploaded resume for skills, projects, education, and experience.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The information you want to find in the user's resume." },
      },
      required: ["query"],
    },
  },
];

async function searchJobs(query: string) {
  try {
    const url = `https://remotive.com/api/remote-jobs?search=` + encodeURIComponent(query);
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
      description: String(job.description || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 700),
    }));

    return { query, jobs };
  } catch (error) {
    console.error("Job search error:", error);
    return { error: "Unable to search jobs right now." };
  }
}

async function searchResume(query: string, storeName: string | null) {
  if (!storeName) {
    return { error: "No resume uploaded yet. Tell the user to upload one." };
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
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

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  storeName: string | null
) {
  if (name === "search_jobs") return await searchJobs(String(args.query || ""));
  if (name === "search_resume") return await searchResume(String(args.query || ""), storeName);
  return { error: `Unknown tool: ${name}` };
}

function isFunctionCallStep(step: any): boolean {
  return step && step.type === "function_call";
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

If the user's message is vague or unclear, ask one short clarifying question and suggest an example request.
If search_resume reports no resume, tell the user to upload one before you recommend jobs.
If a "Previous conversation" section is given, use it for context on follow-up questions.

Format answers in clean markdown. Keep your response concise but informative.
`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userMessage = body.message;

    if (!userMessage || typeof userMessage !== "string") {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }
    if (userMessage.length > 1000) {
      return NextResponse.json({ error: "Message is too long (max 1000 characters)." }, { status: 400 });
    }

    const userId = await getUserId();
    const demo = body.demo === true;

    if (!userId && !demo) {
      return NextResponse.json({ error: "Please sign in or try the demo." }, { status: 401 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
    const { success } = await limiter.limit(demo ? `demo:${ip}` : `user:${userId}`);
    if (!success) {
      return NextResponse.json(
        { error: "Rate limit reached. Please try again in an hour." },
        { status: 429 }
      );
    }

    // Persist chats only for signed-in, non-demo users.
    const persist = !!userId && !demo;

    let storeName: string | null = null;
    if (demo) {
      storeName = process.env.DEMO_STORE_NAME ?? null;
    } else {
      const saved = await redis.get<{ storeName: string }>(`user:${userId}:resume`);
      storeName = saved?.storeName ?? null;
    }

    // Load existing chat so follow-up questions have context.
    let chat: Chat | null = null;
    if (persist && typeof body.chatId === "string") {
      chat = await getChat(userId!, body.chatId);
    }

    const history = (chat?.messages ?? [])
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 1200)}`)
      .join("\n\n");

    const input = history
      ? `Previous conversation:\n${history}\n\nNew message from the user: ${userMessage}`
      : userMessage;

    let interaction: any = await ai.interactions.create({
      model: MODEL,
      input,
      system_instruction: systemInstruction,
      tools,
    });

    const toolsUsed: string[] = [];

    for (let step = 0; step < 5; step++) {
      const functionCalls: any[] = (interaction.steps as any[]).filter(isFunctionCallStep);
      if (functionCalls.length === 0) break;

      const results: any[] = [];

      for (const call of functionCalls) {
        const toolName = String(call.name);
        const toolArguments =
          typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments || {};

        toolsUsed.push(toolName);
        console.log(`[AGENT TOOL CALL] ${toolName}`, toolArguments);

        const toolResult = await executeTool(toolName, toolArguments, storeName);

        results.push({
          type: "function_result" as const,
          name: toolName,
          call_id: call.id,
          result: [{ type: "text" as const, text: JSON.stringify(toolResult) }],
        });
      }

      interaction = await ai.interactions.create({
        model: MODEL,
        previous_interaction_id: interaction.id,
        input: results,
        tools,
      });
    }

    const answer = interaction.output_text || "I was unable to generate a response.";

    let savedChatId: string | null = null;
    if (persist) {
      const now = new Date().toISOString();
      const target: Chat = chat ?? {
        id: randomUUID(),
        title: userMessage.slice(0, 60),
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      target.messages.push(
        { role: "user", content: userMessage, at: now },
        { role: "assistant", content: answer, tools: toolsUsed, at: now }
      );
      target.updatedAt = now;
      await saveChat(userId!, target);
      savedChatId = target.id;
    }

    return NextResponse.json({ answer, tools: toolsUsed, chatId: savedChatId });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Something went wrong while processing your request." },
      { status: 500 }
    );
  }
}