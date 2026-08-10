"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

type Item = { id: string; name: string; isActive: boolean; reason?: string; priority?: number };

export function CategoryManager({ categories, excluded }: { categories: Item[]; excluded: Item[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    await fetch("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(data)),
    });
    setPending(false);
    form.reset();
    router.refresh();
  }

  async function patch(kind: "category" | "excluded", item: Item, values: { isActive?: boolean; priority?: number }) {
    setPending(true);
    await fetch("/api/admin/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id: item.id, ...values }),
    });
    setPending(false);
    router.refresh();
  }

  return <section className="card card-pad">
    <h2>Categoriebeheer</h2>
    <p className="small muted">Alleen actieve zoekbranches worden geselecteerd. Een lager prioriteitsgetal krijgt eerder zoekcapaciteit.</p>
    <form onSubmit={add} className="filter-grid" style={{ gridTemplateColumns: "1fr 1fr 110px 2fr auto", marginTop: 16 }}>
      <select className="select" name="kind"><option value="category">Zoekbranche</option><option value="excluded">Uitsluiting</option></select>
      <input className="input" name="name" placeholder="Naam" required />
      <input className="input" name="priority" type="number" min={1} max={999} defaultValue={100} aria-label="Nieuwe brancheprioriteit" />
      <input className="input" name="reason" placeholder="Reden (voor uitsluiting)" />
      <button className="button button-primary" disabled={pending}><Plus size={14} />Toevoegen</button>
    </form>
    <div className="grid-two" style={{ marginTop: 20 }}>
      <ItemList title="Zoekbranches" kind="category" items={categories} patch={patch} disabled={pending} />
      <ItemList title="Uitgesloten categorieën" kind="excluded" items={excluded} patch={patch} disabled={pending} />
    </div>
  </section>;
}

function ItemList({
  title, kind, items, patch, disabled,
}: {
  title: string;
  kind: "category" | "excluded";
  items: Item[];
  patch: (kind: "category" | "excluded", item: Item, values: { isActive?: boolean; priority?: number }) => Promise<void>;
  disabled: boolean;
}) {
  return <div>
    <h3>{title}</h3>
    <div style={{ display: "grid", gap: 7 }}>
      {items.map((item) => <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button
          type="button"
          className={`badge ${item.isActive ? "badge-green" : ""}`}
          title={item.reason}
          disabled={disabled}
          onClick={() => void patch(kind, item, { isActive: !item.isActive })}
        >
          {item.name} · {item.isActive ? "aan" : "uit"}
        </button>
        {kind === "category" && <input
          className="input"
          aria-label={`Prioriteit ${item.name}`}
          type="number"
          min={1}
          max={999}
          defaultValue={item.priority ?? 100}
          disabled={disabled}
          style={{ width: 82, minHeight: 32, padding: "4px 8px" }}
          onBlur={(event) => {
            const priority = Number(event.currentTarget.value);
            if (Number.isInteger(priority) && priority !== item.priority) void patch(kind, item, { priority });
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const priority = Number(event.currentTarget.value);
            if (Number.isInteger(priority) && priority !== item.priority) void patch(kind, item, { priority });
          }}
        />}
      </div>)}
    </div>
  </div>;
}
