import { NextResponse } from "next/server";
import { getUserId } from "../../../auth";
import { listChats } from "../../../lib/chats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ chats: [] });
  return NextResponse.json({ chats: await listChats(userId) });
}