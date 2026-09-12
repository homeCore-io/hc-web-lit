/**
 * One media player, with its art — `media_tile`.
 *
 * The single-thing widget that `media_player` composes, the same way
 * `scene_row` composes `scene_button` and `device_grid` composes the card.
 *
 * **Not on `HcLayoutShell`, and that is the point of having a shell.** Its
 * structure is a 2.25rem mark beside two lines; a media player leads with
 * album art, which is the largest thing on the card rather than an indicator
 * beside it. Forcing this through the shell would mean widening the shell
 * until it described nothing in particular. A shell that fits three widgets
 * and admits a fourth is honest; one that fits everything is a `<div>`.
 *
 * **The art comes from the host** (§19.4). Core proxies it at
 * `/devices/{id}/media/art` deliberately — so a browser renders it without
 * reaching the device and without the device's URL leaking into a page — and
 * that needs the bearer, which a widget never holds.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { DeviceState } from '../core/device.js';
import type { CommandRequest } from '../core/widget.js';
import { clock, nowPlaying, progress, summary, type NowPlaying } from '../core/media.js';
import { effectiveName } from '../core/present.js';
import { registerWidget } from '../core/registry.js';
import { icon } from '../design/icons.js';
import { humanise } from '../core/text.js';

/** Transport, in the order a person expects it, with the mark for each. */
const TRANSPORT: { id: string; mark: string; primary?: boolean }[] = [
  { id: 'previous', mark: 'prev' },
  { id: 'play_pause', mark: 'play_pause', primary: true },
  { id: 'toggle_play_pause', mark: 'play_pause', primary: true },
  { id: 'play', mark: 'play', primary: true },
  { id: 'pause', mark: 'pause' },
  { id: 'stop', mark: 'stop' },
  { id: 'next', mark: 'next' },
];

/**
 * The combined play/pause, which two plugins spell two different ways.
 *
 * Sonos declares `toggle_play_pause`; Roku declares `play_pause`. **Both
 * declare the same icon for it**, which is the signal that actually
 * generalises — a third plugin will invent a third id and is far less likely
 * to invent a third name for a glyph everybody draws the same. So the id list
 * above is the fast path and this is the answer: read what the device said.
 */
const TOGGLE_ICON = 'play-pause';

/** Volume as three presses, for a device that has no level to set. */
const VOLUME: { id: string; mark: string }[] = [
  { id: 'volume_down', mark: 'volume_down' },
  { id: 'mute', mark: 'mute' },
  { id: 'volume_up', mark: 'volume_up' },
];

/**
 * The volume control a device actually declares, which is one of two shapes.
 *
 * A Sonos declares `set_volume` with an `int` parameter from 0 to 100 and a
 * `writes` naming the attribute it drives — everything a slider needs, stated
 * by the device. A Roku declares `volume_up`, `volume_down` and `mute` and no
 * level at all, because a television's volume belongs to whatever is amplifying
 * it. Neither is a degraded version of the other, and the widget had only the
 * second: every Sonos showed no volume control whatsoever, next to a `volume`
 * attribute it was already reading and printing.
 */
interface Level {
  action: string;
  param: string;
  attribute: string;
  min: number;
  max: number;
}

function levelOf(d: DeviceState): Level | undefined {
  const set = (d.schema?.actions ?? []).find((a) => a.id === 'set_volume');
  const param = (set?.params ?? []).find((p) => p.kind === 'int' || p.kind === 'float');
  if (set === undefined || param === undefined) return undefined;
  // `writes` is the device saying which of its own readings this action moves,
  // and it is what keeps the slider showing the volume rather than a number
  // that happens to share a name with the parameter.
  const attribute = set.writes ?? param.name;
  return {
    action: set.id,
    param: param.name,
    attribute,
    min: typeof param.min === 'number' ? param.min : 0,
    max: typeof param.max === 'number' ? param.max : 100,
  };
}

/** The mute a device declares as a state to set, rather than a key to press. */
/** A reading as a number, whichever way the plugin publishes it. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function muteOf(d: DeviceState): { action: string; param: string; attribute: string } | undefined {
  const set = (d.schema?.actions ?? []).find((a) => a.id === 'set_mute');
  const param = (set?.params ?? []).find((p) => p.kind === 'bool');
  if (set === undefined || param === undefined) return undefined;
  return { action: set.id, param: param.name, attribute: set.writes ?? param.name };
}

@customElement('hc-media-card')
export class HcMediaCard extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    .card {
      position: relative;
      display: grid;
      gap: 0.75rem;
      padding: var(--hc-density-card-padding, 14px);
      border-radius: var(--hc-radius-md, 14px);
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      background: var(--hc-surface-raised, #141922);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      overflow: hidden;
    }
    /* The art again, blurred and dimmed, so the card takes the colour of what
       is playing. It is decoration over the real thing, which is why it sits
       behind the surface rather than replacing it. */
    .wash {
      position: absolute;
      inset: -20%;
      background-size: cover;
      background-position: center;
      filter: blur(28px) saturate(1.4);
      opacity: 0.28;
      pointer-events: none;
    }
    /* One row of a status list: where, what, and the one control. Rows are
       held together by alignment and a hairline rather than by each being its
       own box — seven bordered cards in a column read as seven objects when
       the point is one list. */
    .strip {
      display: flex;
      align-items: baseline;
      gap: calc(var(--hc-space-unit, 8px));
      padding: calc(var(--hc-space-unit, 8px) * 0.75) 0;
      border-bottom: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
    }
    :host(:last-of-type) .strip {
      border-bottom: 0;
    }
    /* A dot, lit only while something is actually playing. A glyph that is
       always there says nothing; the one piece of state worth a mark is
       whether this one is making a noise. */
    .pip {
      flex: none;
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 50%;
      background: var(--hc-stroke-hairline, #262d38);
      align-self: center;
    }
    .pip[data-on] {
      background: var(--hc-accent-active, #ffc978);
    }
    /* The room first and the track second: on a house page you are looking for
       where, and the name is what you scan. So the name keeps its width and
       the track gives way. */
    .who {
      flex: none;
      font-weight: 600;
    }
    .what {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--hc-ink-muted, #8b95a4);
      font-size: var(--hc-text-body-small-size, 12.5px);
    }
    /* Borderless: a boxed button per row is the same seven-objects problem the
       card was, one element down. */
    button.quiet {
      flex: none;
      width: 1.75rem;
      height: 1.75rem;
      border: 0;
      background: none;
      color: var(--hc-ink-muted, #8b95a4);
      align-self: center;
    }
    button.quiet:hover {
      color: var(--hc-ink, #e9edf2);
      background: none;
    }
    .head {
      position: relative;
      display: flex;
      align-items: center;
      gap: 1rem;
      min-width: 0;
    }
    /* **Album art is the thing a person recognises.** At 3.5rem it was a
       thumbnail beside a line of text — a row in a list rather than the thing
       playing in this room. The card's placement on the house's room page is
       429x400 and it was drawing about 190 of that, so the space was already
       there and nothing was using it. */
    .art {
      flex: none;
      display: grid;
      place-items: center;
      width: 6.5rem;
      height: 6.5rem;
      border-radius: var(--hc-radius-md, 14px);
      overflow: hidden;
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink-muted, #8b95a4);
      box-shadow: var(--hc-elevation-card, 0 6px 18px rgb(0 0 0 / 0.35));
    }
    .art img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .art svg {
      width: 2.25rem;
      height: 2.25rem;
    }
    .lines {
      min-width: 0;
      display: grid;
      gap: 0.2rem;
      flex: 1 1 auto;
    }
    /* The title is the biggest thing on the card, because it is what the card
       is about. It was body size, which put it level with the room name above
       it and the artist below — three lines of the same weight, and nothing
       to land on. */
    .title {
      font-weight: 650;
      font-size: var(--hc-text-title-size, 20px);
      line-height: 1.15;
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* **Artist and album on their own lines.** They were joined with a dot
       into one line that the card then truncated, so an album with a long
       name ate the artist — the reference house's "Drowning Pool · Sinner
       (Unlucky 13th Anniversary Delu…" is the whole failure in one string. */
    .sub,
    .where {
      font-size: var(--hc-text-body-small-size, 12.5px);
      color: var(--hc-ink-muted, #8b95a4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .album {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .where {
      font-size: var(--hc-text-caption-size, 11px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    /* Position, where the device counts. A live stream gets none: a bar that
       never fills is a bar that is lying about having an end. */
    .progress {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
    }
    .track {
      height: 6px;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-surface-sunken, #0d1116);
      overflow: hidden;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
    }
    /* **Transport is chrome, not state.** Accent is what this client uses to
       say a device is *on*, and a media card was spending it on a progress
       bar, a volume slider, a hover border and a play button the size of a
       coin — four amber things on a card where nothing was on. Position is
       not a state; it is the card telling you where it has got to. Ink. */
    .fill {
      display: block;
      height: 100%;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-ink, #e9edf2);
    }
    .controls {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      justify-content: space-between;
    }
    .buttons {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    button {
      display: grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      padding: 0;
      border: var(--hc-stroke-width, 1px) solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-sm, 8px);
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      font: inherit;
      cursor: pointer;
      transition:
        background var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out),
        border-color var(--hc-motion-fast, 140ms) var(--hc-motion-curve, ease-out);
    }
    button:hover {
      border-color: color-mix(in srgb, var(--hc-ink, #e9edf2) 30%, transparent);
    }
    /* **Play is the one button on the card somebody is looking for.** It was
       2.75rem against the others' 2.5, in the same square with the same
       hairline — a difference you find by measuring rather than by looking.
       Round and filled, which is what every transport in the world does, and
       the only round thing in the row. */
    button[data-primary] {
      width: 3.25rem;
      height: 3.25rem;
      border-radius: var(--hc-radius-pill, 999px);
      background: var(--hc-ink, #e9edf2);
      border-color: transparent;
      color: var(--hc-accent-on-primary, #06131f);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    }
    button[data-primary]:hover {
      border-color: transparent;
      filter: brightness(1.08);
    }
    button[data-primary] svg {
      width: 1.5rem;
      height: 1.5rem;
    }
    /* The others are quieter than they were: a row of equally-weighted keys
       has no centre, and skip is not the thing being reached for. */
    button:not([data-primary]) {
      border-color: transparent;
      background: transparent;
      color: var(--hc-ink-muted, #8b95a4);
    }
    button:not([data-primary]):hover {
      background: var(--hc-surface-sunken, #0d1116);
      color: var(--hc-ink, #e9edf2);
      border-color: transparent;
    }
    button:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
    button svg {
      width: 1.25rem;
      height: 1.25rem;
    }
    .fill-mark svg {
      fill: currentColor;
      stroke-width: 1.2;
    }
    .volume {
      font-size: var(--hc-text-caption-size, 11px);
      color: var(--hc-ink-muted, #8b95a4);
      font-variant-numeric: tabular-nums;
      min-width: 2ch;
      text-align: right;
    }
    /* The level a device declares it can be set to. Narrow on purpose: it
       shares a row with the transport, and a volume that took half the card
       would be a card about the volume. */
    .level {
      flex: 1 1 4rem;
      min-width: 3rem;
      max-width: 8rem;
      height: var(--hc-density-min-tap, 44px);
      margin: 0;
      accent-color: var(--hc-ink, #e9edf2);
      background: none;
      cursor: pointer;
    }
    .level:focus-visible {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) device: DeviceState | undefined;
  @property({ attribute: false }) config: Record<string, unknown> = {};
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;
  @property({ attribute: false }) onArt:
    ((deviceId: string) => Promise<string | undefined>) | undefined;

  @state() private art: string | undefined;

  /** What art was last fetched for, so a re-render does not re-fetch. */
  private fetched = '';

  override willUpdate(): void {
    void this.loadArt();
  }

  override disconnectedCallback(): void {
    // An object URL is a reference the browser keeps until it is told
    // otherwise; a wall display cycling players for a month would hold every
    // cover it ever showed.
    if (this.art !== undefined) URL.revokeObjectURL(this.art);
    super.disconnectedCallback();
  }

  /**
   * Fetch the art, keyed on what is playing rather than on the device.
   *
   * A television on its home screen has none, and the next track has
   * different art with the same device id — so the key is the title, which is
   * what actually changes.
   */
  private async loadArt(): Promise<void> {
    const d = this.device;
    if (d === undefined || this.onArt === undefined) return;
    const n = nowPlaying(d);
    const want = `${d.device_id}/${n.title ?? n.source ?? ''}/${n.state}`;
    if (want === this.fetched) return;
    this.fetched = want;

    const got = await this.onArt(d.device_id);
    if (this.art !== undefined && this.art !== got) URL.revokeObjectURL(this.art);
    this.art = got;
  }

  override render() {
    const d = this.device;
    if (d === undefined) return nothing;

    const n = nowPlaying(d);
    const declared = new Set((d.schema?.actions ?? []).map((a) => a.id));
    const offer = <T extends { id: string }>(list: readonly T[]): T[] =>
      list.filter((b) => declared.has(b.id));

    // **A combined play/pause is the transport, not one of four buttons.**
    // Both plugins here declare `play`, `pause`, `stop` *and* a toggle, which
    // is honest — a Roku really will accept all four — and rendering all four
    // is a row of alternatives where a person wants one control. A toggle also
    // says the thing the household had to point out twice: a Sonos has play
    // and pause and no stop, and the way to stop offering stop is to stop
    // drawing the separate keys once there is one key that does the job.
    const toggle = (d.schema?.actions ?? []).find((a) => a.icon === TOGGLE_ICON)?.id;
    const separate = new Set(['play', 'pause', 'stop']);
    let claimed = false;
    const transport = offer(TRANSPORT)
      .filter((b) => toggle === undefined || !separate.has(b.id))
      .map((b) => {
        if (b.primary !== true || claimed) return { ...b, primary: false };
        claimed = true;
        return b;
      });

    // **Status first, one control** (§7.2's curation, one step further). A
    // house page wants to know what is playing where, not to conduct it: seven
    // players each with a transport cluster, a volume row and a progress bar
    // is a page about the stereo. Compact keeps the name, what is playing, and
    // the one button somebody actually reaches for — and drops the art wash,
    // the bar and the volume, which are what a room page is for.
    if (this.config['compact'] === true) {
      const primary = transport.find((b) => b.primary) ?? transport[0];
      // Not `.card`: a card is a box with a border and a fill, and seven of
      // them stacked is seven boxes. A status list is a list — the rows are
      // held together by alignment and a hairline, not by each one being its
      // own object.
      return html`<div class="strip" part="player">
        <span class="pip" ?data-on=${n.state === 'playing'}></span>
        <span class="who" part="state">${effectiveName(d)}</span>
        <span class="what" part="name">${n.title ?? n.source ?? summary(n)}</span>
        ${
          primary === undefined
            ? nothing
            : html`<button
                class="quiet"
                part="action"
                title=${humanise(primary.id)}
                aria-label=${humanise(primary.id)}
                @click=${() =>
                  this.onCommand?.({
                    deviceId: d.device_id,
                    action: { id: primary.id, params: {} },
                  })}
              >
                ${icon(primary.mark)}
              </button>`
        }
      </div>`;
    }

    return html`<div class="card" part="player">
      ${this.art === undefined ? nothing : html`<div class="wash" style="background-image:url(${this.art})"></div>`}
      <div class="head" part="head">
        <span class="art" part="indicator">
          ${
            this.art === undefined
              ? icon(n.state === 'playing' ? 'play' : 'media')
              : html`<img src=${this.art} alt="" />`
          }
        </span>
        <span class="lines">
          <span class="where" part="state">${effectiveName(d)}</span>
          <span class="title" part="name">${n.title ?? n.source ?? summary(n)}</span>
          <span class="sub">${n.title === undefined ? nothing : (n.artist ?? summary(n))}</span>
          <span class="album"
            >${n.title === undefined || n.album === undefined ? nothing : n.album}</span
          >
        </span>
      </div>
      ${this.renderProgress(n)} ${this.renderControls(d, n, transport, offer(VOLUME))}
    </div>`;
  }

  private renderProgress(n: NowPlaying) {
    const done = progress(n);
    if (done === undefined) {
      // A live stream says so instead of drawing a bar that never fills.
      return n.live ? html`<div class="progress" part="note"><span>Live</span></div>` : nothing;
    }
    // **How much is left, not how long it is.** The duration never changes
    // while a track plays, so the number on the right sat still for three
    // minutes and answered a question nobody was asking; what somebody
    // glancing at a card wants is whether there is time to start something.
    const left = Math.max(0, (n.duration ?? 0) - (n.position ?? 0));
    return html`<div class="progress" part="note">
      <span>${clock(n.position ?? 0)}</span>
      <span class="track"><span class="fill" style="width:${done * 100}%"></span></span>
      <span>-${clock(left)}</span>
    </div>`;
  }

  /**
   * The transport row and whatever the device offers for volume.
   *
   * Two shapes, and which one a device gets is its own answer: a level it can
   * be set to, or three keys it can be pressed. Nothing here knows what a
   * Sonos is (§5.11) — `set_volume` declares its range, its unit and the
   * reading it moves, and that is the whole slider.
   */
  private renderControls(
    d: DeviceState,
    n: NowPlaying,
    transport: { id: string; mark: string; primary?: boolean }[],
    keys: { id: string; mark: string }[],
  ) {
    const level = levelOf(d);
    const mute = muteOf(d);
    if (transport.length === 0 && keys.length === 0 && level === undefined) return nothing;

    const at = level === undefined ? undefined : numberOf(d.attributes[level.attribute]);
    const muted = mute === undefined ? undefined : d.attributes[mute.attribute] === true;

    return html`<div class="controls">
      ${this.buttons(d, transport)}
      <span class="buttons">
        ${this.buttons(d, keys)}
        ${
          mute === undefined
            ? nothing
            : html`<button
                part="action"
                title=${muted === true ? 'Unmute' : 'Mute'}
                aria-label=${muted === true ? 'Unmute' : 'Mute'}
                ?data-primary=${muted === true}
                @click=${() =>
                  this.onCommand?.({
                    deviceId: d.device_id,
                    action: { id: mute.action, params: { [mute.param]: muted !== true } },
                  })}
              >
                ${icon(muted === true ? 'mute' : 'volume_up')}
              </button>`
        }
        ${
          level === undefined
            ? n.volume === undefined
              ? nothing
              : html`<span class="volume">${Math.round(n.volume)}</span>`
            : html`<input
                  class="level"
                  part="controls"
                  type="range"
                  min=${level.min}
                  max=${level.max}
                  .value=${String(at ?? level.min)}
                  aria-label="Volume"
                  @change=${(e: Event) =>
                    this.onCommand?.({
                      deviceId: d.device_id,
                      action: {
                        id: level.action,
                        params: { [level.param]: Number((e.target as HTMLInputElement).value) },
                      },
                    })}
                />
                <span class="volume">${at === undefined ? '' : Math.round(at)}</span>`
        }
      </span>
    </div>`;
  }

  private buttons(d: DeviceState, list: { id: string; mark: string; primary?: boolean }[]) {
    if (list.length === 0) return nothing;
    return html`<div class="buttons">
      ${list.map(
        (b) =>
          html`<button
            part="action"
            class=${b.mark === 'play' || b.mark === 'play_pause' ? 'fill-mark' : ''}
            title=${humanise(b.id)}
            aria-label=${humanise(b.id)}
            ?data-primary=${b.primary === true}
            @click=${() =>
              this.onCommand?.({ deviceId: d.device_id, action: { id: b.id, params: {} } })}
          >
            ${icon(b.mark)}
          </button>`,
      )}
    </div>`;
  }
}

registerWidget('media_tile', 'hc-media-card');

declare global {
  interface HTMLElementTagNameMap {
    'hc-media-card': HcMediaCard;
  }
}
