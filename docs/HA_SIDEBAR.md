# Home Assistant sidebar

When opened inside a compatible Home Assistant shell, PHASE Control temporarily collapses the HA sidebar. Use **Home Assistant** at the bottom of PHASE Control's menu on the left to open the HA menu over the workspace on a tablet or a computer; on a phone it is **More → Home Assistant’s menu**.

Leaving PHASE Control restores the prior kiosk state. This does not change Home Assistant's saved sidebar preference. Standalone tabs and unsupported or cross-origin embeddings retain their normal navigation.

## Verified native panel behavior

Opening the native panel hides the Home Assistant sidebar, and the **Home Assistant** button brings it back. This was checked on a real installation; companion apps and third-party kiosk extensions may behave differently.

PHASE Control's menu (Overview, Strategy, Insights, Feed, Settings and Help down the left, or Overview, Strategy, Insights, Feed and More along the bottom of a phone, with tabs across the top where an entry holds more than one page) moves around the workspace; its **Home Assistant** entry opens Home Assistant's own menu. Each page has its own address, so a bookmark opens it; an address the dashboard does not know opens **Overview**.

## Implementation references

The connector independently uses Home Assistant's temporary kiosk/menu interface, the mechanism used by Music Assistant. It does not copy the Music Assistant application or change HA's parent styles.

- [Music Assistant's HA messaging integration](https://github.com/music-assistant/frontend/blob/362b321da460f8d234c1abbfd007eb19e26d7859/src/plugins/homeassistant.ts): ingress subscription with `kioskMode` and `home-assistant/toggle-menu`.
- [Home Assistant ingress handler](https://github.com/home-assistant/frontend/blob/c3cc2217bfd3b2ac576da2a147a4679a3af6b1a8/src/panels/app/ha-panel-app.ts): subscription cleanup restores temporary kiosk mode.
- [Home Assistant sidebar state](https://github.com/home-assistant/frontend/blob/c3cc2217bfd3b2ac576da2a147a4679a3af6b1a8/src/state/sidebar-mixin.ts): temporary `hass-kiosk-mode` is separate from persisted sidebar docking.

Ingress uses the host messaging interface. The standard same-origin iframe panel uses HA's kiosk and menu events directly, because that panel does not implement ingress messages. It checks host capabilities before hiding anything. No cross-origin parent access is attempted beyond guarded capability discovery.

`frontend/scripts/verify-ha-shell.mjs` checks desktop/mobile menu recovery, restoring prior state when leaving, preserving preexisting kiosk mode, and standalone behavior against an isolated host fixture. Compatibility with every HA companion app and third-party kiosk extension is not implied.
