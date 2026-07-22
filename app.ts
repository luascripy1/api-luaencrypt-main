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
