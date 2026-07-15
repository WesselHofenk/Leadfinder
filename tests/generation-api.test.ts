import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runId = "cmrlz4csu0000l6046xanxs8s";
const pendingRun = { id: runId, status: "PENDING", progress: 2 };

const { generation, findFirst } = vi.hoisted(() => ({
  generation: {
    cancelGenerationRun: vi.fn(),
    createGenerationRun: vi.fn(),
    latestGenerationRun: vi.fn(),
    markStaleGenerationRuns: vi.fn(),
    processGenerationBatch: vi.fn(),
  },
  findFirst: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ currentUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/jobs/generation", () => generation);
vi.mock("@/lib/prisma", () => ({ prisma: { generationRun: { findFirst } } }));
vi.mock("@/lib/security/request", () => ({ hasValidOrigin: vi.fn(() => true), rateLimit: vi.fn(() => true), requestIp: vi.fn(() => "127.0.0.1") }));

import { DELETE, GET, PATCH, POST } from "@/app/api/generation/route";

function request(method: string, body?: unknown) {
  return new NextRequest("https://leadfindersitora.nl/api/generation", {
    method,
    headers: { origin: "https://leadfindersitora.nl", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("serverless generation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
    generation.createGenerationRun.mockResolvedValue(pendingRun);
    generation.latestGenerationRun.mockResolvedValue(pendingRun);
    generation.processGenerationBatch.mockResolvedValue({ ...pendingRun, status: "RUNNING", progress: 45 });
    generation.cancelGenerationRun.mockResolvedValue({ ...pendingRun, status: "CANCELLED", progress: 100 });
  });

  it("maakt een queued job zonder een lang open startrequest", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ run: pendingRun });
    expect(generation.processGenerationBatch).not.toHaveBeenCalled();
  });

  it("voorkomt twee gelijktijdige zoekruns", async () => {
    findFirst.mockResolvedValue(pendingRun);
    const response = await POST(request("POST"));
    expect(response.status).toBe(409);
    expect(generation.createGenerationRun).not.toHaveBeenCalled();
  });

  it("staat een nieuwe run toe nadat de vorige een eindstatus kreeg", async () => {
    findFirst.mockResolvedValue(null);
    expect((await POST(request("POST"))).status).toBe(202);
  });

  it("verwerkt via PATCH precies de gevraagde persistente batch", async () => {
    const response = await PATCH(request("PATCH", { runId }));
    expect(response.status).toBe(200);
    expect(generation.processGenerationBatch).toHaveBeenCalledWith(runId);
  });

  it("annuleert de job direct en geeft de terminale status terug", async () => {
    const response = await DELETE(request("DELETE", { runId }));
    expect(response.status).toBe(200);
    expect(generation.cancelGenerationRun).toHaveBeenCalledWith(runId);
    expect((await response.json()).run.status).toBe("CANCELLED");
  });

  it("leest jobstatus uit PostgreSQL en activeert daarmee de watchdog", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(generation.latestGenerationRun).toHaveBeenCalledOnce();
  });
});
