import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { getUserId } from "../../../auth";

const redisUrl = process.env.CAREERPILOT_KV_REST_API_URL;
const redisToken = process.env.CAREERPILOT_KV_REST_API_TOKEN;

const redis =
  redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const limiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      prefix: "rl:upload",
    })
  : null;

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

type SavedResume = { storeName: string; fileName: string; uploadedAt: string };

export async function POST(request: NextRequest) {
  let stage = "initialization";
  let newStoreName: string | null = null;
  let saved = false;
  let ai: GoogleGenAI | null = null;

  try {
    stage = "checking sign-in";
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Please sign in to upload a resume." }, { status: 401 });
    }

    if (!redis || !limiter) {
      throw new Error("Upstash Redis environment variables are missing.");
    }

    const { success } = await limiter.limit(`user:${userId}`);
    if (!success) {
      return NextResponse.json(
        { error: "Upload limit reached. Try again in an hour." },
        { status: 429 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing in the server environment.");
    ai = new GoogleGenAI({ apiKey });

    stage = "reading upload";
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No resume file was provided." }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Please upload a PDF resume." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The uploaded PDF is empty." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "PDF is too large (max 5 MB)." }, { status: 413 });
    }

    stage = "creating Gemini File Search Store";
    const store = await ai.fileSearchStores.create({
      config: { displayName: `resume-${userId}` },
    });
    if (!store.name) throw new Error("Gemini did not return a store name.");
    newStoreName = store.name;

    stage = "uploading PDF to Gemini";
    let operation = await ai.fileSearchStores.uploadToFileSearchStore({
      file,
      fileSearchStoreName: store.name,
      config: {
        displayName: file.name,
        chunkingConfig: {
          whiteSpaceConfig: { maxTokensPerChunk: 300, maxOverlapTokens: 40 },
        },
      },
    });

    stage = "waiting for Gemini indexing";
    let attempts = 0;
    while (!operation.done && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      operation = await ai.operations.get({ operation });
      attempts++;
    }
    if (!operation.done) {
      throw new Error("Gemini indexing is still in progress. Please try again later.");
    }
    if (operation.error) {
      throw new Error(`Gemini indexing failed: ${JSON.stringify(operation.error)}`);
    }

    stage = "saving resume information";
    const key = `user:${userId}:resume`;
    const previous = await redis.get<SavedResume>(key);

    const record: SavedResume = {
      storeName: store.name,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
    };
    console.log("[upload] saving under", key);
    await redis.set(key, record);
    saved = true;

    if (previous?.storeName && previous.storeName !== store.name) {
      try {
        await ai.fileSearchStores.delete({
          name: previous.storeName,
          config: { force: true },
        });
      } catch (e) {
        console.error("Old store cleanup failed:", e);
      }
    }

    return NextResponse.json({ success: true, message: "Resume uploaded and indexed." });
  } catch (error) {
    console.error("Resume upload failed:", {
      stage,
      message: error instanceof Error ? error.message : String(error),
    });

    if (ai && newStoreName && !saved) {
      try {
        await ai.fileSearchStores.delete({ name: newStoreName, config: { force: true } });
      } catch {}
    }

    return NextResponse.json({ error: "Resume upload failed.", stage }, { status: 500 });
  }
}