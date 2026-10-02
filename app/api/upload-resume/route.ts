
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let stage = "initialization";

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing in the server environment.");
    }

    const ai = new GoogleGenAI({ apiKey });

    stage = "reading upload";
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No resume file was provided." },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Please upload a PDF resume." },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "The uploaded PDF is empty." },
        { status: 400 }
      );
    }

    stage = "creating Gemini File Search Store";
    const store = await ai.fileSearchStores.create({
      config: {
        displayName: "CareerPilot Resume Knowledge",
      },
    });

    if (!store.name) {
      throw new Error("Gemini did not return a store name.");
    }

    stage = "uploading PDF to Gemini";
    let operation = await ai.fileSearchStores.uploadToFileSearchStore({
      file,
      fileSearchStoreName: store.name,
      config: {
        displayName: file.name,
        chunkingConfig: {
          whiteSpaceConfig: {
            maxTokensPerChunk: 300,
            maxOverlapTokens: 40,
          },
        },
      },
    });

    stage = "waiting for Gemini indexing";
    let attempts = 0;
    const maxAttempts = 20;

    while (!operation.done && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      operation = await ai.operations.get({
        operation,
      });

      attempts++;
    }

    if (!operation.done) {
      throw new Error(
        "Gemini indexing is still in progress. Please try again later."
      );
    }

    if (operation.error) {
      throw new Error(
        `Gemini indexing failed: ${JSON.stringify(operation.error)}`
      );
    }

    stage = "saving resume information to KV";
    await kv.set("resume:storeName", store.name);
    await kv.set("resume:fileName", file.name);
    await kv.set("resume:uploadedAt", new Date().toISOString());

    return NextResponse.json({
      success: true,
      message: "Resume uploaded and indexed successfully.",
      storeName: store.name,
    });
  } catch (error) {
    // Keep detailed errors in server logs, not in the public response.
    console.error("Resume upload failed:", {
      stage,
      message: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: "Resume upload failed.",
        stage,
        details:
          error instanceof Error
            ? error.message
            : "Unknown server error",
      },
      { status: 500 }
    );
  }
}