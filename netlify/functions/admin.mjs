import {
  authenticateRequest,
  isAdmin,
  jsonResponse,
  karachiDateString,
  normalizeText,
} from "../shared/supabase.mjs";

async function listOverview(adminClient) {
  const today = karachiDateString();

  const [profilesResult, usageResult, searchesResult] = await Promise.all([
    adminClient
      .from("profiles")
      .select("id,email,full_name,role,status,daily_limit,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(500),
    adminClient
      .from("daily_usage")
      .select("user_id,used_count,usage_date")
      .eq("usage_date", today)
      .limit(1000),
    adminClient
      .from("search_history")
      .select(
        "id,user_id,keyword,country,language,competition_score,competition_label,search_intent,result_count,searched_at,profiles(email,full_name)"
      )
      .order("searched_at", { ascending: false })
      .limit(100),
  ]);

  const firstError = profilesResult.error || usageResult.error || searchesResult.error;
  if (firstError) throw firstError;

  const usageMap = new Map((usageResult.data || []).map((row) => [row.user_id, row.used_count]));
  const users = (profilesResult.data || []).map((profile) => ({
    ...profile,
    usedToday: Number(usageMap.get(profile.id) || 0),
    remainingToday: Math.max(0, Number(profile.daily_limit || 0) - Number(usageMap.get(profile.id) || 0)),
  }));

  return {
    today,
    stats: {
      totalUsers: users.length,
      activeUsers: users.filter((user) => user.status === "active").length,
      suspendedUsers: users.filter((user) => user.status === "suspended").length,
      searchesToday: (usageResult.data || []).reduce((sum, row) => sum + Number(row.used_count || 0), 0),
    },
    users,
    recentSearches: searchesResult.data || [],
  };
}

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Use POST for this endpoint." });
  }

  const auth = await authenticateRequest(req);
  if (auth.errorResponse) return auth.errorResponse;
  if (!isAdmin(auth.profile)) {
    return jsonResponse(403, { error: "Admin access is required." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON request." });
  }

  const action = normalizeText(body?.action, 40);

  try {
    if (action === "overview") {
      return jsonResponse(200, await listOverview(auth.adminClient));
    }

    if (action === "update_user") {
      const userId = normalizeText(body?.userId, 80);
      if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return jsonResponse(400, { error: "Invalid user ID." });
      }

      const updates = {};
      if (["active", "suspended"].includes(body?.status)) updates.status = body.status;
      if (["user", "admin"].includes(body?.role)) updates.role = body.role;

      if (body?.dailyLimit !== undefined) {
        const dailyLimit = Number(body.dailyLimit);
        if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000) {
          return jsonResponse(400, { error: "Daily limit must be an integer from 0 to 1000." });
        }
        updates.daily_limit = dailyLimit;
      }

      if (!Object.keys(updates).length) {
        return jsonResponse(400, { error: "No valid user changes were supplied." });
      }

      if (userId === auth.profile.id) {
        if (updates.status && updates.status !== "active") {
          return jsonResponse(400, { error: "You cannot suspend your own admin account." });
        }
        if (updates.role && updates.role !== "admin") {
          return jsonResponse(400, { error: "You cannot remove your own admin access." });
        }
      }

      const { data, error } = await auth.adminClient
        .from("profiles")
        .update(updates)
        .eq("id", userId)
        .select("id,email,full_name,role,status,daily_limit,created_at,updated_at")
        .single();

      if (error) throw error;
      return jsonResponse(200, { user: data, message: "User updated successfully." });
    }

    if (action === "delete_user") {
      const userId = normalizeText(body?.userId, 80);
      if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return jsonResponse(400, { error: "Invalid user ID." });
      }
      if (userId === auth.profile.id) {
        return jsonResponse(400, { error: "You cannot delete your own admin account." });
      }

      const { error } = await auth.adminClient.auth.admin.deleteUser(userId, false);
      if (error) throw error;
      return jsonResponse(200, { message: "User account deleted successfully." });
    }

    if (action === "reset_usage") {
      const userId = normalizeText(body?.userId, 80);
      if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return jsonResponse(400, { error: "Invalid user ID." });
      }

      const { error } = await auth.adminClient
        .from("daily_usage")
        .upsert(
          { user_id: userId, usage_date: karachiDateString(), used_count: 0 },
          { onConflict: "user_id,usage_date" }
        );
      if (error) throw error;

      return jsonResponse(200, { message: "Today's usage has been reset." });
    }

    return jsonResponse(400, { error: "Unknown admin action." });
  } catch (error) {
    return jsonResponse(500, {
      error: "Admin operation failed.",
      detail: normalizeText(error?.message, 260),
    });
  }
};

export const config = { path: "/api/admin" };
