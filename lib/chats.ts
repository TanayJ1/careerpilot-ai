import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.CAREERPILOT_KV_REST_API_URL!,
  token: process.env.CAREERPILOT_KV_REST_API_TOKEN!,
});

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  at: string;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

const MAX_CHATS = 30;
const MAX_MESSAGES = 40;

export const isValidChatId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

const chatKey = (userId: string, id: string) => `user:${userId}:chat:${id}`;
const indexKey = (userId: string) => `user:${userId}:chats`;

export async function getChat(userId: string, id: string): Promise<Chat | null> {
  if (!isValidChatId(id)) return null;
  return (await redis.get<Chat>(chatKey(userId, id))) ?? null;
}

export async function saveChat(userId: string, chat: Chat) {
  chat.messages = chat.messages.slice(-MAX_MESSAGES);
  await redis.set(chatKey(userId, chat.id), chat);
  await redis.zadd(indexKey(userId), { score: Date.now(), member: chat.id });

  // Keep only the newest MAX_CHATS chats.
  const count = await redis.zcard(indexKey(userId));
  if (count > MAX_CHATS) {
    const oldIds = await redis.zrange<string[]>(indexKey(userId), 0, count - MAX_CHATS - 1);
    if (oldIds.length) {
      await redis.zrem(indexKey(userId), ...oldIds);
      await redis.del(...oldIds.map((id) => chatKey(userId, id)));
    }
  }
}

export async function listChats(userId: string) {
  const ids = await redis.zrange<string[]>(indexKey(userId), 0, -1, { rev: true });
  if (!ids.length) return [];
  const chats = await Promise.all(ids.map((id) => getChat(userId, id)));
  return chats
    .filter((c): c is Chat => !!c)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
}

export async function deleteChat(userId: string, id: string) {
  if (!isValidChatId(id)) return;
  await redis.del(chatKey(userId, id));
  await redis.zrem(indexKey(userId), id);
}

export async function deleteAllChats(userId: string) {
  const ids = await redis.zrange<string[]>(indexKey(userId), 0, -1);
  if (ids.length) await redis.del(...ids.map((id) => chatKey(userId, id)));
  await redis.del(indexKey(userId));
}