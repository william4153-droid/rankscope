import { createClient } from "@supabase/supabase-js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders },
  });
}

export function normalizeText(value, max = 160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be configured.");
  }

  return { url, anonKey, serviceRoleKey };
}

export function createAdminClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be configured for server operations.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createUserClient(token) {
  const { url, anonKey } = getSupabaseConfig();
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getBearerToken(req) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function adminEmailSet() {
  return new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function authenticateRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    return { errorResponse: jsonResponse(401, { error: "Please sign in to continue." }) };
  }

  let userClient;
  let adminClient;
  try {
    userClient = createUserClient(token);
    adminClient = createAdminClient();
  } catch (error) {
    return {
      errorResponse: jsonResponse(500, {
        error: "Authentication service is not configured.",
        detail: normalizeText(error?.message, 240),
      }),
    };
  }

  const { data, error } = await userClient.auth.getUser(token);
  const user = data?.user;
  if (error || !user) {
    return { errorResponse: jsonResponse(401, { error: "Your session is invalid or expired." }) };
  }

  const email = String(user.email || "").toLowerCase();
  const metadataName = normalizeText(user.user_metadata?.full_name || "", 120);

  const { data: existing, error: profileError } = await adminClient
    .from("profiles")
    .select("id,email,full_name,role,status,daily_limit,created_at,updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return {
      errorResponse: jsonResponse(500, {
        error: "Could not load the user profile. Run the supplied Supabase SQL setup.",
        detail: normalizeText(profileError.message, 240),
      }),
    };
  }

  const shouldBeAdmin = adminEmailSet().has(email);
  let profile = existing;

  if (!profile) {
    const { data: inserted, error: insertError } = await adminClient
      .from("profiles")
      .insert({
        id: user.id,
        email,
        full_name: metadataName,
        role: shouldBeAdmin ? "admin" : "user",
        status: "active",
        daily_limit: 20,
      })
      .select("id,email,full_name,role,status,daily_limit,created_at,updated_at")
      .single();

    if (insertError) {
      return {
        errorResponse: jsonResponse(500, {
          error: "Could not create the user profile.",
          detail: normalizeText(insertError.message, 240),
        }),
      };
    }
    profile = inserted;
  } else {
    const updates = {};
    if (email && profile.email !== email) updates.email = email;
    if (!profile.full_name && metadataName) updates.full_name = metadataName;
    if (shouldBeAdmin && profile.role !== "admin") updates.role = "admin";

    if (Object.keys(updates).length) {
      const { data: updated, error: updateError } = await adminClient
        .from("profiles")
        .update(updates)
        .eq("id", user.id)
        .select("id,email,full_name,role,status,daily_limit,created_at,updated_at")
        .single();
      if (!updateError && updated) profile = updated;
    }
  }

  return { token, user, profile, userClient, adminClient };
}

export function karachiDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isAdmin(profile) {
  return profile?.role === "admin" && profile?.status === "active";
}
