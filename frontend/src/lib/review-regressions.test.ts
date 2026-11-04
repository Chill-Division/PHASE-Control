import { describe, expect, it } from "vitest";
import { buildRoom, discoverRooms, resolveRequestedRoom, validateChange } from "./model";
import { createDemo } from "./demo";

describe("adapter review regressions", () => {
  it("resolves a room by its id only, not by the old page names", () => {
    const states = createDemo();
    const rooms = discoverRooms(states);
    expect(resolveRequestedRoom(rooms, "room:")?.prefix).toBe("");
    expect(resolveRequestedRoom(rooms, "room:f1_")?.prefix).toBe("f1_");
    for (const old of ["f2", "f1", "missing"])
      expect(resolveRequestedRoom(rooms, old)).toBeUndefined();
  });
  it("keeps default, named f2, and named default room identities distinct", () => {
    const states = createDemo();
    for (const prefix of ["f2_", "default_"]) {
      const entityId = `sensor.crop_steering_${prefix}engine_config`;
      states[entityId] = {
        entity_id: entityId,
        state: "ready",
        attributes: { prefix, slug: prefix.slice(0, -1), num_zones: 1 },
      };
      const numberId = `number.crop_steering_${prefix}zone_1_p1_target_vwc`;
      states[numberId] = {
        entity_id: numberId,
        state: "75",
        attributes: { min: 0, max: 100, step: 1 },
      };
    }
    const rooms = discoverRooms(states);
    expect(new Set(rooms.map((room) => room.id)).size).toBe(rooms.length);
    const selectedId = rooms.find((room) => room.prefix === "f2_")!.id;
    const view = buildRoom(
      states,
      rooms.find((room) => room.id === selectedId)!,
    );
    expect(view.room.prefix).toBe("f2_");
    expect(
      validateChange(view, states, {
        entityId: "number.crop_steering_f2_zone_1_p1_target_vwc",
        value: 76,
      }),
    ).toBeNull();
    expect(
      validateChange(view, states, {
        entityId: "number.crop_steering_zone_1_p1_target_vwc",
        value: 76,
      }),
    ).toBeTruthy();
  });

  it("marks stale readings unavailable without aging static configuration or switches", () => {
    const states = createDemo();
    states["sensor.crop_steering_vwc_zone_1"].last_updated = "2020-01-01T00:00:00Z";
    states["sensor.crop_steering_ec_zone_1"].last_updated = new Date(
      Date.now() - 21 * 60_000,
    ).toISOString();
    states["number.crop_steering_zone_1_p1_target_vwc"].last_updated = "2020-01-01T00:00:00Z";
    states["switch.crop_steering_zone_1_enabled"].last_updated = "2020-01-01T00:00:00Z";
    const view = buildRoom(states, discoverRooms(states)[0]);
    expect(view.zones[0].vwc.value).toBeNull();
    expect(view.zones[0].ec.value).toBeNull();
    expect(view.zones[0].target.value).toBe(64);
    expect(view.zones[0].enabled).toBe(true);
    expect(view.alerts.some((alert) => /stale/i.test(alert.detail))).toBe(true);
    expect(view.metrics[0].value).toBeNull();
  });

  it("accepts fresh data but fails closed for missing, invalid and future timestamps", () => {
    const states = createDemo();
    const room = discoverRooms(states)[0];
    expect(buildRoom(states, room).zones[0].vwc.value).toBe(56);
    for (const timestamp of [undefined, "not-a-date", "2099-01-01T00:00:00Z"]) {
      states["sensor.crop_steering_vwc_zone_1"].last_updated = timestamp;
      expect(buildRoom(states, room).zones[0].vwc.value).toBeNull();
    }
    states["sensor.crop_steering_vwc_zone_1"].state = "unknown";
    states["sensor.crop_steering_vwc_zone_1"].last_updated = new Date().toISOString();
    expect(buildRoom(states, room).zones[0].vwc.value).toBeNull();
  });

  it("uses an exposed custom sensor maximum age with heartbeat precedence", () => {
    const states = createDemo();
    states["sensor.crop_steering_vwc_zone_1"].last_updated = new Date(
      Date.now() - 25 * 60_000,
    ).toISOString();
    states["sensor.crop_steering_engine_config"].attributes.max_sensor_age_s = 3600;
    const room = discoverRooms(states)[0];
    expect(buildRoom(states, room).zones[0].vwc.value).toBe(56);
    states["sensor.crop_steering_ai_heartbeat"].attributes.max_sensor_age_s = 60;
    expect(buildRoom(states, room).zones[0].vwc.value).toBeNull();
  });

  it("keeps a still moisture reading current in a one-valve room while the controller steers by it", () => {
    const states = createDemo();
    const room = discoverRooms(states)[0];
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const steered = (vwc: number | null) => {
      const id = "sensor.crop_steering_zone_1_safety_status";
      states[id] = { entity_id: id, state: "ok", attributes: { vwc }, last_updated: ago(0) };
    };
    const vwc = () => buildRoom(states, room).zones[0].vwc.value;
    states["sensor.crop_steering_vwc_zone_1"].last_updated = ago(40);
    steered(56);
    expect(vwc()).toBeNull(); // on its own valve: out after 20 minutes, as before
    states["sensor.crop_steering_engine_config"].attributes.plumbing = "pump_one_valve";
    expect(vwc()).toBe(56);
    steered(null); // the controller doesn't steer by it (at 100%, or under the rescue level)
    expect(vwc()).toBeNull();
    steered(56);
    states["sensor.crop_steering_vwc_zone_1"].last_updated = ago(121); // two hours the same
    expect(vwc()).toBeNull();
    states["sensor.crop_steering_vwc_zone_1"].last_updated = ago(40);
    states["sensor.crop_steering_ai_heartbeat"].last_updated = ago(60); // the controller stopped
    expect(vwc()).toBeNull();
  });
});
