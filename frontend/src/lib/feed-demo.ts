import type { OperatorAction } from "./operator-types";
import {
  draftErrors,
  levelPct,
  mappedNumbers,
  planOf,
  type FeedDocument,
  type FeedDraft,
  type FeedPlan,
} from "./feed";
import { batchStatusId } from "./feed-status";
import type { States } from "./types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const DOSERS = [1, 2, 3, 4, 5, 6];

/** A demo room's feed: Flower at 3 Core : 5 Bloom : 1 Balance : 0.5 Cleanse, 1 mL per litre per
 * part, in 150 L refills (11 min 30 s of fresh water), so Bloom is 750 mL: 75 s at 600 mL/min. It
 * mixes to 3.2 mS/cm. The reservoir's level sensor reads 125 mm to the water full and 850 mm empty. */
export function sampleFeed(): FeedDraft {
  return {
    fill_s: 690,
    batch_l: 150,
    full_mm: 125,
    empty_mm: 850,
    min_pct: 5,
    remind_pct: 20,
    pause_s: 10,
    mix_s: 10,
    dosers: {},
    order: [1, 2, 3, 4],
    recipes: [
      {
        id: "flower",
        name: "Flower",
        strength: 1,
        doses: {
          "1": { label: "Core", parts: 3 },
          "2": { label: "Bloom", parts: 5 },
          "3": { label: "Balance", parts: 1 },
          "4": { label: "Cleanse", parts: 0.5 },
        },
        order: [1, 2, 3, 4],
        ec: 3.2,
      },
    ],
    stage: "flower",
    schedule: { start: null, weeks: [] },
    held_until: null,
  };
}
const EMPTY: FeedDraft = {
  fill_s: 600,
  batch_l: 100,
  full_mm: 0,
  empty_mm: 0,
  min_pct: 5,
  remind_pct: 20,
  pause_s: 10,
  mix_s: 10,
  dosers: {},
  order: [],
  recipes: [],
  stage: null,
  schedule: { start: null, weeks: [] },
  held_until: null,
};

/** The entities the integration publishes from a room's feed (sensor.py, select.py), as Home
 * Assistant would show them. */
export function feedEntities(prefix: string, plan: FeedPlan, recipes: string[], stamp: string) {
  return {
    [`sensor.crop_steering_${prefix}feed_plan`]: {
      entity_id: `sensor.crop_steering_${prefix}feed_plan`,
      state: plan.stage ?? "none",
      attributes: { ...plan, friendly_name: "Feed plan" },
      last_updated: stamp,
    },
    [`select.crop_steering_${prefix}feed_stage`]: {
      entity_id: `select.crop_steering_${prefix}feed_stage`,
      state: recipes.length ? (plan.stage ?? "unknown") : "unavailable",
      attributes: { options: recipes, friendly_name: "Feed stage" },
      last_updated: stamp,
    },
  };
}

/** The integration's feed services in memory (feed.py / feed_api.py), for demo mode. A batch asked
 * for starts at once, as the controller app would at its next pass. */
export class FeedDemo {
  private docs = new Map<string, FeedDocument>();
  constructor(
    private getStates: () => States,
    private updateStates: (states: States) => void,
  ) {}

  private mapped(prefix: string) {
    const attributes =
      this.getStates()[`sensor.crop_steering_${prefix}engine_config`]?.attributes ?? {};
    return Object.fromEntries(
      DOSERS.flatMap((n) => {
        const entity = attributes[`doser_${n}_switch`];
        return typeof entity === "string" && entity ? [[String(n), entity]] : [];
      }),
    );
  }

  private doc(roomId: string) {
    const prefix = roomId.startsWith("room:") ? roomId.slice(5) : "";
    const mapped = this.mapped(prefix);
    if (!this.docs.has(roomId)) {
      const draft = Object.keys(mapped).length ? sampleFeed() : clone(EMPTY);
      this.docs.set(roomId, {
        schema_version: 1,
        room_id: roomId,
        revision: Object.keys(mapped).length ? 3 : 0,
        ...draft,
        mapped,
        plan: planOf(draft, mappedNumbers(mapped)),
        max_dosers: 6,
        max_recipes: 12,
        error: null,
      });
    }
    const doc = this.docs.get(roomId)!;
    doc.mapped = mapped;
    doc.plan = planOf(doc, mappedNumbers(mapped));
    return { doc, prefix };
  }

  /** What the controller's next pass shows: the new plan in the idle batch status. */
  private publish(prefix: string, doc: FeedDocument) {
    const states = { ...this.getStates() };
    const stamp = new Date().toISOString();
    Object.assign(
      states,
      feedEntities(
        prefix,
        doc.plan,
        doc.recipes.map((r) => r.name),
        stamp,
      ),
    );
    const status = states[batchStatusId(prefix)];
    if (status?.state === "idle")
      states[status.entity_id] = {
        ...status,
        attributes: {
          ...status.attributes,
          stage: doc.plan.stage,
          full_mm: doc.plan.full_mm,
          empty_mm: doc.plan.empty_mm,
          min_pct: doc.plan.min_pct,
          level_pct: levelPct(
            typeof status.attributes.level_mm === "number" ? status.attributes.level_mm : null,
            doc.plan.full_mm,
            doc.plan.empty_mm,
          ),
          doses: doc.plan.doses.map((d) => ({ ...d, dosed: null })),
          blocked: doc.plan.problem?.replace(/\.$/, "") ?? null,
          updated: stamp,
        },
        last_updated: stamp,
      };
    this.updateStates(states);
  }

  call(action: OperatorAction, data: Record<string, unknown>): FeedDocument {
    const { doc, prefix } = this.doc(String(data.room_id));
    if (action === "feed_get") return clone(doc);
    if (action === "feed_save") {
      if (data.expected_revision !== doc.revision)
        throw new Error("Feed settings changed elsewhere. Reload before saving.");
      const draft = clone(data.document as FeedDraft);
      const errors = draftErrors(draft);
      if (errors.length) throw new Error(errors.join(" "));
      Object.assign(doc, draft, {
        stage: draft.recipes.some((r) => r.id === draft.stage) ? draft.stage : null,
        // As feed.py keeps it: a recipe saved without an order takes the room's.
        recipes: draft.recipes.map((r) => ({ ...r, order: r.order ?? draft.order ?? [] })),
      });
      doc.revision++;
      doc.plan = planOf(doc, mappedNumbers(doc.mapped));
      this.publish(prefix, doc);
      return clone(doc);
    }
    if (action === "feed_mix") {
      if (doc.plan.problem) throw new Error(doc.plan.problem);
      const states = { ...this.getStates() };
      const now = new Date();
      const button = `button.crop_steering_${prefix}mix_batch`;
      states[button] = { ...states[button], entity_id: button, state: now.toISOString() };
      const status = states[batchStatusId(prefix)];
      if (status?.state === "idle") {
        const fresh = String(
          states[`sensor.crop_steering_${prefix}engine_config`]?.attributes.fresh_water_switch ??
            "",
        );
        if (states[fresh]) states[fresh] = { ...states[fresh], state: "on" };
        states[status.entity_id] = {
          ...status,
          state: "filling",
          attributes: {
            ...status.attributes,
            stage: doc.plan.stage,
            until: new Date(now.getTime() + (doc.plan.fill_s * 1000) / 2).toISOString(),
            fill_until: new Date(now.getTime() + doc.plan.fill_s * 1000).toISOString(),
            doses: doc.plan.doses.map((d) => ({ ...d, dosed: null })),
            armed: false,
            blocked: null,
            updated: now.toISOString(),
          },
          last_updated: now.toISOString(),
        };
        // As the controller does (_batch_hold): while the batch runs, the room's every shot waits,
        // and each zone that would water says so.
        const hold = "refilling its reservoir (filling)";
        const zones = Number(
          states[`sensor.crop_steering_${prefix}engine_config`]?.attributes.num_zones ?? 0,
        );
        const blocked: string[] = [];
        for (let zone = 1; zone <= zones; zone++) {
          const phase = states[`sensor.crop_steering_${prefix}zone_${zone}_phase`]?.state;
          const zoneStatus = states[`sensor.crop_steering_${prefix}zone_${zone}_status`];
          if (!zoneStatus || (phase !== "P1" && phase !== "P2")) continue;
          blocked.push(`Z${zone} ${phase} ${hold}`);
          states[zoneStatus.entity_id] = { ...zoneStatus, state: `Blocked: ${hold}` };
        }
        const decision = states[`sensor.crop_steering_${prefix}current_decision`];
        if (decision && blocked.length)
          states[decision.entity_id] = {
            ...decision,
            state: blocked[0],
            attributes: { ...decision.attributes, fired: [], blocked },
          };
      }
      this.updateStates(states);
      return { ...clone(doc), requested: now.toISOString() };
    }
    throw new Error("Unsupported demo action.");
  }
}
