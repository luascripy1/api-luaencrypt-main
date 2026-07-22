// Inlined Zod schemas
// Updated to include all property types (ref, NumberSequence, ColorSequence, NumberRange)
// and the instance `id` field used for cross-reference wiring.
// v2: Added asset search schemas.
import * as zod from "zod";

export const HealthCheckResponse = zod.object({
  status: zod.string(),
});

// ── Engine: load ───────────────────────────────────────────────────────────

export const engineLoadBodyAssetIdRegExp = /^[0-9]+$/;

export const EngineLoadBody = zod.object({
  assetId: zod
    .string()
    .regex(engineLoadBodyAssetIdRegExp)
    .describe("Numeric Roblox asset/model ID, as a string"),
  includeScripts: zod
    .boolean()
    .default(false)
    .describe(
      "Reserved for future use. Scripts are always stripped regardless of this flag.",
    ),
});

// Recursive instance node — children are typed as unknown at the zod level
// to avoid deep recursive schema definitions; the TypeScript type is precise.
const EnginePropertyValue = zod
  .object({
    t: zod.enum([
      "string",
      "bool",
      "number",
      "Vector2",
      "Vector3",
      "Color3",
      "CFrame",
      "enum",
      "ref",
      "NumberSequence",
      "ColorSequence",
      "NumberRange",
    ]),
    v: zod.unknown().optional(),
    // enum fields
    category: zod.string().optional(),
    name: zod.string().optional(),
    // ref field
    id: zod.number().int().optional(),
  })
  .describe("A single tagged instance property value");

export const EngineLoadResponse = zod.object({
  modelName: zod.string(),
  model: zod
    .object({
      id: zod.number().int(),
      className: zod.string(),
      name: zod.string(),
      properties: zod.record(zod.string(), EnginePropertyValue),
      children: zod.array(zod.unknown()),
    })
    .describe("A single reconstructable Roblox instance node"),
  instanceCount: zod.number(),
  scriptCount: zod.number(),
});

export type EngineLoadBodyType = zod.infer<typeof EngineLoadBody>;

// ── Engine: search ─────────────────────────────────────────────────────────

export const AssetSearchQuery = zod.object({
  q: zod.string().min(1).max(120).describe("Search keyword"),
  limit: zod.coerce.number().int().min(1).max(30).default(24),
  cursor: zod.string().optional(),
  sort: zod
    .enum(["Relevance", "MostFavorited", "RecentlyUpdated", "Bestseller"])
    .default("Relevance"),
  creator: zod.string().max(60).optional(),
});

const AssetCreator = zod.object({
  name: zod.string(),
  type: zod.string(),
  id: zod.number(),
});

const AssetSearchItem = zod.object({
  id: zod.string().describe("Numeric asset ID as string"),
  name: zod.string(),
  description: zod.string(),
  creator: AssetCreator,
  favoriteCount: zod.number(),
  thumbnail: zod.string().nullable().describe("CDN thumbnail URL or null"),
});

export const AssetSearchResponse = zod.object({
  keyword: zod.string(),
  assets: zod.array(AssetSearchItem),
  nextCursor: zod.string().nullable(),
  previousCursor: zod.string().nullable(),
  total: zod.number(),
});

export type AssetSearchQueryType = zod.infer<typeof AssetSearchQuery>;
export type AssetSearchItemType = zod.infer<typeof AssetSearchItem>;
export type AssetSearchResponseType = zod.infer<typeof AssetSearchResponse>;
