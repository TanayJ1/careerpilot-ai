import { NextResponse } from "next/server";
import { getUserId } from "../../../../auth";
import { getChat, deleteChat } from "../../../../lib/chats";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { id } = await ctx.params;
  const chat = await getChat(userId, id);
  if (!chat) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  return NextResponse.json({ chat });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { id } = await ctx.params;
  await deleteChat(userId, id);
  return NextResponse.json({ ok: true });
}