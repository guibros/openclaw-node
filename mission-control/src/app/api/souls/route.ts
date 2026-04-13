import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

const SOULS_DIR = path.join(os.homedir(), ".openclaw/souls");
const REGISTRY_PATH = path.join(SOULS_DIR, "registry.json");

interface Soul {
  id: string;
  type: string;
  basePath: string;
  capabilities: {
    skills: string[];
    tools: string[];
    mcpServers: string[];
  };
  specializations: string[];
  evolutionEnabled: boolean;
  parentSoul: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SoulRegistry {
  version: string;
  souls: Soul[];
}

async function loadRegistry(): Promise<SoulRegistry> {
  try {
    const content = await fs.readFile(REGISTRY_PATH, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    // If registry doesn't exist, return empty registry
    return { version: "1.0.0", souls: [] };
  }
}

async function saveRegistry(registry: SoulRegistry): Promise<void> {
  await fs.mkdir(SOULS_DIR, { recursive: true });
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

// GET /api/souls - List all souls
// GET /api/souls?id=soul-id - Get specific soul
export async function GET(request: NextRequest) {
  try {
    const registry = await loadRegistry();
    const { searchParams } = new URL(request.url);
    const soulId = searchParams.get("id");

    if (soulId) {
      const soul = registry.souls.find((s) => s.id === soulId);
      if (!soul) {
        return NextResponse.json({ error: "Soul not found" }, { status: 404 });
      }
      return NextResponse.json(soul);
    }

    return NextResponse.json(registry.souls);
  } catch (error) {
    console.error("Failed to load souls:", error);
    return NextResponse.json(
      { error: "Failed to load souls" },
      { status: 500 }
    );
  }
}

// POST /api/souls - Register new soul
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const registry = await loadRegistry();

    // Check if soul already exists
    if (registry.souls.find((s) => s.id === body.id)) {
      return NextResponse.json(
        { error: "Soul already exists" },
        { status: 409 }
      );
    }

    const newSoul: Soul = {
      ...body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registry.souls.push(newSoul);
    await saveRegistry(registry);

    return NextResponse.json(newSoul, { status: 201 });
  } catch (error) {
    console.error("Failed to register soul:", error);
    return NextResponse.json(
      { error: "Failed to register soul" },
      { status: 500 }
    );
  }
}

// PATCH /api/souls?id=soul-id - Update soul
export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const soulId = searchParams.get("id");

    if (!soulId) {
      return NextResponse.json(
        { error: "Soul ID required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const registry = await loadRegistry();
    const soulIndex = registry.souls.findIndex((s) => s.id === soulId);

    if (soulIndex === -1) {
      return NextResponse.json({ error: "Soul not found" }, { status: 404 });
    }

    registry.souls[soulIndex] = {
      ...registry.souls[soulIndex],
      ...body,
      updatedAt: new Date().toISOString(),
    };

    await saveRegistry(registry);

    return NextResponse.json(registry.souls[soulIndex]);
  } catch (error) {
    console.error("Failed to update soul:", error);
    return NextResponse.json(
      { error: "Failed to update soul" },
      { status: 500 }
    );
  }
}

// DELETE /api/souls?id=soul-id - Delete soul
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const soulId = searchParams.get("id");

    if (!soulId) {
      return NextResponse.json(
        { error: "Soul ID required" },
        { status: 400 }
      );
    }

    const registry = await loadRegistry();
    const filtered = registry.souls.filter((s) => s.id !== soulId);

    if (filtered.length === registry.souls.length) {
      return NextResponse.json({ error: "Soul not found" }, { status: 404 });
    }

    registry.souls = filtered;
    await saveRegistry(registry);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete soul:", error);
    return NextResponse.json(
      { error: "Failed to delete soul" },
      { status: 500 }
    );
  }
}
