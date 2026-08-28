
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        {
          error: "No resume file was provided.",
        },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        {
          error: "Please upload a PDF resume.",
        },
        { status: 400 }
      );
    }

    /*
     * Create a Gemini File Search store.
     */
    const store = await ai.fileSearchStores.create({
      config: {
        displayName: "CareerPilot Resume Knowledge",
      },
    });

    if (!store.name) {
      throw new Error("Gemini did not return a File Search Store name.");
    }

    /*
     * Upload the resume into the File Search Store.
     */
    let operation =
      await ai.fileSearchStores.uploadToFileSearchStore({
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

    /*
     * Wait for indexing to finish.
     */
    while (!operation.done) {
      await new Promise((resolve) =>
        setTimeout(resolve, 2000)
      );

      operation = await ai.operations.get({
        operation: operation,
      });
    }

    /*
     * Store the File Search Store name so the chat API
     * can search the uploaded resume later.
     */
    return NextResponse.json({
      success: true,
      message: "Resume uploaded and indexed successfully.",
      storeName: store.name,
    });
  } catch (error) {
    console.error("Resume upload error:", error);

    return NextResponse.json(
      {
        error: "Failed to upload and index the resume.",
      },
      { status: 500 }
    );
  }
}

