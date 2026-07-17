import { authenticateRequest, jsonResponse, normalizeText } from "../shared/supabase.mjs";

export default async (req) => {
  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Use GET for this endpoint." });
  }

  const auth = await authenticateRequest(req);
  if (auth.errorResponse) return auth.errorResponse;

  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 25);
  const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 25));

  const { data, error } = await auth.adminClient
    .from("search_history")
    .select(
      "id,keyword,country,language,competition_score,competition_label,search_intent,result_count,searched_at,result_snapshot"
    )
    .eq("user_id", auth.profile.id)
    .order("searched_at", { ascending: false })
    .limit(limit);

  if (error) {
    return jsonResponse(500, {
      error: "Could not load search history.",
      detail: normalizeText(error.message, 240),
    });
  }

  return jsonResponse(200, { searches: data || [] });
};

export const config = { path: "/api/history" };
