import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import {
  EngineLoadBody,
  EngineLoadResponse,
  HealthCheckResponse,
  AssetSearchQuery,
  AssetSearchResponse,
} from "./schemas.js";
import {
  EngineFetchError,
  fetchAssetBuffer,
  parseAssetBuffer,
  convertAssetToJson,
} from "./robloxEngine.js";
import { searchAssets, AssetSearchError } from "./assetSearch.js";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────────────────
app.get("/api/healthz", (_req: Request, res: Response) => {
  res.json(HealthCheckResponse.parse({ status: "ok" }));
});

// ── Debug: diagnose search config & Roblox connectivity ──────────────────
app.get("/api/debug/search", async (_req: Request, res: Response) => {
  const cookie = process.env.ROBLOX_COOKIE;

  const cookieStatus = !cookie
    ? "NOT SET"
    : cookie.length < 20
    ? "SET BUT TOO SHORT (possibly wrong value)"
    : `SET (${cookie.length} chars, starts: ${cookie.slice(0, 6)}...)`;

  // Test the actual Roblox endpoint with the cookie
  let robloxStatus: number | string = "not tested";
  let robloxBody = "";
  if (cookie) {
    try {
      const resp = await fetch(
        "https://apis.roblox.com/toolbox-service/v1/search?category=Models&keyword=tree&limit=5&sort=Relevance",
        {
          headers: {
            Accept: "application/json",
            Cookie: `.ROBLOSECURITY=${cookie}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        }
      );
      robloxStatus = resp.status;
      const txt = await resp.text();
      robloxBody = txt.slice(0, 300);
    } catch (e) {
      robloxStatus = "FETCH ERROR";
      robloxBody = String(e);
    }
  }

  res.json({
    cookieEnvVar: cookieStatus,
    robloxEndpoint: "apis.roblox.com/toolbox-service/v1/search",
    robloxHttpStatus: robloxStatus,
    robloxResponsePreview: robloxBody,
    note: "200 = working | 401 = cookie invalid/expired | 403 = blocked | 404 = wrong URL",
  });
});

// ── Engine: load asset ────────────────────────────────────────────────────
/**
 * POST /api/engine/load
 * Body: { assetId: "12345678" }
 *
 * Downloads, parses, and returns the asset's instance tree as JSON.
 */
app.post("/api/engine/load", async (req: Request, res: Response): Promise<void> => {
  const parsed = EngineLoadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { assetId } = parsed.data;

  try {
    console.log(`[Engine] Loading asset ${assetId}`);

    const buffer = await fetchAssetBuffer(assetId);
    const file = parseAssetBuffer(buffer);
    const { root, instanceCount, scriptCount } = convertAssetToJson(
      file,
      `Asset_${assetId}`,
    );

    console.log(`[Engine] Asset ${assetId} → ${instanceCount} instances, ${scriptCount} scripts blocked`);

    res.json(
      EngineLoadResponse.parse({
        modelName: root.name || `Asset_${assetId}`,
        model: root,
        instanceCount,
        scriptCount,
      }),
    );
  } catch (err) {
    if (err instanceof EngineFetchError) {
      console.warn(`[Engine] Load failed for ${assetId}: ${err.message}`);
      res.status(502).json({ error: err.message });
      return;
    }
    console.error(`[Engine] Unexpected error for ${assetId}:`, err);
    res.status(502).json({ error: "Unexpected error loading asset." });
  }
});

// ── Engine: search assets ─────────────────────────────────────────────────
/**
 * GET /api/engine/search
 *
 * Searches Roblox Model assets via the public Catalog API and returns
 * results with thumbnails — identical in shape to a Roblox toolbox search.
 *
 * Query params:
 *   q        — keyword (required)
 *   limit    — 1–30, default 24
 *   cursor   — pagination cursor from a previous response
 *   sort     — Relevance | MostFavorited | RecentlyUpdated | Bestseller
 *   creator  — filter by creator username (optional)
 *
 * Response:
 * {
 *   "keyword": "sword",
 *   "total": 352,
 *   "nextCursor": "...",
 *   "previousCursor": null,
 *   "assets": [
 *     {
 *       "id": "1234567",
 *       "name": "Epic Sword",
 *       "description": "...",
 *       "creator": { "name": "BuilderPro", "type": "User", "id": 98765 },
 *       "favoriteCount": 4200,
 *       "thumbnail": "https://tr.rbxcdn.com/..."
 *     }
 *   ]
 * }
 */
app.get("/api/engine/search", async (req: Request, res: Response): Promise<void> => {
  const parsed = AssetSearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { q, limit, cursor, sort, creator } = parsed.data;

  try {
    console.log(`[Search] keyword="${q}" limit=${limit} sort=${sort}`);

    const result = await searchAssets({
      keyword: q,
      limit,
      cursor,
      sort,
      creatorName: creator,
    });

    console.log(`[Search] keyword="${q}" → ${result.assets.length} results`);

    res.json(AssetSearchResponse.parse(result));
  } catch (err) {
    if (err instanceof AssetSearchError) {
      console.warn(`[Search] Failed for "${q}": ${(err as Error).message}`);
      res.status(502).json({ error: (err as Error).message });
      return;
    }
    console.error(`[Search] Unexpected error for "${q}":`, err);
    res.status(502).json({ error: "Unexpected error searching assets." });
  }
});

export default app;

