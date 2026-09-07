/**
 * A device, as hc-api sends it.
 *
 * Mirrors `hc_types::device::DeviceState` field for field, including the names.
 * homeCore has devices, not entities, and no scalar state — see §1.1 of
 * CLAUDE.md, which is the mapping of record. Anything here that drifts from the
 * Rust is a bug in this file, not a local convention.
 */
export interface DeviceState {
  device_id: string;
  name: string;
  plugin_id: string;
  available: boolean;
  /** Every reported reading. There is no scalar `state` — see `isOn`. */
  attributes: Record<string, unknown>;
  last_seen: string;

  canonical_name?: string;
  name_override?: string;
  area?: string;
  area_override?: string;
  device_type?: string;
  ui_hint?: string;
  parent_device_id?: string;
  manufacturer?: string;
  model?: string;
  sw_version?: string;
}
