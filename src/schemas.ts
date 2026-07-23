// Inlined Zod schemas for Roblox Toolbox Engine
// v3: Search now uses official Roblox Toolbox Service API
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
    .describe("Reserved for future use. Scripts are always stripped."),
});

const EnginePropertyValue = zod
  .object({
    t: zod.enum([
      "string", "bool", "number",
      "Vector2", "Vector3", "Color3", "CFrame",
      "enum", "ref", "NumberSequence", "ColorSequence", "NumberRange",
    ]),
    v: zod.unknown().optional(),
    category: zod.string().optional(),
    name: zod.string().optional(),
    id: zod.number().int().optional(),
  });

export const EngineLoadResponse = zod.object({
  modelName: zod.string(),
  model: zod.object({
    id: zod.number().int(),
    className: zod.string(),
    name: zod.string(),
    properties: zod.record(zod.string(), EnginePropertyValue),
    children: zod.array(zod.unknown()),
  }),
  instanceCount: zod.number(),
  scriptCount: zod.number(),
});

export type EngineLoadBodyType = zod.infer<typeof EngineLoadBody>;

// ── Engine: search ─────────────────────────────────────────────────────────

export const AssetSearchQuery = zod.object({
  q: zod.string().min(1).max(120),
  limit: zod.coerce.number().int().min(1).max(28).default(10),
  cursor: zod.string().optional(),
  sort: zod
    .enum(["Relevance", "MostFavorited", "RecentlyCreated", "Updated", "AllTime"])
    .default("Relevance"),
  assetType: zod
    .enum(["Model", "Decal", "Audio", "Plugin", "MeshPart"])
    .default("Model"),
});

const AssetCreator = zod.object({
  name: zod.string(),
  type: zod.enum(["User", "Group"]),
  id: zod.number(),
  isVerified: zod.boolean(),
});

const AssetSearchItem = zod.object({
  id: zod.string(),
  name: zod.string(),
  description: zod.string(),
  creator: AssetCreator,
  upVotes: zod.number(),
  downVotes: zod.number(),
  hasScripts: zod.boolean(),
  thumbnail: zod.null(),
});

export const AssetSearchResponse = zod.object({
  keyword: zod.string(),
  assetType: zod.string(),
  assets: zod.array(AssetSearchItem),
  nextCursor: zod.string().nullable(),
  previousCursor: zod.null(),
  total: zod.number(),
});

export type AssetSearchQueryType = zod.infer<typeof AssetSearchQuery>;
export type AssetSearchItemType = zod.infer<typeof AssetSearchItem>;
export type AssetSearchResponseType = zod.infer<typeof AssetSearchResponse>;
