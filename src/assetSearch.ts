/**
 * Roblox Asset Search
 *
 * Queries the Roblox Catalog API for Model assets (category 6),
 * then batch-fetches thumbnails from the Thumbnails API.
 * All endpoints are public — no authentication required.
 */

const CATALOG_SEARCH_URL = "https://catalog.roblox.com/v1/search/items/details";
const THUMBNAILS_URL = "https://thumbnails.roblox.com/v1/assets";

// Maps user-friendly sort names to Roblox sortType numbers
const SORT_TYPE: Record<string, number> = {
  Relevance: 0,
  MostFavorited: 5,
  RecentlyUpdated: 4,
  Bestseller: 1,
};

/** Round user-requested limit to the nearest valid Roblox catalog page size (10, 28, 30) */
function toValidLimit(requested: number): 10 | 28 | 30 {
  if (requested <= 10) return 10;
  if (requested <= 28) return 28;
  return 30;
}

export interface AssetSearchOptions {
  keyword: string;
  limit?: number;
  cursor?: string;
  sort?: keyof typeof SORT_TYPE;
  creatorName?: string;
}

export interface AssetSearchItem {
  id: string;
  name: string;
  description: string;
  creator: {
    name: string;
    type: string;
    id: number;
  };
  favoriteCount: number;
  thumbnail: string | null;
}

export interface AssetSearchResult {
  keyword: string;
  assets: AssetSearchItem[];
  nextCursor: string | null;
  previousCursor: string | null;
  total: number;
}

export class AssetSearchError extends Error {}

// ── Internal Roblox API types ─────────────────────────────────────────────

interface RobloxCatalogItem {
  id: number;
  name: string;
  description?: string;
  creatorName?: string;
  creatorType?: string;
  creatorTargetId?: number;
  favoriteCount?: number;
}

interface RobloxCatalogResponse {
  keyword?: string;
  data: RobloxCatalogItem[];
  nextPageCursor?: string | null;
  previousPageCursor?: string | null;
  totalResults?: number;
}

interface RobloxThumbnailEntry {
  targetId: number;
  state: string;
  imageUrl?: string;
}

interface RobloxThumbnailResponse {
  data: RobloxThumbnailEntry[];
}

// ── Thumbnail batch fetch ─────────────────────────────────────────────────

async function fetchThumbnails(
  assetIds: number[],
): Promise<Record<number, string>> {
  if (assetIds.length === 0) return {};

  const params = new URLSearchParams({
    assetIds: assetIds.join(","),
    format: "Png",
    size: "150x150",
  });

  let response: Response;
  try {
    response = await fetch(`${THUMBNAILS_URL}?${params}`);
  } catch {
    // Thumbnail failures are non-fatal — we just return empty map
    return {};
  }

  if (!response.ok) return {};

  const json = (await response.json()) as RobloxThumbnailResponse;
  const map: Record<number, string> = {};
  for (const entry of json.data ?? []) {
    if (entry.state === "Completed" && entry.imageUrl) {
      map[entry.targetId] = entry.imageUrl;
    }
  }
  return map;
}

// ── Main search function ──────────────────────────────────────────────────

export async function searchAssets(
  options: AssetSearchOptions,
): Promise<AssetSearchResult> {
  const {
    keyword,
    limit = 24,
    cursor,
    sort = "Relevance",
    creatorName,
  } = options;

  const pageSize = toValidLimit(limit ?? 10);
  const sortType = SORT_TYPE[sort] ?? 0;

  // Roblox Catalog API v1 uses PascalCase for Category/Keyword
  const params = new URLSearchParams({
    Category: "6", // 6 = Models/Gear category
    Keyword: keyword,
    limit: String(pageSize),
    sortType: String(sortType),
    sortAggregation: "5",
  });
  if (cursor) params.set("cursor", cursor);
  if (creatorName) params.set("creatorName", creatorName);

  let response: Response;
  try {
    response = await fetch(`${CATALOG_SEARCH_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    throw new AssetSearchError(
      "Could not reach Roblox Catalog API. Check your internet connection.",
    );
  }

  if (response.status === 429) {
    throw new AssetSearchError(
      "Roblox rate-limit reached — please wait a moment and try again.",
    );
  }

  if (!response.ok) {
    throw new AssetSearchError(
      `Roblox Catalog API returned HTTP ${response.status}.`,
    );
  }

  const catalog = (await response.json()) as RobloxCatalogResponse;
  const items: RobloxCatalogItem[] = catalog.data ?? [];

  // Batch-fetch thumbnails for all result IDs
  const ids = items.map((item) => item.id);
  const thumbnails = await fetchThumbnails(ids);

  const assets: AssetSearchItem[] = items.map((item) => ({
    id: String(item.id),
    name: item.name ?? "Unknown",
    description: item.description ?? "",
    creator: {
      name: item.creatorName ?? "Unknown",
      type: item.creatorType ?? "User",
      id: item.creatorTargetId ?? 0,
    },
    favoriteCount: item.favoriteCount ?? 0,
    thumbnail: thumbnails[item.id] ?? null,
  }));

  return {
    keyword,
    assets,
    nextCursor: catalog.nextPageCursor ?? null,
    previousCursor: catalog.previousPageCursor ?? null,
    total: catalog.totalResults ?? assets.length,
  };
}
