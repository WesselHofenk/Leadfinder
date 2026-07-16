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
    const stages=[{id:"pipeline-nieuw",slug:"nieuw",name:"Nieuw",position:1},{id:"pipeline-geen-interesse",slug:"geen-interesse",name:"Geen interesse",position:8}];
    const view = render(<QuickStatus leadId="lead-1" stageSlug="nieuw" stages={stages} />);
    const select = view.getByLabelText("Pipelinefase") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "geen-interesse" } });
    expect(select.value).toBe("geen-interesse");

    finish(new Response(JSON.stringify({ lead: { pipelineStage: { slug: "geen-interesse" } } }), { status: 200 }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
