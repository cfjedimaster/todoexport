import type { Config, Context } from "@netlify/functions";

export default async (_req: Request, _context: Context): Promise<Response> => {
  const clientId = Netlify.env.get("MS_CLIENT_ID")?.trim();

  if (!clientId) {
    return Response.json(
      { error: "Application configuration is incomplete. Set the MS_CLIENT_ID environment variable." },
      {
        status: 500,
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  }

  return Response.json(
    { clientId },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
};

export const config: Config = {
  path: "/api/config",
  method: "GET",
};
