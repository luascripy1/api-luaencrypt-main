/**
 * Roblox Asset Search
 *
 * Queries the Roblox Toolbox Service API — the SAME API that Roblox Studio's
 * built-in Toolbox panel uses for the "Models" tab. Results are environment
 * models (trees, buildings, props, etc.), NOT avatar accessories/costumes.
 *
 * Bug yang diperbaiki:
 *   ❌ Sebelumnya pakai catalog.roblox.com dengan Category=6 (Gear/avatar)
 *   ✅ Sekarang pakai apis.roblox.com/toolbox-service/v1/search?category=Models
 *
 * Thumbnail sudah ter-include dalam response toolbox-service,
 * tidak perlu fetch terpisah ke thumbnails.roblox.com.
 */

// Endpoint resmi Roblox Studio Toolbox (bukan Avatar Catalog)
const TOOLBOX_SEARCH_URL =
  "https://apis.roblox.com/toolbox-service/v1/search";

// Maps user-friendly sort names to Roblox toolbox sort values
const SORT_TYPE: Record<string, string> = {
  Relevance: "Relevance",
  MostFavorited: "MostFavorited",
  RecentlyUpdated: "RecentlyUpdated",
  Bestseller: "Bestseller",
};

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

// ── Internal Roblox Toolbox API types ────────────────────────────────────

interface ToolboxAsset {
  id: number;
  name: string;
  description?: string;
  typeId?: number;
  assetType?: { id: number; name: string };
  creator?: {
    id: number;
    name: string;
    type: number; // 1 = User, 2 = Group
  };
  stats?: {
    favoriteCount?: number;
  };
}

interface ToolboxThumbnail {
  final: boolean;
  url?: string;
  retry?: boolean;
}

interface ToolboxResult {
  asset: ToolboxAsset;
  thumbnail?: ToolboxThumbnail;
}

interface ToolboxSearchResponse {
  results: ToolboxResult[];
  nextPageCursor?: string | null;
  previousPageCursor?: string | null;
  totalResults?: number;
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

  const clampedLimit = Math.min(Math.max(1, limit), 30);
  const sortValue = SORT_TYPE[sort] ?? "Relevance";

  // Roblox Toolbox Service API — category=Models menghasilkan 3D environment
  // models (pohon, bangunan, prop), BUKAN avatar accessories/kostum
  const params = new URLSearchParams({
    category: "Models",      // ← Toolbox "Models" tab
    keyword: keyword,
    limit: String(clampedLimit),
    sort: sortValue,
  });
  if (cursor) params.set("cursor", cursor);
  if (creatorName) params.set("creatorName", creatorName);

  let response: Response;
  try {
    response = await fetch(`${TOOLBOX_SEARCH_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    throw new AssetSearchError(
      "Could not reach Roblox Toolbox API. Check your internet connection.",
    );
  }

  if (response.status === 429) {
    throw new AssetSearchError(
      "Roblox rate-limit reached — please wait a moment and try again.",
    );
  }

  if (!response.ok) {
    throw new AssetSearchError(
      `Roblox Toolbox API returned HTTP ${response.status}.`,
    );
  }

  const data = (await response.json()) as ToolboxSearchResponse;
  const results: ToolboxResult[] = data.results ?? [];

  const assets: AssetSearchItem[] = results.map((entry) => {
    const asset = entry.asset;
    const thumbnail = entry.thumbnail;

    // Toolbox service type: 1 = User, 2 = Group
    const creatorTypeName =
      asset.creator?.type === 2 ? "Group" : "User";

    return {
      id: String(asset.id),
      name: asset.name ?? "Unknown",
      description: asset.description ?? "",
      creator: {
        name: asset.creator?.name ?? "Unknown",
        type: creatorTypeName,
        id: asset.creator?.id ?? 0,
      },
      favoriteCount: asset.stats?.favoriteCount ?? 0,
      // Thumbnail sudah ada di response, tidak perlu fetch terpisah
      thumbnail:
        thumbnail?.final && thumbnail.url ? thumbnail.url : null,
    };
  });

  return {
    keyword,
    assets,
    nextCursor: data.nextPageCursor ?? null,
    previousCursor: data.previousPageCursor ?? null,
    total: data.totalResults ?? assets.length,
  };
}

