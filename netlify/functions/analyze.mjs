import { GoogleGenAI } from "@google/genai";
import {
  authenticateRequest,
  jsonResponse,
  normalizeText,
} from "../shared/supabase.mjs";

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

const PLATFORM_CONFIGS = {
  google: {
    name: "Google Keyword Research",
    focus:
      "SEO keywords for websites, category pages, service pages and blog content that can satisfy Google search intent.",
    clusterGuidance:
      "Build clusters for primary keywords, long-tail keywords, questions, commercial terms, comparison terms and supporting semantic terms.",
    actionPackGuidance:
      "Create action packs named Questions to Answer, Content Angles and Internal Link Ideas.",
    formatExamples: "Blog guide, comparison article, service page, category page, product page or tool page.",
  },
  youtube: {
    name: "YouTube Keyword Research",
    focus:
      "YouTube search phrases and video topics that match how viewers search for tutorials, reviews, comparisons, demonstrations, lists and Shorts.",
    clusterGuidance:
      "Build clusters for how-to searches, review searches, comparison searches, beginner searches, problem-solving searches, Shorts ideas and audience-specific phrases.",
    actionPackGuidance:
      "Create action packs named Video Title Ideas, Opening Hooks and Recommended Video Formats.",
    formatExamples: "Tutorial, review, comparison, top-list video, explainer, case study or Short.",
  },
  etsy: {
    name: "Etsy Keyword Research",
    focus:
      "Etsy buyer-intent phrases for listings, titles, concise tag candidates, occasions, recipients, styles, materials, personalization and digital or physical product attributes.",
    clusterGuidance:
      "Build clusters for exact product phrases, buyer intent, recipient, occasion, style, material, personalization and niche long-tail searches.",
    actionPackGuidance:
      "Create action packs named Etsy Tag Set, Listing Title Phrase Bank and Attribute Ideas. The Etsy Tag Set should contain exactly 13 concise listing-ready phrases.",
    formatExamples: "Etsy listing, personalized product listing, printable listing, digital download listing or gift listing.",
  },
  amazon: {
    name: "Amazon Keyword Research",
    focus:
      "Amazon product-discovery and buyer-intent phrases based on product type, benefits, features, use cases, audience, compatibility, budget, size and comparison intent.",
    clusterGuidance:
      "Build clusters for core product terms, feature terms, use-case terms, audience terms, problem-solving terms, comparison terms and budget modifiers.",
    actionPackGuidance:
      "Create action packs named Buyer Modifiers, Product Title Phrase Bank and Backend Search Terms.",
    formatExamples: "Amazon product listing, comparison page, affiliate buying guide or product-focused video.",
  },
  ebay: {
    name: "eBay Keyword Research",
    focus:
      "eBay listing keywords based on exact item names, brand, model, part number, compatibility, condition, size, color, material, year, rarity and collectible intent.",
    clusterGuidance:
      "Build clusters for exact item phrases, brand and model, condition, compatibility, part numbers, item specifics, replacement intent and collectible intent.",
    actionPackGuidance:
      "Create action packs named eBay Title Phrase Bank, Item Specifics and Compatibility or Condition Modifiers.",
    formatExamples: "eBay listing, parts listing, collectible listing, refurbished listing or auction listing.",
  },
};

const ALLOWED_PLATFORMS = Object.keys(PLATFORM_CONFIGS);

function cleanJsonText(text) {
  const raw = String(text ?? "").trim();
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("The AI response did not contain a JSON object.");
  }

  return withoutFence.slice(firstBrace, lastBrace + 1);
}

function quotaFromRow(row, fallbackLimit = 20) {
  const limit = Number(row?.daily_limit ?? fallbackLimit);
  const used = Number(row?.used_count ?? 0);

  return {
    used,
    limit,
    remaining: Math.max(0, Number(row?.remaining ?? limit - used)),
  };
}

async function releaseReservedSearch(adminClient, userId) {
  try {
    const { error } = await adminClient.rpc("release_keyword_search", {
      p_user_id: userId,
    });
    if (error) console.error("Could not release reserved search", error);
  } catch (error) {
    console.error("Could not release reserved search", error);
  }
}

function normalizeKeywordItem(item) {
  const keyword = normalizeText(item?.keyword, 140);
  if (!keyword) return null;

  return {
    keyword,
    intent: normalizeText(item?.intent || "Mixed", 40),
    funnelStage: normalizeText(item?.funnelStage || "Consideration", 40),
    competition: normalizeText(item?.competition || "Moderate", 30),
    priority: normalizeText(item?.priority || "Medium", 30),
    useCase: normalizeText(item?.useCase || "", 220),
  };
}

function normalizeResult(data, input) {
  const clusters = [];
  const seenKeywords = new Set();

  for (const rawCluster of Array.isArray(data?.keywordClusters) ? data.keywordClusters : []) {
    const keywords = [];

    for (const rawItem of Array.isArray(rawCluster?.keywords) ? rawCluster.keywords : []) {
      const item = normalizeKeywordItem(rawItem);
      if (!item) continue;

      const dedupeKey = item.keyword.toLowerCase();
      if (seenKeywords.has(dedupeKey)) continue;
      seenKeywords.add(dedupeKey);
      keywords.push(item);

      if (seenKeywords.size >= 50) break;
    }

    if (keywords.length) {
      clusters.push({
        clusterName: normalizeText(rawCluster?.clusterName || "Keyword cluster", 100),
        purpose: normalizeText(rawCluster?.purpose || "", 260),
        keywords,
      });
    }

    if (clusters.length >= 8 || seenKeywords.size >= 50) break;
  }

  const score = Math.max(0, Math.min(100, Number(data?.opportunityScore) || 0));
  let label = normalizeText(data?.opportunityLabel || "", 30);
  if (!label) {
    label = score >= 75 ? "Strong" : score >= 50 ? "Promising" : score >= 25 ? "Selective" : "Limited";
  }

  const actionPacks = (Array.isArray(data?.actionPacks) ? data.actionPacks : [])
    .slice(0, 6)
    .map((pack) => ({
      title: normalizeText(pack?.title || "Action pack", 100),
      items: (Array.isArray(pack?.items) ? pack.items : [])
        .slice(0, 20)
        .map((item) => normalizeText(item, 180))
        .filter(Boolean),
    }))
    .filter((pack) => pack.items.length);

  const supportingTerms = (Array.isArray(data?.supportingTerms) ? data.supportingTerms : [])
    .slice(0, 30)
    .map((item) => normalizeText(item, 100))
    .filter(Boolean);

  const avoidTerms = (Array.isArray(data?.avoidTerms) ? data.avoidTerms : [])
    .slice(0, 20)
    .map((item) => normalizeText(item, 140))
    .filter(Boolean);

  return {
    platform: input.platform,
    platformName: PLATFORM_CONFIGS[input.platform].name,
    keyword: input.keyword,
    country: input.country,
    language: input.language,
    researchGoal: input.researchGoal,
    dominantIntent: normalizeText(data?.dominantIntent || "Mixed", 50),
    opportunityScore: Math.round(score),
    opportunityLabel: label,
    researchSummary: normalizeText(data?.researchSummary || "", 900),
    recommendedFormat: normalizeText(data?.recommendedFormat || "", 220),
    titlePattern: normalizeText(data?.titlePattern || "", 360),
    descriptionGuidance: normalizeText(data?.descriptionGuidance || "", 700),
    quickWins: (Array.isArray(data?.quickWins) ? data.quickWins : [])
      .slice(0, 8)
      .map((item) => normalizeText(item, 240))
      .filter(Boolean),
    supportingTerms,
    avoidTerms,
    actionPacks,
    keywordClusters: clusters,
    totalKeywords: seenKeywords.size,
  };
}

async function recordSearch(adminClient, userId, result) {
  const snapshot = {
    platform: result.platform,
    platformName: result.platformName,
    researchGoal: result.researchGoal,
    dominantIntent: result.dominantIntent,
    opportunityScore: result.opportunityScore,
    opportunityLabel: result.opportunityLabel,
    totalKeywords: result.totalKeywords,
    recommendedFormat: result.recommendedFormat,
  };

  const payload = {
    user_id: userId,
    platform: result.platform,
    research_goal: result.researchGoal,
    keyword: result.keyword,
    country: result.country,
    language: result.language,
    competition_score: result.opportunityScore,
    competition_label: result.opportunityLabel,
    search_intent: result.dominantIntent,
    result_count: result.totalKeywords,
    result_snapshot: snapshot,
  };

  const { error } = await adminClient.from("search_history").insert(payload);
  if (error) console.error("Could not record search history", error);
}

function getAiErrorDetails(error) {
  const status = Number(
    error?.status || error?.code || error?.response?.status || 0
  );

  let message =
    error?.message ||
    error?.response?.data?.error?.message ||
    "Unknown AI API error";

  if (typeof message !== "string") {
    try {
      message = JSON.stringify(message);
    } catch {
      message = "Unknown AI API error";
    }
  }

  return {
    status: status || null,
    message: normalizeText(message, 900),
  };
}

function buildPrompt(input) {
  const config = PLATFORM_CONFIGS[input.platform];

  return `
You are a senior keyword research strategist specializing in ${config.name}.

Create platform-specific keyword research from the seed phrase below.

Platform: ${config.name}
Seed keyword or product/topic: ${JSON.stringify(input.keyword)}
Target country or market: ${JSON.stringify(input.country)}
Language: ${JSON.stringify(input.language)}
Research goal: ${JSON.stringify(input.researchGoal)}

Platform focus:
${config.focus}

Keyword-cluster instructions:
${config.clusterGuidance}

Action-pack instructions:
${config.actionPackGuidance}

Recommended-format examples:
${config.formatExamples}

Quality rules:
1. Match the vocabulary and search behavior of the selected platform.
2. Give practical long-tail terms, not repetitive word swaps.
3. Prioritize natural phrases a real searcher or buyer may type.
4. Separate keywords by intent and use case.
5. Do not claim exact search volume, CPC, sales, traffic, conversion rate or ranking position.
6. Use qualitative labels only for competition and priority.
7. Do not invent brand names, model numbers, trademarks or restricted claims unless they already appear in the seed phrase.
8. Avoid duplicate keywords across clusters.
9. Produce 25 to 45 useful keywords across 4 to 8 clusters.
10. Follow the requested research goal closely.
11. Return only valid JSON without markdown fences or commentary.

Use exactly this JSON structure:
{
  "dominantIntent": "Commercial",
  "opportunityScore": 72,
  "opportunityLabel": "Strong",
  "researchSummary": "A concise platform-specific explanation of the opportunity and keyword landscape.",
  "recommendedFormat": "Best content, listing or video format for this platform.",
  "titlePattern": "A reusable title pattern with placeholders.",
  "descriptionGuidance": "How to naturally use the keyword groups in the description, content or listing.",
  "quickWins": [
    "Specific quick-win recommendation"
  ],
  "supportingTerms": [
    "Relevant supporting term"
  ],
  "avoidTerms": [
    "Irrelevant, misleading or overly broad term to avoid"
  ],
  "actionPacks": [
    {
      "title": "Platform-specific action pack title",
      "items": ["Practical item"]
    }
  ],
  "keywordClusters": [
    {
      "clusterName": "Cluster name",
      "purpose": "How this cluster should be used on the selected platform.",
      "keywords": [
        {
          "keyword": "long-tail keyword phrase",
          "intent": "Commercial",
          "funnelStage": "Consideration",
          "competition": "Moderate",
          "priority": "High",
          "useCase": "Where and how to use this term."
        }
      ]
    }
  ]
}

Allowed qualitative values:
- intent: Informational, Commercial, Transactional, Navigational, Mixed
- funnelStage: Awareness, Consideration, Decision, Retention
- competition: Low, Moderate, High
- priority: Low, Medium, High
- opportunityLabel: Limited, Selective, Promising, Strong
`;
}

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Use POST for this endpoint." });
  }

  const auth = await authenticateRequest(req);
  if (auth.errorResponse) return auth.errorResponse;

  if (auth.profile.status !== "active") {
    return jsonResponse(403, {
      error: "Your account is suspended. Contact the administrator for access.",
    });
  }

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return jsonResponse(500, {
      error: "GEMINI_API_KEY is not configured in Netlify environment variables.",
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON request." });
  }

  const platform = normalizeText(body?.platform || "google", 20).toLowerCase();
  const keyword = normalizeText(body?.keyword, 120);
  const country = normalizeText(body?.country || "United States", 60);
  const language = normalizeText(body?.language || "English", 40);
  const researchGoal = normalizeText(body?.researchGoal || "Balanced keyword ideas", 100);

  if (!ALLOWED_PLATFORMS.includes(platform)) {
    return jsonResponse(400, { error: "Choose a supported keyword-research platform." });
  }

  if (keyword.length < 2 || keyword.length > 120) {
    return jsonResponse(400, {
      error: "Enter a seed keyword between 2 and 120 characters.",
    });
  }

  const { data: reservationData, error: reservationError } =
    await auth.userClient.rpc("reserve_keyword_search");

  if (reservationError) {
    console.error("Quota reservation failed", reservationError);
    return jsonResponse(500, {
      error: "Daily usage could not be checked. Run the supplied Supabase SQL setup.",
      detail: normalizeText(reservationError.message, 260),
    });
  }

  const reservation = Array.isArray(reservationData)
    ? reservationData[0]
    : reservationData;
  const quota = quotaFromRow(reservation, auth.profile.daily_limit);

  if (!reservation?.allowed) {
    return jsonResponse(429, {
      error: `Daily search limit reached. You can run ${quota.limit} keyword analyses per day.`,
      quota,
    });
  }

  const cacheKey = [
    platform,
    keyword.toLowerCase(),
    country.toLowerCase(),
    language.toLowerCase(),
    researchGoal.toLowerCase(),
  ].join("|");

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    const data = { ...cached.data, cached: true, quota };
    await recordSearch(auth.adminClient, auth.profile.id, data);
    return jsonResponse(200, data);
  }

  const model = String(
    process.env.GEMINI_MODEL || "gemini-3.1-flash-lite"
  ).trim();
  const useGeminiSearch = String(process.env.ENABLE_GEMINI_SEARCH || "false")
    .trim()
    .toLowerCase() === "true";

  const ai = new GoogleGenAI({ apiKey });
  const generationConfig = {
    temperature: 0.25,
    maxOutputTokens: 12000,
    responseMimeType: "application/json",
  };

  if (useGeminiSearch) {
    generationConfig.tools = [{ googleSearch: {} }];
  }

  let rawText;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: buildPrompt({
        platform,
        keyword,
        country,
        language,
        researchGoal,
      }),
      config: generationConfig,
    });

    rawText = response.text;
    if (!rawText) throw new Error("The AI model returned an empty response.");
  } catch (error) {
    console.error("AI request failed", error);
    await releaseReservedSearch(auth.adminClient, auth.profile.id);

    const aiError = getAiErrorDetails(error);
    return jsonResponse(502, {
      error:
        `AI API failed${aiError.status ? ` (${aiError.status})` : ""}: ` +
        aiError.message,
      detail: aiError.message,
      aiStatus: aiError.status,
      model,
      platform,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(cleanJsonText(rawText));
  } catch (error) {
    console.error("AI JSON parse failed", { rawText, error });
    await releaseReservedSearch(auth.adminClient, auth.profile.id);

    return jsonResponse(502, {
      error: "The AI returned an unexpected response format. Run the research again.",
      detail: normalizeText(error?.message || "Invalid JSON response.", 500),
      rawPreview: normalizeText(rawText, 900),
      model,
      platform,
    });
  }

  const normalized = normalizeResult(parsed, {
    platform,
    keyword,
    country,
    language,
    researchGoal,
  });

  if (!normalized.totalKeywords) {
    await releaseReservedSearch(auth.adminClient, auth.profile.id);
    return jsonResponse(502, {
      error: "The AI did not return any usable keyword ideas.",
      detail: "Try a clearer seed phrase or select a different research goal.",
      model,
      platform,
    });
  }

  normalized.generatedAt = new Date().toISOString();
  normalized.methodology = useGeminiSearch
    ? "Platform-specific keyword research generated with the configured AI model and optional web grounding. Search behavior and marketplace demand can change over time."
    : "Platform-specific keyword research generated from the seed phrase, market, language and selected goal. No exact search-volume or sales figures are claimed.";
  normalized.researchMode = useGeminiSearch ? "AI + web grounding" : "AI keyword modeling";
  normalized.cached = false;

  cache.set(cacheKey, {
    createdAt: Date.now(),
    data: normalized,
  });

  await recordSearch(auth.adminClient, auth.profile.id, normalized);

  return jsonResponse(200, {
    ...normalized,
    quota,
  });
};

export const config = {
  path: "/api/analyze",
};
