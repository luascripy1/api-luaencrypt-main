// Converts a parsed Roblox asset (via rbxm-parser) into a plain JSON tree
// that a Roblox game script can walk and rebuild with Instance.new().
//
// Every property is tagged with its Roblox data type ({ t, v }) so the
// client never has to guess a value's shape.
//
// Script-bearing classes (Script/LocalScript/ModuleScript/CoreScript) are
// dropped entirely on the server. We never ship script source to the game,
// regardless of what the client-side whitelist also enforces.
//
// Each instance node carries a numeric `id` so the Lua reconstruction script
// can wire up cross-instance reference properties (Beam.Attachment0/1,
// Weld.Part0/1, Motor6D.Part0/1, etc.) in a second pass after the full tree
// is built — solving the "gambar gerak" / Beam pattern where endpoints are
// siblings in the tree rather than children of the referencing instance.

import { CoreInstance, DataType, RobloxFile } from "rbxm-parser";

const ASSET_DELIVERY_URL = "https://assetdelivery.roblox.com/v1/asset/";

export class EngineFetchError extends Error {}

/**
 * Downloads the raw asset bytes for a public/free Roblox model asset.
 * Throws EngineFetchError with a message safe to surface to the caller.
 */
export async function fetchAssetBuffer(assetId: string): Promise<Buffer> {
  const cookie = process.env.ROBLOX_COOKIE;
  let response: Response;
  try {
    response = await fetch(`${ASSET_DELIVERY_URL}?id=${assetId}`, {
      headers: {
        Accept: "application/octet-stream",
        ...(cookie ? { Cookie: `.ROBLOSECURITY=${cookie}` } : {}),
      },
      redirect: "follow",
    });
  } catch {
    throw new EngineFetchError("Could not reach Roblox asset delivery.");
  }

  if (response.status === 404) {
    throw new EngineFetchError("Asset not found.");
  }
  if (response.status === 401) {
    throw new EngineFetchError(
      cookie
        ? "Roblox rejected the configured authentication cookie (401) — it may be expired or invalid."
        : "Roblox requires authentication to access this asset — no ROBLOX_COOKIE is configured.",
    );
  }
  if (response.status === 403) {
    throw new EngineFetchError(
      "Asset is private, moderated, or not free — it cannot be fetched.",
    );
  }
  if (!response.ok) {
    throw new EngineFetchError(`Roblox returned HTTP ${response.status}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  const magic = buffer.subarray(0, 8).toString("latin1");
  if (magic.startsWith("<roblox ")) {
    throw new EngineFetchError(
      "Asset is stored in XML (.rbxmx) format, which this engine cannot parse yet — only binary (.rbxm) assets are supported.",
    );
  }
  if (!magic.startsWith("<roblox!")) {
    throw new EngineFetchError(
      "Asset ID did not return a Roblox model file.",
    );
  }

  return buffer;
}

/**
 * Parses raw .rbxm bytes into a RobloxFile. Throws EngineFetchError if the
 * buffer is not a valid/parseable Roblox binary model.
 */
export function parseAssetBuffer(buffer: Buffer): RobloxFile {
  const file = RobloxFile.ReadFromBuffer(buffer);
  if (!file) {
    throw new EngineFetchError(
      "Roblox file could not be parsed — it may be corrupt or an unsupported format.",
    );
  }
  return file;
}

const SCRIPT_CLASSES = new Set([
  "Script",
  "LocalScript",
  "ModuleScript",
  "CoreScript",
]);

export interface EnginePropertyValueJson {
  t:
    | "string"
    | "bool"
    | "number"
    | "Vector2"
    | "Vector3"
    | "Color3"
    | "CFrame"
    | "enum"
    | "ref"
    | "NumberSequence"
    | "ColorSequence"
    | "NumberRange";
  v?: unknown;
  category?: string;
  name?: string;
  id?: number;
}

export interface EngineInstanceNodeJson {
  id: number;
  className: string;
  name: string;
  properties: Record<string, EnginePropertyValueJson>;
  children: EngineInstanceNodeJson[];
}

export interface ConvertedAsset {
  root: EngineInstanceNodeJson;
  instanceCount: number;
  scriptCount: number;
}

/**
 * Walk every instance in the file and assign a unique integer ID.
 * Must run before convertInstance so Referent properties can look up targets
 * that haven't been converted yet (e.g. Beam.Attachment1 points to an
 * Attachment that lives under a sibling Part, converted after the Beam).
 */
function assignIds(
  instance: CoreInstance,
  map: Map<CoreInstance, number>,
  counter: { n: number },
): void {
  map.set(instance, counter.n++);
  for (const child of instance.Children) {
    assignIds(child as CoreInstance, map, counter);
  }
}

function convertProperty(
  propName: string,
  value: { type: DataType; value: unknown },
  idMap: Map<CoreInstance, number>,
): EnginePropertyValueJson | undefined {
  switch (value.type) {
    case DataType.String:
      return { t: "string", v: value.value as string };
    case DataType.Bool:
      return { t: "bool", v: value.value as boolean };
    case DataType.Int32:
    case DataType.Float32:
    case DataType.Float64:
      return { t: "number", v: value.value as number };
    case DataType.Int64:
      return { t: "number", v: Number(value.value as bigint) };
    case DataType.Vector2: {
      const v = value.value as { X: number; Y: number };
      return { t: "Vector2", v: [v.X, v.Y] };
    }
    case DataType.Vector3:
    case DataType.Vector3int16: {
      const v = value.value as { X: number; Y: number; Z: number };
      return { t: "Vector3", v: [v.X, v.Y, v.Z] };
    }
    case DataType.Color3:
    case DataType.Color3uint8: {
      const v = value.value as { R: number; G: number; B: number };
      return {
        t: "Color3",
        v: [
          Math.round(v.R * 255),
          Math.round(v.G * 255),
          Math.round(v.B * 255),
        ],
      };
    }
    case DataType.CFrame: {
      const cf = value.value as {
        Position: { X: number; Y: number; Z: number };
        Orientation: number[];
      };
      return {
        t: "CFrame",
        v: [
          cf.Position.X,
          cf.Position.Y,
          cf.Position.Z,
          ...cf.Orientation,
        ],
      };
    }
    case DataType.Enum: {
      const v = value.value as { EnumType?: { Name?: string }; Name: string };
      const category = v.EnumType?.Name;
      if (!category) return undefined;
      return { t: "enum", category, name: v.Name };
    }
    case DataType.Referent: {
      const target = value.value as CoreInstance | null;
      if (!target) return undefined;
      const id = idMap.get(target);
      if (id === undefined) return undefined;
      return { t: "ref", id };
    }
    case DataType.NumberSequence: {
      const ns = value.value as {
        Keypoints: Array<{ Time: number; Value: number; Envelope: number }>;
      };
      return {
        t: "NumberSequence",
        v: ns.Keypoints.map((k) => [k.Time, k.Value, k.Envelope]),
      };
    }
    case DataType.ColorSequence: {
      const cs = value.value as {
        Keypoints: Array<{
          Time: number;
          Color: { R: number; G: number; B: number };
        }>;
      };
      return {
        t: "ColorSequence",
        v: cs.Keypoints.map((k) => [
          k.Time,
          Math.round(k.Color.R * 255),
          Math.round(k.Color.G * 255),
          Math.round(k.Color.B * 255),
        ]),
      };
    }
    case DataType.NumberRange: {
      const nr = value.value as { Min: number; Max: number };
      return { t: "NumberRange", v: [nr.Min, nr.Max] };
    }
    default:
      return undefined;
  }
}

function convertInstance(
  instance: CoreInstance,
  idMap: Map<CoreInstance, number>,
): {
  node: EngineInstanceNodeJson | null;
  instanceCount: number;
  scriptCount: number;
} {
  if (SCRIPT_CLASSES.has(instance.ClassName)) {
    return { node: null, instanceCount: 0, scriptCount: 1 };
  }

  const properties: Record<string, EnginePropertyValueJson> = {};
  for (const [propName, rawValue] of instance.Props) {
    if (propName === "Parent" || propName === "RobloxLocked") continue;
    const converted = convertProperty(propName, rawValue, idMap);
    if (converted) properties[propName] = converted;
  }
  if (!properties.Name) {
    properties.Name = { t: "string", v: instance.Name };
  }

  const children: EngineInstanceNodeJson[] = [];
  let instanceCount = 1;
  let scriptCount = 0;

  for (const child of instance.Children) {
    const result = convertInstance(child as CoreInstance, idMap);
    instanceCount += result.instanceCount;
    scriptCount += result.scriptCount;
    if (result.node) children.push(result.node);
  }

  return {
    node: {
      id: idMap.get(instance)!,
      className: instance.ClassName,
      name: instance.Name,
      properties,
      children,
    },
    instanceCount,
    scriptCount,
  };
}

export function convertAssetToJson(
  file: RobloxFile,
  fallbackName: string,
): ConvertedAsset {
  const topLevel = file.Roots as readonly CoreInstance[];

  const idMap = new Map<CoreInstance, number>();
  const counter = { n: 0 };
  for (const inst of topLevel) {
    assignIds(inst, idMap, counter);
  }

  let instanceCount = 0;
  let scriptCount = 0;
  const children: EngineInstanceNodeJson[] = [];

  for (const instance of topLevel) {
    const result = convertInstance(instance, idMap);
    instanceCount += result.instanceCount;
    scriptCount += result.scriptCount;
    if (result.node) children.push(result.node);
  }

  if (children.length === 1 && children[0].className === "Model") {
    return { root: children[0], instanceCount, scriptCount };
  }

  return {
    root: {
      id: -1,
      className: "Model",
      name: fallbackName,
      properties: { Name: { t: "string", v: fallbackName } },
      children,
    },
    instanceCount,
    scriptCount,
  };
}
