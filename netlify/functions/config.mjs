import { getSupabaseConfig, jsonResponse, normalizeText } from "../shared/supabase.mjs";

export default async (req) => {
  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Use GET for this endpoint." });
  }

  try {
    const { url, anonKey } = getSupabaseConfig();
    return jsonResponse(
      200,
      {
        supabaseUrl: url,
        supabaseAnonKey: anonKey,
        defaultDailyLimit: 20,
      },
      { "cache-control": "public, max-age=300" }
    );
  } catch (error) {
    return jsonResponse(500, {
      error: "Supabase is not configured.",
      detail: normalizeText(error?.message, 240),
    });
  }
};

export const config = { path: "/api/config" };
