import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    session({ session, token }) {
      if (token.sub && session.user) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
});

export async function getUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}