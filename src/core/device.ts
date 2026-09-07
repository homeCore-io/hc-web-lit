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
  /** A user-chosen status icon, overriding whatever the type would imply. */
  status_icon?: string;
  area?: string;
  area_override?: string;
  device_type?: string;
  ui_hint?: string;
  parent_device_id?: string;
  manufacturer?: string;
  model?: string;
  sw_version?: string;
  /** User-set names for a keypad's buttons, keyed by component number. */
  button_names?: Record<string, string>;
  /** Where the most recent meaningful state change came from, when known. */
  last_change?: DeviceChange;
}

/** Provenance of a state change. */
export interface DeviceChange {
  changed_at: string;
  kind: string;
  actor_user_id?: string;
  actor_username?: string;
  correlation_id?: string;
}
