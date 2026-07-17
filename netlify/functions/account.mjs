import {
  authenticateRequest,
  jsonResponse,
  karachiDateString,
  normalizeText,
} from "../shared/supabase.mjs";

export default async (req) => {
  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Use GET for this endpoint." });
  }

  const auth = await authenticateRequest(req);
  if (auth.errorResponse) return auth.errorResponse;

  const { profile, adminClient } = auth;
  const today = karachiDateString();

  const { data: usage, error: usageError } = await adminClient
    .from("daily_usage")
    .select("used_count,usage_date")
    .eq("user_id", profile.id)
    .eq("usage_date", today)
    .maybeSingle();

  if (usageError) {
    return jsonResponse(500, {
      error: "Could not load today's usage.",
      detail: normalizeText(usageError.message, 240),
    });
  }

  const used = Number(usage?.used_count || 0);
  const limit = Number(profile.daily_limit || 20);

  return jsonResponse(200, {
    profile,
    usage: {
      date: today,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100,
    },
  });
};

export const config = { path: "/api/account" };
