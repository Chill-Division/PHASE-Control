import { useEffect, useId, useState } from "react";
import { FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, Heading, number, type Page } from "@/components/dashboard";
import {
  batchesLeft,
  draftErrors,
  stockShare,
  stockTone,
  type StockDocument,
  type StockTank,
  type StockTankDraft,
} from "@/lib/stock";
import type { Controller } from "@/lib/types";
import { errorText } from "@/lib/utils";
import { useBalancedRows } from "@/lib/use-balanced-rows";
import "./stock.css";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";
const blank = (): StockTankDraft => ({
  name: "",
  capacity_l: 20,
  level_l: 20,
  doser: null,
  low_l: 4,
});

/** A tank drawn as a vessel: the level filled in, the low mark dashed across it. */
function Gauge({ tank }: { tank: StockTank }) {
  const clip = useId();
  const share = stockShare(tank);
  const low = tank.capacity_l > 0 ? Math.min(100, (tank.low_l / tank.capacity_l) * 100) : 0;
  // The inside runs from y=99 (empty) to y=1 (full): 0.98 units per percent.
  const y = (percent: number) => 99 - percent * 0.98;
  return (
    <svg
      className="stock-gauge"
      viewBox="0 0 60 100"
      role="img"
      aria-label={`${tank.name}: ${number(share, 0)}% full, low mark at ${number(low, 0)}%`}
      data-tone={stockTone(tank)}
    >
      <defs>
        <clipPath id={clip}>
          <rect x="1" y="1" width="58" height="98" rx="9" />
        </clipPath>
      </defs>
      <rect x="1" y="1" width="58" height="98" rx="9" className="stock-shell" />
      <g clipPath={`url(#${clip})`}>
        <rect x="1" y={y(share)} width="58" height={99 - y(share)} className="stock-liquid" />
      </g>
      <path d={`M1 ${y(low)} H59`} className="stock-low-mark" />
      <text x="30" y="55" textAnchor="middle" className="stock-percent">
        {Math.round(share)}%
      </text>
    </svg>
  );
}

function TankCard({
  tank,
  dose,
  busy,
  onRefill,
  onLevel,
}: {
  tank: StockTank;
  dose: number | undefined;
  busy: boolean;
  onRefill: () => void;
  onLevel: (level: number) => Promise<boolean>;
}) {
  const [setting, setSetting] = useState(false);
  const [level, setLevel] = useState(String(tank.level_l));
  const tone = stockTone(tank);
  const left = batchesLeft(tank, dose);
  const inputId = useId();
  const value = Number(level);
  const valid = level.trim() !== "" && value >= 0 && value <= tank.capacity_l;
  return (
    <section className="panel stock-card" data-stock-tank={tank.id}>
      <div className="stock-card-head">
        <h2>{tank.name}</h2>
        <span
          className="pill"
          data-tone={tone === "over" ? "off" : tone === "high" ? "warn" : "on"}
          data-stock-status={tank.id}
        >
          <span className="pill-dot" />
          {tone === "over" ? "Low" : tone === "high" ? "Getting low" : "OK"}
        </span>
      </div>
      <div className="stock-card-body">
        <Gauge tank={tank} />
        <dl className="stock-facts">
          <div>
            <dt>Left</dt>
            <dd>
              {number(tank.level_l, 2)}
              <span className="unit"> of {number(tank.capacity_l, 2)} L</span>
            </dd>
          </div>
          <div>
            <dt>Per batch</dt>
            <dd>
              {dose ? number(dose, 0) : "—"}
              {!!dose && <span className="unit"> mL</span>}
              {tank.doser ? (
                <small title="What the feed recipe in use gives from this doser in each Reservoir batch">
                  from doser {tank.doser}
                </small>
              ) : (
                <small>On no doser</small>
              )}
            </dd>
          </div>
          <div>
            <dt>Batches left</dt>
            <dd>{left === null ? "—" : `about ${left}`}</dd>
          </div>
          <div>
            <dt>Low mark</dt>
            <dd>
              {number(tank.low_l, 2)}
              <span className="unit"> L</span>
            </dd>
          </div>
        </dl>
      </div>
      {setting ? (
        <form
          className="stock-level-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (valid && (await onLevel(value))) setSetting(false);
          }}
        >
          <Label htmlFor={inputId}>Level read off the tank (L)</Label>
          <div>
            <Input
              id={inputId}
              type="number"
              min={0}
              max={tank.capacity_l}
              step={0.1}
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              aria-invalid={!valid}
              autoFocus
            />
            <Button type="submit" size="sm" disabled={!valid || busy}>
              Save level
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSetting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="stock-actions">
          <Button size="sm" disabled={busy} onClick={onRefill}>
            Refilled
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setLevel(String(tank.level_l));
              setSetting(true);
            }}
          >
            Set level
          </Button>
          <span className="muted small">Refilled {when(tank.refilled_at)}</span>
        </div>
      )}
    </section>
  );
}

function Editor({
  initial,
  busy,
  max,
  dosers,
  onSave,
  onClose,
}: {
  initial: StockTankDraft[];
  busy: boolean;
  max: number;
  /** The room's Reservoir dosers (stock_get), each with its nutrient in the stage in use. */
  dosers: NonNullable<StockDocument["dosers"]>;
  onSave: (drafts: StockTankDraft[]) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState(initial);
  const errors = draftErrors(drafts, max);
  const listId = useId();
  const update = (index: number, change: Partial<StockTankDraft>) =>
    setDrafts(drafts.map((draft, i) => (i === index ? { ...draft, ...change } : draft)));
  const doserNumbers = Object.keys(dosers)
    .map(Number)
    .sort((a, b) => a - b);
  const numeric = (index: number, key: keyof StockTankDraft, label: string, unit: string) => (
    <div>
      <Label htmlFor={`${listId}-${index}-${key}`}>
        {label} ({unit})
      </Label>
      <Input
        id={`${listId}-${index}-${key}`}
        type="number"
        min={0}
        step={0.1}
        value={String(drafts[index][key] ?? "")}
        onChange={(event) =>
          update(index, { [key]: event.target.value === "" ? NaN : Number(event.target.value) })
        }
      />
    </div>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="stock-editor">
        <DialogHeader>
          <DialogTitle>Stock tanks</DialogTitle>
          <DialogDescription>
            {doserNumbers.length
              ? "Put each tank on the doser its bottle feeds: every batch the Reservoir mixes takes what that doser gave, which the feed recipes say, week by week."
              : "Map the room's dosers in Settings → Rooms & hardware, then put each tank on the doser its bottle feeds: every batch the Reservoir mixes takes what that doser gave."}
          </DialogDescription>
        </DialogHeader>
        <div className="stock-editor-rows">
          {drafts.map((draft, index) => (
            <fieldset key={draft.id ?? `new-${index}`} className="stock-editor-row">
              <legend className="sr-only">{draft.name || `Tank ${index + 1}`}</legend>
              <div className="stock-editor-name">
                <Label htmlFor={`${listId}-${index}-name`}>Name</Label>
                <Input
                  id={`${listId}-${index}-name`}
                  value={draft.name}
                  maxLength={40}
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </div>
              {numeric(index, "capacity_l", "Capacity", "L")}
              {numeric(index, "level_l", "Level now", "L")}
              {numeric(index, "low_l", "Low mark", "L")}
              <div className="stock-editor-entity">
                {!!doserNumbers.length && (
                  <>
                    <Label htmlFor={`${listId}-${index}-doser`}>Doser</Label>
                    <select
                      id={`${listId}-${index}-doser`}
                      className="stock-editor-doser"
                      value={draft.doser ? String(draft.doser) : ""}
                      onChange={(event) =>
                        update(index, {
                          doser: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    >
                      <option value="">Not on a doser</option>
                      {doserNumbers.map((n) => (
                        <option key={n} value={String(n)}>
                          Doser {n}
                          {dosers[String(n)]?.nutrient ? ` · ${dosers[String(n)].nutrient}` : ""}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${draft.name || `tank ${index + 1}`}`}
                onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} />
              </Button>
            </fieldset>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={drafts.length >= max}
          onClick={() => setDrafts([...drafts, blank()])}
        >
          <Plus size={16} /> Add a stock tank
        </Button>
        {!!errors.length && (
          <ul className="workspace-message error" role="alert">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !!errors.length} onClick={() => onSave(drafts)}>
            Save stock tanks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StockTanks({
  controller,
  navigate,
}: {
  controller: Controller;
  navigate: (page: Page) => void;
}) {
  const [doc, setDoc] = useState<StockDocument | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<StockTankDraft[] | null>(null);
  const grid = useBalancedRows<HTMLDivElement>(doc?.tanks.length ?? 0);
  useEffect(() => {
    let current = true;
    setDoc(null);
    setError("");
    controller
      .operator<StockDocument>("stock_get")
      .then((result) => current && setDoc(result))
      .catch((err) => current && setError(errorText(err)));
    return () => {
      current = false;
    };
  }, [controller.roomId, controller.connection]);
  const act = async (action: "stock_save" | "stock_refill", data = {}) => {
    if (!doc) return false;
    setBusy(true);
    setError("");
    try {
      setDoc(
        await controller.operator<StockDocument>(action, {
          ...data,
          expected_revision: doc.revision,
        }),
      );
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const edit = () =>
    setEditing(
      doc?.tanks.length
        ? doc.tanks.map(({ refilled_at: _r, updated_at: _u, ...tank }) => tank)
        : [blank()],
    );
  return (
    <>
      <Heading
        title="Stock tanks"
        action={
          doc && (
            <div className="heading-actions">
              <Button onClick={edit} disabled={busy || !!doc.error}>
                <Pencil size={16} /> Edit stock tanks
              </Button>
            </div>
          )
        }
      />
      {error && (
        <p className="workspace-message error" role="alert">
          {error}
        </p>
      )}
      {doc?.error && (
        <p className="workspace-message error" role="alert">
          {doc.error}
        </p>
      )}
      {doc &&
        (Object.keys(doc.dosers ?? {}).length ? (
          <p className="stock-source" data-stock-dosers>
            A tank on a doser loses what that doser gives in each batch the Reservoir mixes: what
            the feed recipe in use says, week by week. Last Reservoir batch counted:{" "}
            {when(doc.history.find((batch) => batch.source === "reservoir")?.at ?? null)}.
          </p>
        ) : (
          <p className="stock-source" data-stock-source>
            No dosers are mapped, so no batch takes from these tanks: set each tank&apos;s level by
            hand, or{" "}
            <Button variant="link" className="inline-link" onClick={() => navigate("setup")}>
              map the dosers in Settings → Rooms & hardware
            </Button>{" "}
            and put each tank on its doser.
          </p>
        ))}
      {!doc && !error && <p className="muted">Loading stock tanks…</p>}
      {doc && !doc.tanks.length && !doc.error && (
        <Empty
          title="No stock tanks yet"
          detail="Add each concentrate's bottle: its capacity, the level it is at, when to warn you, and the doser it feeds. How much a batch takes is the feed recipe's."
          action={
            <Button onClick={edit}>
              <FlaskConical size={16} /> Add stock tanks
            </Button>
          }
        />
      )}
      {doc && !!doc.tanks.length && (
        <div className="stock-grid" ref={grid.ref} style={grid.style}>
          {doc.tanks.map((tank) => (
            <TankCard
              key={tank.id}
              tank={tank}
              dose={doc.doses[tank.id]}
              busy={busy}
              onRefill={() => void act("stock_refill", { id: tank.id })}
              onLevel={(level) => act("stock_refill", { id: tank.id, level_l: level })}
            />
          ))}
        </div>
      )}
      {doc && !!doc.history.length && (
        <section className="panel stock-history">
          <div className="panel-heading">
            <h2>Recent batches</h2>
          </div>
          <div className="table-scroll" tabIndex={0} aria-label="Recent batches">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Counted from</th>
                  {doc.tanks.map((tank) => (
                    <th key={tank.id}>{tank.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doc.history.slice(0, 10).map((batch) => (
                  <tr key={batch.at + batch.source}>
                    <td>{when(batch.at)}</td>
                    <td>
                      <span className="pill" data-tone="unknown">
                        {batch.source === "fill"
                          ? "Tank fill"
                          : batch.source === "reservoir"
                            ? "Reservoir"
                            : "By hand"}
                      </span>
                    </td>
                    {doc.tanks.map((tank) => (
                      <td key={tank.id} className="numeric">
                        {batch.draw_ml[tank.id] === undefined ? "—" : number(batch.draw_ml[tank.id], 0)}
                        {batch.draw_ml[tank.id] !== undefined && <span className="unit"> mL</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {editing && doc && (
        <Editor
          initial={editing}
          busy={busy}
          max={doc.max_tanks}
          dosers={doc.dosers ?? {}}
          onClose={() => setEditing(null)}
          onSave={async (drafts) => {
            if (await act("stock_save", { tanks: drafts })) setEditing(null);
          }}
        />
      )}
    </>
  );
}
