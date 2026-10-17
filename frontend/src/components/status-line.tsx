import { useEffect, useState } from "react";
import { ageText, ageTone } from "@/lib/controller-health";
import { roomStatus } from "@/lib/model";
import type { Controller } from "@/lib/types";
import "./status-line.css";

/** Every room, on every page: watering, holding and why, or not watering and what to do, with
 * how old the controller's last report is. `problemsOnly`: only a room not watering or not
 * reporting (the rooms column and the Overview say the rest); `skip`: a room said elsewhere. */
export function StatusLines({
  controller,
  problemsOnly = false,
  skip = null,
}: {
  controller: Controller;
  problemsOnly?: boolean;
  skip?: string | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    // Ages keep counting between snapshots, and a silent controller sends none.
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!controller.rooms.length) return null;
  const now = Date.now();
  const shown = controller.rooms
    .filter((room) => room.id !== skip)
    .map((room) => ({ room, status: roomStatus(controller.states, room, now) }))
    .filter(({ status }) => !problemsOnly || status.tone === "stopped" || status.tone === "stale");
  if (!shown.length) return null;
  return (
    <section className="status-lines" aria-label="Irrigation status by room">
      {shown.map(({ room, status }) => {
        const age = status.reportedAt === null ? null : now - status.reportedAt;
        return (
          <p key={room.id} className="status-line" data-tone={status.tone} data-room={room.id}>
            <strong className="status-line-room">
              <span className="status-line-dot" aria-hidden="true" />
              {room.name}
            </strong>
            <span className="status-line-text">
              <b data-age={status.tone === "stale" ? ageTone(age) : undefined}>{status.text}</b>
              {" — "}
              {status.detail}
              {status.action && (
                <>
                  {" "}
                  {/* Opens the page for THIS line's room, which need not be the selected one. */}
                  <a
                    className="status-line-action"
                    href={`#/${status.action.route}`}
                    onClick={() => controller.changeRoom(room.id)}
                  >
                    {status.action.label}
                  </a>
                </>
              )}
            </span>
            {status.tone !== "stale" && (
              <span className="status-line-age" data-age={ageTone(age)}>
                {age === null ? "No controller data" : `Data ${ageText(age)} old`}
              </span>
            )}
          </p>
        );
      })}
    </section>
  );
}
