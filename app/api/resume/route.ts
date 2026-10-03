import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { Redis } from "@upstash/redis";
import { auth, getUserId } from "../../../auth";
import { deleteAllChats } from "../../../lib/chats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.CAREERPILOT_KV_REST_API_URL!,
  token: process.env.CAREERPILOT_KV_REST_API_TOKEN!,
});

type SavedResume = { storeName: string; fileName: string; uploadedAt: string };

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ user: null, resume: null });

  const session = await auth();
  const user = session?.user;
  const saved = await redis.get<SavedResume>(`user:${userId}:resume`);

  console.log("[resume GET] userId:", userId, "| record found:", !!saved);

  return NextResponse.json({
    user: { name: user?.name, email: user?.email, image: user?.image },
    resume: saved ? { fileName: saved.fileName, uploadedAt: saved.uploadedAt } : null,
  });
}

export async function DELETE() {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  await deleteAllChats(userId);

  const key = `user:${userId}:resume`;
  const saved = await redis.get<SavedResume>(key);

  if (saved) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      await ai.fileSearchStores.delete({ name: saved.storeName, config: { force: true } });
    } catch (e) {
      console.error("Store delete failed:", e);
    }
    await redis.del(key);
  }

  return NextResponse.json({ ok: true });
}