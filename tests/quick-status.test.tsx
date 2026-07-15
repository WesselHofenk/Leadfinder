// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { QuickStatus } from "@/components/lead-actions";

describe("snelle pipelinewijziging", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("toont Niet geïnteresseerd direct en ververst na succesvolle opslag", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const view = render(<QuickStatus leadId="lead-1" status="NEW" />);
    const select = view.getByLabelText("Pipelinefase") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "NOT_INTERESTED" } });
    expect(select.value).toBe("NOT_INTERESTED");

    finish(new Response(JSON.stringify({ lead: { status: "NOT_INTERESTED" } }), { status: 200 }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
