import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { roomOrderOffered } from "@/lib/model";
import type { Controller } from "@/lib/types";
import { errorText } from "@/lib/utils";
import "./room-order.css";

/** Settings › Room order: the order the rooms are listed in, for everyone, one place at a time.
 * Owner, 2026-10-22: GR1 was set up after GR2, and was listed second with no way to move it. */
export function RoomOrder({ controller }: { controller: Controller }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const offered = roomOrderOffered(controller.states);
  const able = offered && !busy && ["live", "demo"].includes(controller.connection);
  const rooms = controller.rooms;
  async function move(index: number, by: -1 | 1) {
    const ids = rooms.map((room) => room.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    setBusy(true);
    setError("");
    try {
      await controller.operator("room_order_save", { rooms: ids });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="room-order">
      <h3 id="room-order-label">Room order</h3>
      <ol aria-labelledby="room-order-label">
        {rooms.map((room, index) => (
          <li key={room.id}>
            <span className="room-order-place" aria-hidden="true">
              {index + 1}
            </span>
            <span className="room-order-name">{room.name}</span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`Move ${room.name} up`}
              disabled={!able || index === 0}
              onClick={() => void move(index, -1)}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`Move ${room.name} down`}
              disabled={!able || index === rooms.length - 1}
              onClick={() => void move(index, 1)}
            >
              <ArrowDown size={16} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      {error && (
        <p className="small error-text" role="alert">
          {error}
        </p>
      )}
      <p className="small muted mt-3">
        {offered
          ? "The order the rooms are listed in, for everyone who opens the dashboard, on every device. Changing it needs a Home Assistant administrator."
          : "This needs the updated PHASE Control integration."}
      </p>
    </div>
  );
}
