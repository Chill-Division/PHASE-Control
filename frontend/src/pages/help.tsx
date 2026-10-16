import { useEffect, useRef, useState } from "react";
import { ChevronRight, Compass, Search } from "lucide-react";
import { RunningVersions } from "@/components/shell";
import { WhatsNewButton } from "@/components/whats-new";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  asCode,
  codeFromHash,
  errorCodeGroups,
  errorCodes,
  findErrorCodes,
  severityLabel,
} from "@/lib/error-codes";
import type { Controller } from "@/lib/types";
const glossary = [
  [
    "PHASE",
    "Precision Hydration And Steering Engine. PHASE Control is what you work in: this dashboard and the settings Home Assistant keeps. PHASE Controller is the app that reads the probes and runs the pump and valves through each grow day's four phases, P0 to P3.",
  ],
  [
    "Water per zone and per plant",
    "Zone water is the total delivered estimate for all plants. Average per plant divides that total by plant count. Substrate litres describe the combined pot capacity; they are not water delivered. Runtime estimates multiply dripper flow by run time and respect the controller duration limit.",
  ],
  [
    "Run comparisons",
    "Choose a day, week, month or run-to-date to compare recorded VWC and EC. Previous runs align by grow age. Saved target references show when they were captured; backdating a run does not recreate old targets or readings removed by Recorder retention.",
  ],
  [
    "VWC",
    "Volumetric water content: the percentage of substrate volume occupied by water. Compare recorded readings with active targets; a nominal shot does not guarantee the same retained-water increase.",
  ],
  [
    "Root-zone EC",
    "Electrical conductivity of the substrate measurement, in mS/cm after normalization. Pore EC and bulk EC are different measurement bases; use targets appropriate to the mapped sensor. Feed-water EC is a separate reservoir measurement.",
  ],
  [
    "Dryback",
    "The controller uses relative loss from peak: (peak VWC − current VWC) ÷ peak VWC × 100. A 60% peak and 10% dryback target means 54% VWC, not 50%.",
  ],
  [
    "P0 · Additional dryback",
    "After lights-on, the controller waits for dryback, a fall to the maintenance trigger, or the latest first shot. Existing low-VWC and emergency safeguards can take precedence.",
  ],
  [
    "P1 · Ramp-up",
    "Progressive shots bring substrate moisture to the peak VWC target, subject to the maximum P1 shots, timing and safety limits.",
  ],
  [
    "P2 · Maintenance",
    "A maintenance shot fires whenever VWC reads below the maintenance trigger. EC feedback may adjust the trigger; the planning curve shows the base setpoints, not a measured prediction.",
  ],
  [
    "P3 · Overnight dryback",
    "Routine irrigation stops. The zone is held at its P3 dryback target, and a rescue shot fires if VWC reads below the rescue level; each P3 shot waits at least the time between P3 shots after the last shot. There is no independent scheduled P3 EC target.",
  ],
  [
    "Steering balance",
    "0% uses the vegetative endpoint; 100% uses the generative endpoint; intermediate values blend their explicit parameters. Pot size and dripper flow convert shot fractions to delivery volume and time.",
  ],
  [
    "Planning versus history",
    "The planning curve is a schematic drawn from targets. Recorded history comes from Home Assistant Recorder. Neither an event acknowledgement nor a modeled curve proves physical delivery.",
  ],
];
export function Help({
  controller,
  startTour,
}: {
  controller: Controller;
  /** The first-run tour, from its first stop. */
  startTour: () => void;
}) {
  return (
    <>
      <div className="page-heading">
        <h2 className="sr-only">Help</h2>
        {controller.demo ? <span /> : <RunningVersions controller={controller} />}
        <div className="heading-actions">
          <Button variant="outline" onClick={startTour}>
            <Compass size={16} aria-hidden="true" /> Take the tour
          </Button>
          <WhatsNewButton controller={controller} />
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Terms & phases</h2>
            <p>What the controls mean in practice</p>
          </div>
        </div>
        <dl className="glossary">
          {glossary.map(([term, definition]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{definition}</dd>
            </div>
          ))}
        </dl>
      </section>
      <ErrorCodes />
    </>
  );
}

/** Every code a notification or Repairs card can end with, searchable, from docs/error-codes.json. */
function ErrorCodes() {
  const [query, setQuery] = useState(() => codeFromHash(window.location.hash) ?? "");
  const found = findErrorCodes(query);
  const exact = asCode(query);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    // Opened as #/help?code=CS-101, or sent there while already on this page (the app does not
    // re-render a page for a change after its "?"): show that code and bring it into view.
    const follow = () => {
      const code = codeFromHash(window.location.hash);
      if (!code) return;
      setQuery(code);
      section.current?.scrollIntoView({ block: "start" });
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  return (
    <section ref={section} className="panel error-codes" aria-labelledby="error-codes-title">
      <div className="panel-heading">
        <div>
          <h2 id="error-codes-title">Error codes</h2>
          <p>
            Every PHASE Control alert and Repairs card ends with a code such as CS-101 (the
            controller's regular status summary has none). Look it up here for what it means, what
            happens to watering meanwhile, and what to do.
          </p>
        </div>
      </div>
      <div className="error-codes-body">
        <div className="search-field">
          <Search size={17} />
          <Input
            aria-label="Search error codes"
            placeholder="A code or words, e.g. 101 or probe"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {found.length === 0 && (
          <p className="error-codes-empty">
            No code matches “{query.trim()}”. Codes run from {errorCodes[0].code} to{" "}
            {errorCodes[errorCodes.length - 1].code}.
          </p>
        )}
        {errorCodeGroups.map((group) => {
          const codes = found.filter((entry) => entry.code.startsWith(group.prefix));
          if (!codes.length) return null;
          return (
            <div className="error-code-group" key={group.prefix}>
              <h3>
                {group.name} <span>{group.prefix}xx</span>
              </h3>
              <p>{group.detail}</p>
              {codes.map((entry) => (
                <details
                  className="error-code"
                  id={entry.code.toLowerCase()}
                  key={`${entry.code}-${exact === entry.code}`}
                  open={exact === entry.code || undefined}
                >
                  <summary>
                    <code>{entry.code}</code>
                    <span className="error-code-title">{entry.title}</span>
                    <Badge variant="outline" className={`severity-${entry.severity}`}>
                      {severityLabel[entry.severity]}
                    </Badge>
                    <ChevronRight size={16} aria-hidden="true" className="error-code-chevron" />
                  </summary>
                  <dl>
                    <div>
                      <dt>What it means</dt>
                      <dd>{entry.meaning}</dd>
                    </div>
                    <div>
                      <dt>Watering meanwhile</dt>
                      <dd>{entry.watering}</dd>
                    </div>
                    <div>
                      <dt>Likely causes</dt>
                      <dd>
                        <ul>
                          {entry.causes.map((cause) => (
                            <li key={cause}>{cause}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                    <div>
                      <dt>Suggested fixes</dt>
                      <dd>
                        <ul>
                          {entry.fixes.map((fix) => (
                            <li key={fix}>{fix}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  </dl>
                  <p className="error-code-source">
                    {entry.source === "repairs"
                      ? "Shown as a card under Settings → Repairs."
                      : "Shown as a Home Assistant notification from the controller app."}
                  </p>
                </details>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
