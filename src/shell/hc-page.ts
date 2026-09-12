/**
 * A dashboard page: document in, laid-out elements out.
 *
 * Two modes, because the document has two (§14.1). A layout with a `frame` was
 * *composed* — every placement carries a `rect` in frame units and is positioned
 * absolutely, which is what a person meant when they put a reading over a
 * photograph. A layout without one is a *grid*, and CSS Grid draws it from the
 * normalised cells.
 *
 * Both go through `Engine.normalize` first, and that is not a formality: core
 * rejects the whole dashboard on the first illegal placement, so what is drawn
 * has to be what would be saved (§5.7).
 */
import { LitElement, css, html, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
  DashboardBreakpoint,
  DashboardDefinition,
  DashboardGroupBox,
  DashboardLayout,
  DashboardWidget,
} from '../core/dashboard.js';
import { gridItems, layoutToDraw } from '../core/dashboard.js';
import type { Box } from '../core/pages.js';
import { Engine, type DashboardRect, type GridItem } from '../core/layout.js';
import {
  FINE,
  HANDLES,
  alignTo,
  angleFrom,
  boundsOf,
  resizedBy,
  turnedAbout,
  type Guide,
  type Handle,
} from '../core/geometry.js';
import {
  containerOf,
  containerOfBox,
  flowFrames,
  framesByPath,
  framesIn,
  pageRectOf,
  toLocal,
} from '../core/frames.js';
import { deriveDensity } from '../design/tokens.js';
import { clickTarget, groupOf, isUnder, membersOf, segmentsOf, stepOut } from '../core/groups.js';
import type { SelectionContext } from '../core/selection.js';
import { isVisible, selectsDevices } from '../core/visibility.js';
import type { DeviceStore } from '../core/store.js';
import type { CommandRequest } from '../core/widget.js';
import type { EventFetch } from '../widgets/hc-event-feed.js';
import type { HistoryFetch } from '../widgets/hc-history-chart.js';
import { leastFor as leastOfType, tagFor } from '../core/registry.js';
import type { ActionConfig } from '../core/actions.js';
import type { TemplateStore } from '../core/templates.js';
import { mountWidget, specFor, type MountEnv, type MountTarget } from './mount.js';

/**
 * How far a press travels before it is a drag.
 *
 * In screen pixels rather than layout units, because the question is about the
 * hand and not about the document: a finger resting on glass moves a pixel or
 * two, and on a wall panel every press would otherwise be a tiny drag.
 */
const NUDGE = 4;

/**
 * The dense step of the skin's own scale, and when to use it.
 *
 * Taken from `deriveDensity` rather than written out, so there is one place
 * the numbers live and a skin that redefines compact redefines this too.
 */
const COMPACT = deriveDensity('compact');

/** Air under the lowest grown placement, so a page does not end flush. */
const GROWN_MARGIN = 24;

/** Three comfortable rows: below this a box is a strip, not a page. */
const COMPACT_BELOW = deriveDensity('comfortable').rowHeight * 3;

/**
 * Whether a placement is as tall as what is in it.
 *
 * **Opt-in, and it rides in the widget's config** like `layer` and `group` do
 * (§14.1) — core stores the object verbatim, so this needs nothing from the
 * schema and absent means exactly what it has always meant.
 *
 * Opt-in rather than automatic because a composed page is a design: a
 * photograph cropped to a band, a shape sized to a gap, a heading given room
 * beneath it are all placements whose height is the point. Growing every one of
 * them to fit would rearrange somebody's page to fix four cards.
 */
function fitsContent(config: Record<string, unknown> | undefined): boolean {
  return config?.['fit'] === 'content';
}

/**
 * Whether a placement reaches the bottom of the page, however tall it becomes.
 *
 * The other half of the same idea, for the furniture a page is drawn *on*: the
 * ground a composed page is painted over, and the hairline down the middle of
 * two columns. Both are sized to the page rather than to anything in
 * themselves, and both were a number typed once — so the moment a column grew
 * past it, the ground stopped and left an unpainted strip under the last card
 * and the divider stopped short of it.
 *
 * `content` and `page` are the same refusal to hard-code a height, pointed at
 * the two different things that can answer instead.
 */
function fitsPage(config: Record<string, unknown> | undefined): boolean {
  return config?.['fit'] === 'page';
}

/** How many empty rows a grid offers to draw into, below what is on it. */
const SPARE = 3;

/**
 * The rectangle between two points, in whatever units they are in.
 *
 * **Cells are inclusive and pixels are not**, which is the whole of the
 * difference. Dragging from the middle of cell 2 to the middle of cell 4 means
 * three cells, because a cell is a thing you land on; dragging from x=100 to
 * x=400 means 300 pixels, because a pixel is a distance. Getting this wrong
 * gives a grid widget that is one column short of what somebody drew.
 */
function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }, free: boolean): Box {
  // **The corners are clamped, not the box.** A drag that leaves the page to
  // the left has a corner off it, and the rectangle somebody drew is the part
  // that is still on — clamping `x` afterwards and keeping the width instead
  // makes a widget wider than anything they saw, growing to the right as the
  // pointer goes left.
  const x1 = Math.max(0, Math.min(a.x, b.x));
  const y1 = Math.max(0, Math.min(a.y, b.y));
  const x2 = Math.max(0, Math.max(a.x, b.x));
  const y2 = Math.max(0, Math.max(a.y, b.y));

  return free
    ? {
        x: Math.round(x1),
        y: Math.round(y1),
        // A widget with no width is a widget that cannot be grabbed again —
        // the same floor `boxFrom` puts under a resize.
        w: Math.round(Math.max(40, x2 - x1)),
        h: Math.round(Math.max(40, y2 - y1)),
      }
    : { x: x1, y: y1, w: Math.max(1, x2 - x1 + 1), h: Math.max(1, y2 - y1 + 1) };
}

/**
 * A gesture in progress: what is being moved, from where, and by how much.
 *
 * `with` is everything the gesture carries, which for a move is the whole
 * selection and for a resize is one card — §14.1 gives grid mode one grip, and
 * resizing a group is a free-mode gesture with eight handles and a group frame.
 */
interface Drag {
  id: string;
  /**
   * What was taken hold of. `move` drags the card, `size` is grid mode's one
   * grip, `turn` rotates, and the eight named handles are free mode's (§14.1).
   */
  grip: 'move' | 'size' | 'turn' | Handle;
  from: Box;
  dx: number;
  dy: number;
  with: ReadonlySet<string>;
  /** Degrees the card was already at, which a resize has to undo (§14.2). */
  angle: number;
  /** Where the card's centre is on screen, for a turn. */
  centre?: { x: number; y: number };
  /** Where the turn was grabbed, so it is a delta and not a jump. */
  grabbed?: { x: number; y: number };
}

/**
 * One thing a container draws: a widget, or a nested container.
 *
 * `y` is where its author put its top, in the container's own space, and it is
 * the only field the two kinds share — which is all a column needs to order
 * them by. A positioned container ignores it and places everything by
 * coordinate.
 */
interface Row {
  y: number;
  item?: GridItem;
  box?: DashboardGroupBox;
}

@customElement('hc-page')
export class HcPage extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--hc-ink, #e9edf2);
      font-family: var(--hc-font-body, system-ui, sans-serif);
      /* **The skin's own body size, which nothing was using.** The type scale
         defines body at 13px and scales it per skin, and this surface set no
         font-size at all — so every widget that did not name a role inherited
         the browser's 16px. A mode chip came out 162px wide on a 320px strip,
         two of them wrapped, and the strip clipped the second row. The scale
         was right; nothing was reading it. */
      font-size: var(--hc-text-body-size, 13px);
      line-height: var(--hc-text-body-height, 1.4);
    }
    .frame {
      position: relative;
      margin: 0 auto;
      /* A composed page states its own size; the viewport scales to it rather
         than reflowing it, because reflowing a composition is not a smaller
         version of it. */
      transform-origin: top left;
    }
    .grid {
      display: grid;
      align-content: start;
    }
    .placed {
      position: absolute;
      box-sizing: border-box;
      min-width: 0;
    }
    .cell {
      min-width: 0;
    }
    /* **Density follows the box the author drew** (§14.1's rule, applied to
       size rather than to overflow: "a placement is the size the author drew,
       and a widget does not get to disagree").

       One density for every surface is what made the house page wrong. The
       skin is the comfortable step — a 52px row, a 44px tap target — which is
       right for a wall panel and much too big for a composed page whose rects
       were drawn against a denser rendering: two mode chips wrapped to 98px in
       a 56px box, and a row of light pills at 52px did not fit the 44px it was
       given.

       So a short box gets the compact step of the same scale. The tokens are
       custom properties and a widget reads them through inheritance, so this
       needs no change in any widget — and it is automatic, which matters
       because nobody is going to set a density per placement.

       Three comfortable rows is the threshold: below that the box is being
       used for a strip or a short list, and above it there is room to breathe. */
    .placed:not([data-fits]),
    .cell {
      /* **Not on a placement that fits its content**, and this is not a
         detail: a size container is size-contained, so its children stop
         contributing to its height. On a box with a drawn height that is
         exactly right, and it is what makes the query answerable. On a box
         that grows to hold a list it is fatal — the list rendered 1169px
         inside a placement that stayed 250px and clipped it, which is the bug
         this whole change exists to fix, reintroduced one rule later. A box
         with no fixed height has no height to query anyway. */
      container-type: size;
    }
    @container (max-height: ${unsafeCSS(COMPACT_BELOW)}px) {
      .body {
        --hc-density-row-height: ${unsafeCSS(COMPACT.rowHeight)}px;
        --hc-density-control-height: ${unsafeCSS(COMPACT.controlHeight)}px;
        --hc-density-min-tap: ${unsafeCSS(COMPACT.minTapTarget)}px;
        --hc-density-card-padding: ${unsafeCSS(COMPACT.cardPadding)}px;
      }
    }
    /* **And a placement in a column that fits its content is compact.**

       The rule above reads the box an author drew. A placement that fits its
       content no longer has one — that is the whole point of it — so the
       query has nothing to answer with and every such list quietly fell back
       to the comfortable step. Two lists side by side on the room page then
       disagreed about how tall a row is, which is the visible failure and the
       reason this is not left to chance.

       What is left of the author's intent is the column they put it in, and a
       column on a composed page is a dense surface by construction: several
       of them across 1240px, each a section of a page somebody reads at a
       desk. So the container answers where the box no longer can — which is
       the household's own instruction, "follow the box it is in", applied to
       the box that still exists. A wall panel states its density in the skin
       and is not composed this way. */
    .stack .placed[data-fits] > .body {
      --hc-density-row-height: ${unsafeCSS(COMPACT.rowHeight)}px;
      --hc-density-control-height: ${unsafeCSS(COMPACT.controlHeight)}px;
      --hc-density-min-tap: ${unsafeCSS(COMPACT.minTapTarget)}px;
      --hc-density-card-padding: ${unsafeCSS(COMPACT.cardPadding)}px;
    }
    /* A placement is the size the author drew, and a widget does not get to
       disagree. A device set of twelve full cards in a short box escaped its
       rect and drew over three neighbours — which is not a widget that needs
       more room, it is a page that has stopped being the arrangement somebody
       saved. Widgets that scroll (a set, a feed) do it inside this.

       On the widget rather than on the placement, because the placement also
       holds the handles: free mode's turn handle sits *above* the card, and a
       clip on the box around it deleted the handle rather than the overflow.
       The two things want opposite treatment, so they are two elements. */
    /* **The surface takes pointer events before the widget sees them**
       (§14.2). Dragging a card that contains a slider moves the card; it does
       not set brightness — and pressing the toggle in a device row while the
       page is being arranged switched a real outlet, which is what this is
       really about.

       On the body rather than on the placement, because the placement also
       holds the handles: the move grip, the eight resize grips and the turn
       are siblings of this and stay live. And the press still reaches the
       surface, which picks by hit test rather than by event target — so a
       card is selected by pressing it exactly as before, and what changed is
       only that the widget underneath no longer hears it. */
    .frame[data-editing] .body,
    .grid[data-editing] .body {
      pointer-events: none;
    }
    .body {
      width: 100%;
      height: 100%;
      min-width: 0;
      overflow: hidden;
    }
    /* A placement that fits its content is not clipped by it — that is the
       whole difference. It keeps the drawn rect as a floor and grows past it,
       and the canvas grows to hold whatever it reached. */
    .placed[data-fits] > .body {
      height: auto;
      overflow: visible;
    }
    /* The handles, while the page is being arranged (§14.2). Over the widget
       rather than around it: a page that reflowed when the handles appeared
       would be a page you arrange in a shape it does not have.

       **Only the cell.** This rule used to name the composed placement too,
       and being the later rule it won — so every placement on a composed page
       became relatively positioned, fell back into document flow, and the page
       drew as one tall column of stacked boxes with the largest shape over the
       top of everything. A composed page positions by rect and has to be
       absolute; an absolutely positioned box is already a containing block for
       its own handles, so it never needed this. */
    .cell {
      position: relative;
    }
    .grab,
    .grip {
      position: absolute;
      z-index: 5;
      background: var(--hc-accent-active, #ffc978);
      border-radius: var(--hc-radius-sm, 8px);
      opacity: 0.85;
      touch-action: none;
    }
    .grab {
      inset: 0 auto auto 0;
      width: 1.5rem;
      height: 1.5rem;
      cursor: move;
      clip-path: polygon(0 0, 100% 0, 0 100%);
    }
    .grip {
      inset: auto 0 0 auto;
      width: 1.25rem;
      height: 1.25rem;
      cursor: nwse-resize;
      clip-path: polygon(100% 0, 100% 100%, 0 100%);
    }
    [data-dragging] {
      outline: 2px dashed var(--hc-accent-active, #ffc978);
      outline-offset: 2px;
      opacity: 0.85;
    }
    /* Free mode's eight, and the turn above them (§14.1). Small squares on the
       edges and corners rather than the two clipped triangles a packed card
       gets: eight triangles would be eight arrows pointing nowhere in
       particular, and the shape is what says "pull this edge". */
    .edge,
    .turn {
      position: absolute;
      z-index: 5;
      width: 0.75rem;
      height: 0.75rem;
      box-sizing: border-box;
      border: 2px solid var(--hc-accent-active, #ffc978);
      background: var(--hc-surface-base, #0b0e13);
      border-radius: 3px;
      touch-action: none;
    }
    .edge.top-left {
      inset: -0.375rem auto auto -0.375rem;
      cursor: nwse-resize;
    }
    .edge.top {
      inset: -0.375rem auto auto calc(50% - 0.375rem);
      cursor: ns-resize;
    }
    .edge.top-right {
      inset: -0.375rem -0.375rem auto auto;
      cursor: nesw-resize;
    }
    .edge.right {
      inset: calc(50% - 0.375rem) -0.375rem auto auto;
      cursor: ew-resize;
    }
    .edge.bottom-right {
      inset: auto -0.375rem -0.375rem auto;
      cursor: nwse-resize;
    }
    .edge.bottom {
      inset: auto auto -0.375rem calc(50% - 0.375rem);
      cursor: ns-resize;
    }
    .edge.bottom-left {
      inset: auto auto -0.375rem -0.375rem;
      cursor: nesw-resize;
    }
    .edge.left {
      inset: calc(50% - 0.375rem) auto auto -0.375rem;
      cursor: ew-resize;
    }
    /* Above the card and clear of the corner handles, which is where every
       design application puts it and so where a hand goes looking. */
    .turn {
      inset: -1.75rem auto auto calc(50% - 0.375rem);
      border-radius: 50%;
      cursor: grab;
    }
    /* A surface holding a tool (§14.1). The cursor is the only thing that says
       a press will draw rather than select, and without it the mode is
       invisible until somebody has already made a widget by accident. */
    [data-armed] {
      cursor: crosshair;
      touch-action: none;
    }
    /* Where the thing being drawn will land. Outline rather than fill: the
       point of drag-to-create is seeing the size against what is already on
       the page, and a solid block hides the neighbours it is lining up with. */
    .drawing {
      border: 2px dashed var(--hc-accent-active, #ffc978);
      border-radius: var(--hc-radius-md, 14px);
      background: color-mix(in srgb, var(--hc-accent-active, #ffc978) 12%, transparent);
      pointer-events: none;
      z-index: 6;
    }
    .frame > .drawing {
      position: absolute;
      box-sizing: border-box;
    }
    /* A frame's body: the panel a frame draws under its contents. Inert, and
       under everything, because the frame is a coordinate space first — its
       members are ordinary placements drawn at resolved page positions, not
       children in the DOM. */
    /* A frame that lays its members out in a column (§14.1). The container
       a positioned frame does not need to be: a member that grows pushes the
       ones below it down, which only happens if they are really inside it. */
    /* **A container paints nothing.** It is a coordinate space and a layout,
       and the ground under it belongs to the page — these documents lay a
       shape element down for exactly that, deliberately, at the page's size.

       A raised surface here was carried over from the first stacked frame and
       it flattened the room page: every device row is the raised surface, so a
       panel of the same colour behind them left them with nothing but a
       hairline to be seen by, and the rules between sections vanished into it
       as well. The household's words for it were that the widgets blend
       together, and they were reading a page with two grounds on it. */
    .stack {
      position: absolute;
      box-sizing: border-box;
      z-index: 1;
    }
    /* A container that lays its children out in a column. One that does not
       places them at their own rectangles instead, and needs only to be a
       containing block for them, which being positioned already makes it. */
    .stack[data-column] {
      display: flex;
      flex-direction: column;
      align-items: stretch;
    }
    /* A container inside a container: placed by its parent, so in flow when
       the parent is a column and at its stored rectangle when it is not. */
    .stack.inflow {
      position: relative;
      left: auto;
      top: auto;
      width: auto;
      flex: none;
    }
    /* In flow, so the stack decides where it sits. Everything else about a
       placement is unchanged, which is why one function draws both. */
    .placed.inflow {
      position: relative;
      left: auto;
      top: auto;
      width: auto;
      flex: none;
    }
    .framebody {
      position: absolute;
      z-index: 0;
      box-sizing: border-box;
      border: 1px solid var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 14px);
      background: var(--hc-surface-raised, #141922);
      pointer-events: none;
    }
    /* The box around everything held, and the only place a group turn can be
       taken hold of — a cluster has no card whose own handle means "all of
       these". Not interactive itself, so a press inside it still reaches the
       card under the pointer. */
    .cluster {
      position: absolute;
      box-sizing: border-box;
      z-index: 4;
      border: 1px dashed var(--hc-stroke-focus, #7cc4ff);
      pointer-events: none;
    }
    .cluster > .turn {
      pointer-events: auto;
    }
    /* Picked, for a gesture that acts on more than one. Inset rather than an
       outline, so a card at the very edge of the page still shows all four
       sides of its own selection. */
    [data-picked] {
      outline: 2px solid var(--hc-stroke-focus, #7cc4ff);
      outline-offset: -2px;
      border-radius: var(--hc-radius-md, 14px);
    }
    /* The rubber band, in screen space (§14.2). Fixed, and a direct child of
       the shadow root: a transformed ancestor becomes the containing block for
       a fixed element, and the composed frame is transformed. */
    /* A guide, in the same untransformed overlay as the band (§14.2), so it
       stays a hairline however the frame is scaled. */
    .guide {
      position: fixed;
      z-index: 8;
      background: var(--hc-accent-danger, #ff7b72);
      pointer-events: none;
    }
    .band {
      position: fixed;
      z-index: 7;
      border: 1px solid var(--hc-stroke-focus, #7cc4ff);
      background: color-mix(in srgb, var(--hc-stroke-focus, #7cc4ff) 14%, transparent);
      pointer-events: none;
    }
    .unknown {
      display: grid;
      place-items: center;
      height: 100%;
      box-sizing: border-box;
      border: 1px dashed var(--hc-stroke-hairline, #262d38);
      border-radius: var(--hc-radius-md, 14px);
      color: var(--hc-ink-muted, #8b95a4);
      font-size: 0.75rem;
      text-align: center;
      padding: 0.25rem;
      overflow: hidden;
    }
    .empty {
      padding: 2rem;
      text-align: center;
      opacity: 0.6;
    }
  `;

  @property({ attribute: false }) doc: DashboardDefinition | undefined;
  @property({ type: String }) breakpoint: DashboardBreakpoint = 'desktop';
  @property({ attribute: false }) store: DeviceStore | undefined;
  /** Scale a composed page to this width. 0 means draw at natural size. */
  @property({ type: Number }) fitWidth = 0;
  /**
   * Where a widget's commands go.
   *
   * Passed down rather than reached for: a widget holds no token, no base URL
   * and no socket (§19.4), and the host is the one place a safety policy could
   * refuse an actuation (§5.10). This is the seed of `ctx.call`.
   */
  @property({ attribute: false }) onCommand: ((r: CommandRequest) => void) | undefined;
  /** Hold to inspect, everywhere — the non-actuating path (§5.10). */
  @property({ attribute: false }) onDetails: ((deviceId: string) => void) | undefined;

  /** What a placement's `on_tap` does. Dispatched by the host (§5.10). */
  @property({ attribute: false }) onAction: ((a: ActionConfig) => void) | undefined;

  /** Where widget templates come from (§5.4). */
  @property({ attribute: false }) templates: TemplateStore | undefined;

  /** Album or channel art, fetched by the host (§19.4). */
  @property({ attribute: false }) onArt:
    ((deviceId: string) => Promise<string | undefined>) | undefined;

  /**
   * What the plugins can be asked to do, and what this session may run (§5.11).
   *
   * Passed down rather than reached for: the page rebuilds a `MountEnv` from
   * the properties it is given, so a capability the shell holds and never
   * hands over is one no widget on a page can see. That is exactly how this
   * went missing — `hc-app` put `plugins` in *its* env, and `hc-page` builds a
   * different one.
   */
  @property({ attribute: false }) plugins: MountEnv['plugins'];

  @property({ attribute: false }) scopes: readonly string[] | undefined;

  /** Correct a device's presentation (§1.1). */
  @property({ attribute: false }) onUpdateDevice: MountEnv['onUpdateDevice'];

  /** Save the household's icon rules (§11.2). */
  @property({ attribute: false }) onSaveIconRules: MountEnv['onSaveIconRules'];

  /** Save the household's locale, units and clock (§4.2). */
  @property({ attribute: false }) onSavePreferences: MountEnv['onSavePreferences'];

  /** Core's table of what a widget config may hold (§4.4). */
  @property({ attribute: false }) vocabulary: MountEnv['vocabulary'];

  /** The pages this household has, for a widget that links to one. */
  @property({ attribute: false }) pages: MountEnv['pages'];

  /** Save one widget's config back into the page it is on (§14.1). */
  @property({ attribute: false }) onSaveWidget: MountEnv['onSaveWidget'];

  /** Put a widget on the page, or take one off (§14.1). */
  @property({ attribute: false }) onAddWidget: MountEnv['onAddWidget'];
  @property({ attribute: false }) onRemoveWidget: MountEnv['onRemoveWidget'];

  /** Move or resize one, in the layout on screen. */
  @property({ attribute: false }) onPlaceWidget: MountEnv['onPlaceWidget'];

  /**
   * Move several at once, as one edit.
   *
   * Optional, and the surface falls back to moving them one at a time when a
   * host has not wired it. That fallback is honest rather than equivalent: it
   * is several saves and several steps to undo, which is exactly the thing
   * this exists to avoid — so a host that wants a group move to *be* one edit
   * provides this.
   */
  /**
   * Move a container, which is one write to its box (§14.2b).
   *
   * A separate door from `onPlaceWidgets` because it is a different edit, not
   * a batch of the same one: the members do not move at all, and writing them
   * is precisely the bug this exists to stop.
   */
  @property({ attribute: false }) onPlaceGroup:
    ((path: string, by: { x: number; y: number }) => void | Promise<void>) | undefined;

  /**
   * Resize a container, which is one write to its box (§14.2b).
   *
   * The members are untouched, and here that is not only correctness but the
   * point of the gesture: narrowing a column is how a set of rows goes from
   * three across to two, and the rows have no say in it.
   */
  @property({ attribute: false }) onSizeGroup:
    ((path: string, rect: Box) => void | Promise<void>) | undefined;

  @property({ attribute: false }) onPlaceWidgets:
    ((moves: readonly { id: string; box: Box }[]) => Promise<void>) | undefined;

  /**
   * Turn one, on a composed page (§14.1).
   *
   * Its own door rather than a field on a placement write, because it is its
   * own edit: a rectangle and an angle sit side by side in the document
   * (§14.3), grid mode has no rotation at all, and folding it in would put a
   * field on every packed drag that a packed page can never use.
   */
  @property({ attribute: false }) onTurnWidget:
    ((widgetId: string, angle: number) => Promise<void>) | undefined;

  /**
   * Turn a whole cluster, as one edit (§14.1).
   *
   * Separate from `onTurnWidget` because it carries rectangles too: turning a
   * group orbits every member as well as turning it, and a write that only
   * carried angles would spin the cards in place and leave the arrangement
   * exactly where it was.
   */
  @property({ attribute: false }) onTurnWidgets:
    ((turns: readonly { id: string; box: Box; angle: number }[]) => Promise<void>) | undefined;

  /**
   * The widget type held, waiting to be drawn (§14.1).
   *
   * **Held, not chosen.** Picking a type from a list and having the widget
   * appear somewhere is catalogue-then-place, and it is the single thing that
   * makes an editor read as a form with a preview. A tool is held until it is
   * used or dropped, and while it is held this surface draws instead of
   * arranging.
   *
   * The shell owns it because it owns the palette: a page told which tool is
   * held has no business deciding what the household is allowed to hold.
   */
  @property({ type: String }) tool: string | undefined;

  /**
   * Make the held widget at the box somebody dragged out.
   *
   * Separate from `onAddWidget`, which appends at the bottom and is what the
   * catalogue still does (§14.1 — "the catalogue stays"). This one carries a
   * box, so the widget exists at the size and place it was drawn.
   */
  @property({ attribute: false }) onDrawWidget:
    ((type: string, box: Box) => Promise<void>) | undefined;

  /** What is installed, and how to install something (§18.2). */
  @property({ attribute: false }) extensions: MountEnv['extensions'];
  @property({ attribute: false }) onInstallExtension: MountEnv['onInstallExtension'];

  /** A household's own pictures, and how to add one (§9). */
  @property({ attribute: false }) assets: MountEnv['assets'];
  @property({ attribute: false }) onUploadAsset: MountEnv['onUploadAsset'];

  /** Make a template out of a widget on this page, or take one apart (§5.4). */
  @property({ attribute: false }) onMakeTemplate: MountEnv['onMakeTemplate'];
  @property({ attribute: false }) onDetachTemplate: MountEnv['onDetachTemplate'];
  @property({ attribute: false }) onSaveTemplate: MountEnv['onSaveTemplate'];

  /**
   * Viewing or arranging (§14.2).
   *
   * Advisory to a widget and enforced by the host: in `edit` nothing a
   * placement is pressed on actuates, because arranging a page means pressing
   * on a household's locks and lights.
   */
  @property() mode: 'view' | 'edit' = 'view';

  /**
   * What `@room` and `@picked` mean on this page.
   *
   * **This is the placement seam.** A room page is one document reused for
   * every room — the widgets say `area_name: "@room"` and the page says which
   * room, so there is one saved page rather than one per room. Resolving it
   * here rather than inside each widget is what keeps the token out of the
   * widget vocabulary entirely.
   */
  @property({ attribute: false }) context: SelectionContext = {};

  /** The host's history reader — §5.9's `ctx.history`, passed rather than held. */
  @property({ attribute: false }) onFetch: HistoryFetch | undefined;

  /** The host's log reader — same seam as history. */
  @property({ attribute: false }) onEvents: EventFetch | undefined;

  @state() private tick = 0;

  /**
   * Widget elements, by id, so a re-render updates them instead of
   * replacing them. Cleared when the document changes, because ids are only
   * unique within one.
   */
  private readonly elements = new Map<string, HTMLElement>();

  private unsubscribe: (() => void) | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    // One subscription for the page, not one per card. Phase 0 redraws the
    // page on any change; per-widget binding is what P2 and §4.2 are for and
    // arrives with the widgets that declare bindings.
    this.unsubscribe = this.store?.subscribeAll(() => {
      this.tick += 1;
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // A selection is about this surface, right now. Leaving edit mode ends the
    // gesture it belonged to, and a page that came back from being *used* with
    // six cards still highlighted would be offering to move things somebody
    // stopped arranging some time ago.
    if (changed.has('mode') && this.mode !== 'edit' && this.picked.size > 0) {
      this.picked = new Set();
    }

    if (!changed.has('doc')) return;

    // Ids are unique within a document and not across them, so a selection
    // carried to another page would point at whatever happened to share a
    // name. An edit to the *same* page keeps it: that is the case where the
    // selection is still the one somebody made.
    //
    // **Another page, not another version of this one.** The same distinction
    // the element cache below turns on: widget ids are unique within a
    // document and not across documents, so an element cached from the last
    // page would be handed the wrong config — but this used to fire on *any*
    // new document object, and a page being edited is a new document object
    // several times a minute.
    //
    // What that cost: every widget on the page destroyed and rebuilt on every
    // save. A history chart re-fetching six hours of readings, a media card
    // reloading its art, and — the way it was found — a property panel losing
    // which widget it was editing the instant it added one.
    const was = changed.get('doc') as DashboardDefinition | undefined;
    if (was?.id !== this.doc?.id) {
      if (this.picked.size > 0) this.picked = new Set();
      this.elements.clear();
      return;
    }

    // Same page, edited: keep the elements, and drop the ones whose widget is
    // no longer in it. A cache that only grows is a leak on a panel that runs
    // for months, and an id that came back would find a stale element.
    const live = new Set((this.doc?.widgets ?? []).map((w) => w.id));
    for (const key of [...this.elements.keys()]) {
      if (!live.has(key.slice(0, key.lastIndexOf(':')))) this.elements.delete(key);
    }
  }

  override render() {
    const doc = this.doc;
    if (doc === undefined) return html`<div class="empty">No dashboard.</div>`;

    // Not the layout asked for, necessarily. Three of the four dashboards in
    // the reference house carry `desktop` and nothing else, and telling a
    // phone that its dashboard has no mobile layout is honest and useless —
    // the document has 36 widgets and something to show.
    const chosen = layoutToDraw(doc, this.breakpoint);
    if (chosen === undefined) {
      return html`<div class="empty">This dashboard has no layouts.</div>`;
    }
    const layout = chosen.layout;

    const widgets = doc.widgets ?? [];
    const byId = new Map(widgets.map((w) => [w.id, w]));
    const engine = new Engine(layout.columns, layout.flow ?? 'packed');
    const items = engine.normalize(gridItems(layout, widgets));

    // Once per frame, not once per card: a group move is one delta applied to
    // every member, and recomputing it inside the loop would re-normalise the
    // whole page for each of them. `movesFrom` is also what works out the
    // guides, so they are cleared first and refilled by the same pass.
    this.guides = [];
    this.moving = this.dragging === undefined ? undefined : this.movesFrom(this.dragging);

    const scene =
      layout.frame != null
        ? this.composed(items, byId, layout.frame, layout.gap)
        : this.grid(items, byId, layout.columns, layout.row_height, layout.gap);

    // The overlay is a sibling of the scene and never inside it (§14.2).
    return html`${scene}${this.bandOverlay()}${this.guideOverlay()}`;
  }

  /**
   * How tall the page has turned out to be, in frame units.
   *
   * The canvas asks so it can be that tall; a placement drawn to the page asks
   * so it can reach the foot of it. Two answers to that would be a ground that
   * ends somewhere other than the page does, so there is one.
   */
  private pageFoot(drawn?: number): number {
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    const height = drawn ?? layout?.frame?.height ?? 0;
    // The drawn canvas until there is a measurement, and the measurement after
    // — in both directions. A page that could only grow left every room but
    // the busiest ending in a screenful of ground, because the number its
    // author drew was a guess about one room and the rest paid for it.
    return this.grown > 0 ? this.grown : height;
  }

  /** Where each carried widget is going this frame. Derived, not state. */
  private moving: ReadonlyMap<string, Box> | undefined;

  /**
   * The container being carried this frame, and how far, if that is the drag.
   *
   * Derived per frame like `moving` rather than held, for the same reason: a
   * preview is what the surface is showing right now, and state written during
   * a render outlives the gesture (the guides learnt that one).
   *
   * Without it a container drag shows nothing at all — the members do not
   * move, which is the whole fix, so the box is what has to follow the
   * pointer.
   */
  private get carrying(): { path: string; by: { x: number; y: number } } | undefined {
    const moves = this.moving;
    if (moves === undefined || moves.size === 0 || this.onPlaceGroup === undefined) {
      return undefined;
    }
    const path = this.wholeContainer(moves.keys());
    if (path === undefined) return undefined;
    const by = this.deltaOf(moves);
    return by === undefined ? undefined : { path, by };
  }

  /**
   * How far the tallest content-fitting placement reaches, in frame units.
   *
   * Measured after a render rather than computed before one, because the
   * question is what the browser laid out — a list of seven media players is
   * as tall as seven of them are, and nothing upstream of layout knows that.
   * Held as state so the measurement feeds the next frame's canvas height.
   */
  @state() private grown = 0;

  /**
   * How tall each content-fitting container turned out to be, by path.
   *
   * The same measure-after-layout as `grown`, one level in. Held as state so
   * the measurement feeds the next frame's height, and written only when it
   * moved, or the render it triggers would measure again and never settle.
   */
  @state() private fitted: ReadonlyMap<string, number> = new Map();

  /**
   * A composed page, at the size its author drew it.
   *
   * `frame.fit` is the document's own answer to "what happens on a narrower
   * screen", and it was being ignored: the page scaled whenever `fitWidth` was
   * set, which is nobody, and never read the field. The reference house says
   * `scroll` on a 1240×1248 canvas, so a tablet scrolls sideways rather than
   * rendering the composition at two thirds — and a document that says
   * `contain` gets what it asked for instead of the same behaviour.
   */
  private composed(
    items: readonly GridItem[],
    byId: Map<string, DashboardWidget>,
    frame: { width: number; height: number; fit?: string | null },
    _gap: number,
  ) {
    const fit = frame.fit ?? 'scroll';
    const room = this.fitWidth > 0 ? this.fitWidth : this.clientWidth;
    const scale = fit === 'scroll' || room <= 0 ? 1 : room / frame.width;
    // **The page grows to hold what grew.** A placement that fits its content
    // can end up taller than the canvas it was drawn on, and a frame that kept
    // its stated height would simply clip it again one level up.
    const tall = this.pageFoot(frame.height);
    return html`
      <div
        class="frame"
        ?data-armed=${this.armed}
        ?data-editing=${this.mode === 'edit'}
        @pointerdown=${(e: PointerEvent) => this.onSurfacePress(e)}
        style="width:${frame.width}px;height:${tall}px;transform:scale(${scale})"
      >
        ${this.frameBodies(items)} ${this.drawPreview()} ${this.groupFrame()}
        ${this.containers(items, byId, undefined)}
        ${items.map((item) => {
          const w = byId.get(item.id);
          if (w === undefined || item.rect == null) return nothing;
          // A member of a container is drawn by that container, and must not
          // also be drawn here at its stored coordinates.
          if (this.stackedIn(w) !== undefined) return nothing;
          return this.placement(item, w);
        })}
      </div>
    `;
  }

  /**
   * The frames on this layout that render as real containers (§14.1).
   *
   * **A real container, not a backdrop.** A positioned frame can be drawn
   * behind its members because they know where they are; a *stacked* one
   * decides where they are, and the whole point is that a member which grows
   * pushes the ones below it down. That only happens if they are actually in
   * it — so a container renders as an element with its members as children,
   * and on a stacked one nothing about their stored rectangles decides their
   * tops.
   *
   * Their widths come from the column rather than from their rects, because a
   * stack is "these, one under another" and a column of things at four
   * different widths is not what anybody means by that. Their heights are
   * still their own: a drawn height is a height, and `fit: content` is how one
   * says otherwise.
   *
   * **And a container holds containers.** This used to collect member widgets
   * and nothing else, which made a column a list of cards and no more — so the
   * household's Room page, whose left column is a heading, a grid, a rule, a
   * *band of four controls*, and two lists, could not be one. A nested frame
   * is a block in its parent's column, holding its own members at their own
   * rectangles, which `core/frames.ts` already gave the coordinates for: a
   * member's rect is stated in the space of its nearest framed ancestor, so
   * inside that frame's element it is simply where the member goes.
   */
  private containers(
    items: readonly GridItem[],
    byId: Map<string, DashboardWidget>,
    within: string | undefined,
  ): unknown {
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    const flow = flowFrames(layout?.groups);
    if (flow.size === 0) return nothing;
    return framesIn(within, flow).map((box) => this.container(items, byId, box, within, flow));
  }

  /** One container, and everything it holds. */
  private container(
    items: readonly GridItem[],
    byId: Map<string, DashboardWidget>,
    box: DashboardGroupBox,
    within: string | undefined,
    flow: ReadonlyMap<string, DashboardGroupBox>,
  ): unknown {
    const rect = box.rect;
    if (rect == null) return nothing;
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    // A root container sits on the page, so it is placed where the page says
    // it is; a nested one is placed by its parent — in flow when the parent is
    // a column, and at its own stored rectangle when it is not.
    const at = within === undefined ? pageRectOf(box, framesByPath(layout?.groups)) : rect;
    if (at === undefined) return nothing;

    const mine = items.filter((i) => {
      const w = byId.get(i.id);
      return w !== undefined && this.stackedIn(w) === box.path;
    });
    // **A container with nothing in it takes no room.** The room page's SETS
    // band is a colour wheel, a warmth axis and two sliders, every one of them
    // bound to `@picked` — so until a lamp is touched there is nothing for any
    // of them to aim at and all four hide themselves (`core/visibility.ts`).
    // The band went on holding the 132px they were drawn in, which put a hole
    // under the lights in every room where nobody had picked anything: a
    // container that kept its size for contents that are not there.
    if (!this.holdsAnything(items, byId, box, flow)) return nothing;
    const pad = box.padding ?? 0;
    const gap = box.stack_gap ?? 0;
    const stacks = box.stack === true;
    // **A column is as tall as what is in it.** Its drawn height is what its
    // author saw on the day, not a measurement of this room — and keeping it
    // as a floor is precisely the thing the household called "not dynamic":
    // a scene row with no scenes in it left a 180px hole, and a media column
    // in a busy room was cut off at the bottom of a number somebody typed
    // once. `clip` is how a container says it wants the size it was drawn.
    // A positioned container keeps its height either way, because its members
    // are placed by coordinate and growing would move none of them.
    const grows = stacks && box.clip !== true;
    const inFlow = within !== undefined && this.stacksAt(within);

    // A container that places its members by coordinate has no height of its
    // own — absolutely positioned children contribute none — so one that asks
    // to fit its content is measured after layout, like the page is.
    const tall = box.fit === 'content' && !grows ? (this.fitted.get(box.path) ?? at.h) : at.h;
    // Carried, if this is the one in hand: the box follows the pointer and its
    // members hold still inside it, which is what moving a container is.
    // Being resized is the same idea, with the grips deciding the rectangle
    // rather than the pointer's travel.
    const carry = this.carrying;
    const lift = carry?.path === box.path ? carry.by : { x: 0, y: 0 };
    const live = this.sizing?.path === box.path ? this.boxPreview(box.path, at) : at;
    const place = inFlow
      ? ''
      : `left:${live.x + lift.x}px;top:${live.y + lift.y}px;width:${live.w}px;`;
    const size = grows
      ? ''
      : `height:${live === at ? tall : live.h}px;${box.clip === true ? 'overflow:hidden;' : ''}`;

    // Ordering only means something in a column. A positioned container places
    // everything by coordinate, so its children may render in any order — and
    // they stay in document order there, so a `z` on one means what it says.
    const children: Row[] = stacks
      ? this.inColumn(mine, box.path, flow, byId)
      : [
          ...mine.map((item) => ({ y: 0, item })),
          ...framesIn(box.path, flow).map((b) => ({ y: 0, box: b })),
        ];

    return html`<div
      class=${inFlow ? 'stack inflow' : 'stack'}
      data-frame=${box.path}
      ?data-fits=${box.fit === 'content' && !grows}
      ?data-column=${stacks}
      style="${place}${size}padding:${pad}px;${stacks ? `gap:${gap}px` : ''}"
    >
      ${children.map((c) => {
        if (c.box !== undefined) return this.container(items, byId, c.box, box.path, flow);
        if (c.item === undefined) return nothing;
        const w = byId.get(c.item.id);
        return w === undefined ? nothing : this.placement(c.item, w, box.path);
      })}
    </div>`;
  }

  /**
   * A container's children in the order they are drawn down the column.
   *
   * Widgets and nested frames interleave, ordered by the top their author gave
   * them — which is the only thing the two kinds have in common and the only
   * thing a column needs from them. A widget's stored top is in the space of
   * this container (`toLocal`); a nested frame's rectangle already is.
   */
  private inColumn(
    mine: readonly GridItem[],
    path: string,
    flow: ReadonlyMap<string, DashboardGroupBox>,
    byId: Map<string, DashboardWidget>,
  ): Row[] {
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    const frames = framesByPath(layout?.groups);
    const rows: Row[] = [];
    for (const item of mine) {
      const w = byId.get(item.id);
      const r = item.rect;
      const local = r == null ? undefined : toLocal(r, groupOf(w?.config), frames);
      rows.push({ y: local?.y ?? 0, item });
    }
    for (const box of framesIn(path, flow)) rows.push({ y: box.rect?.y ?? 0, box });
    return rows.sort((a, b) => a.y - b.y);
  }

  /**
   * Whether anything inside a container is actually on the page.
   *
   * Recursive, because a band of bands is empty exactly when all of them are,
   * and the question a column asks about a nested container is the same one
   * the page asks about a column.
   *
   * **And a section goes when its set does.** A section is a heading, a rule
   * and a list; a room with no leak sensor wants none of the three, but the
   * heading is visible in every sense the first rule can see — a heading has
   * no devices to be empty of. So a container that holds something which
   * *chooses* devices is as present as those members are, and a container
   * that holds none of them keeps the first rule. That second half is what
   * makes it a rule about sections rather than about headings: the room page's
   * SETS band is three labels and no set, and it stays exactly as long as the
   * labels do.
   */
  private holdsAnything(
    items: readonly GridItem[],
    byId: Map<string, DashboardWidget>,
    box: DashboardGroupBox,
    flow: ReadonlyMap<string, DashboardGroupBox>,
  ): boolean {
    const devices = this.store?.list() ?? [];
    let chooses = false;
    let anything = false;
    for (const item of items) {
      const w = byId.get(item.id);
      if (w === undefined || this.stackedIn(w) !== box.path) continue;
      const shown = isVisible(w.config ?? {}, devices, this.context, w.type);
      if (selectsDevices(w.type, w.config ?? {})) {
        if (shown) return true;
        chooses = true;
      } else if (shown) {
        anything = true;
      }
    }
    const held = framesIn(box.path, flow).some((b) => this.holdsAnything(items, byId, b, flow));
    if (held) return true;
    return chooses ? false : anything;
  }

  /** Whether the container at this path lays its children out in a column. */
  private stacksAt(path: string): boolean {
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    return (layout?.groups ?? []).some((b) => b.path === path && b.stack === true);
  }

  /**
   * The container that lays this widget out, if any.
   *
   * Its own group, or the nearest ancestor of it that is a container — a card
   * in `Wall/Lights` is laid out by `Wall` when `Wall` is the container and
   * `Lights` is only a tag.
   */
  private stackedIn(w: DashboardWidget): string | undefined {
    const path = groupOf(w.config);
    if (path === undefined) return undefined;
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    return containerOf(path, flowFrames(layout?.groups));
  }

  /**
   * One placement, positioned by the page or carried by a stack.
   *
   * One function for both, because everything else about a placement — the
   * handles, the selection, the turn, the clip, the fit — is the same wherever
   * its top came from, and two copies of that is two places to fix a bug in.
   */
  private placement(item: GridItem, w: DashboardWidget, within?: string) {
    const r = item.rect;
    if (r == null) return nothing;
    // A member of a container being carried holds still inside it: the box is
    // what moved, and previewing both would show the contents sliding out of
    // the thing that is carrying them.
    const still = within !== undefined && this.carrying !== undefined;
    // In a column the container decides the top and the width; in a positioned
    // container the member's own rectangle does, and it is already stated in
    // that container's space — which is what `toLocal` gives back, the inverse
    // of the conversion `gridItems` did on the way in.
    const inColumn = within !== undefined && this.stacksAt(within);
    const z = w.config?.['z'];
    const drawn = { x: r.x, y: r.y, w: r.w, h: r.h };
    const at = still ? drawn : this.previewOf(item.id, drawn);
    // A placement that says so is as tall as what is in it (§14.1) — **both
    // ways**. The drawn rect was a floor at first, and a section that is
    // usually empty showed that to be wrong: a PLAYING frame with nothing
    // playing held a 250px hole where one line would do. The name says the
    // content decides, so the content decides; a height somebody wants kept is
    // a placement that does not ask for this.
    const fits = fitsContent(w.config);
    const toFoot = fitsPage(w.config);
    // **Stored and, until now, never acted on.** §14.3 says core keeps `angle`
    // and has no opinion about it; a client that keeps it and does not draw it
    // is a client where turning a card does nothing.
    const turn = this.angleOf(item);
    // A placement drawn to the page reaches the page's foot wherever that has
    // ended up, and never comes up shorter than it was drawn.
    const height = fits
      ? ''
      : `height:${toFoot ? Math.max(at.h, this.pageFoot() - at.y) : at.h}px;`;
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    const spot =
      within === undefined ? at : toLocal(at, groupOf(w.config), framesByPath(layout?.groups));

    return html`<div
      class=${inColumn ? 'placed inflow' : 'placed'}
      data-widget=${item.id}
      ?data-picked=${this.mode === 'edit' && this.picked.has(item.id)}
      ?data-dragging=${this.dragging?.with.has(item.id) === true}
      ?data-fits=${fits}
      ?data-page=${toFoot}
      style="${inColumn ? '' : `left:${spot.x}px;top:${spot.y}px;width:${spot.w}px;`}${height}${
        turn === 0 ? '' : `transform:rotate(${turn}deg);`
      }${typeof z === 'number' ? `z-index:${z}` : ''}"
    >
      <div class="body">${this.draw(w)}</div>
      ${this.handles(item.id, { x: r.x, y: r.y, w: r.w, h: r.h }, item.angle ?? 0)}
    </div>`;
  }

  /**
   * A drag in progress: what is being moved, from where, and by how much.
   *
   * Held rather than written on every pointer move, for two reasons. A write
   * is a save to the household's store, and a drag across a page is a hundred
   * of them; and a page that re-rendered per frame would re-render the thing
   * under the finger, which is how a drag comes off its own handle.
   */
  @state() private dragging: Drag | undefined;

  /**
   * Start a drag, and follow it to the end.
   *
   * Pointer capture, because §14.2 asks for it and because without it a drag
   * that leaves the card — which every drag does — stops getting events.
   */
  private startDrag(e: PointerEvent, id: string, grip: Drag['grip'], box: Box, angle = 0): void {
    if (this.mode !== 'edit' || this.onPlaceWidget === undefined) return;
    // Turning writes through its own door, and a host that has not opened it
    // is one where the handle should do nothing rather than throw.
    if (grip === 'turn' && this.onTurnWidget === undefined) return;
    e.preventDefault();
    e.stopPropagation();

    // **Grabbing an unpicked card picks it**, rather than moving something
    // that is not selected while the selection sits highlighted elsewhere.
    // Shift adds to the selection the way it does everywhere else; a plain
    // grab on something already picked leaves the group alone, because that
    // is the press that is about to move all of it.
    if (!this.picked.has(id)) this.pick(id, e.shiftKey);
    const carrying = grip === 'move' ? new Set(this.picked) : new Set([id]);

    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer considers active — a synthetic event,
      // or one whose device was lifted between the press and this line. The
      // capture is what keeps a drag alive once it leaves the handle, and
      // losing it is worth much less than losing the drag: without this the
      // throw happened *before* the listeners were attached, so the handle
      // did nothing at all and said nothing about why.
    }
    const startX = e.clientX;
    const startY = e.clientY;
    // A turn is measured from the card's middle, which is also what it turns
    // about — read off the drawn element, because that is the one thing the
    // placement cannot say: where the frame put it on this screen.
    const middle = grip === 'turn' ? this.centreOnScreen(id) : undefined;
    this.dragging = {
      id,
      grip,
      from: box,
      dx: 0,
      dy: 0,
      with: carrying,
      angle,
      ...(middle === undefined ? {} : { centre: middle, grabbed: { x: startX, y: startY } }),
    };

    const move = (m: PointerEvent): void => {
      if (this.dragging === undefined) return;
      this.dragging = { ...this.dragging, dx: m.clientX - startX, dy: m.clientY - startY };
    };

    const end = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);

      // The lines belong to the gesture, not to the arrangement — dropping
      // `dragging` is what takes them away, because the next render recomputes
      // them from it and finds nothing being dragged.
      const drag = this.dragging;
      this.dragging = undefined;
      if (drag === undefined) return;

      if (drag.grip === 'turn') {
        if (drag.centre === undefined || drag.grabbed === undefined) return;
        const turned = angleFrom(
          drag.centre,
          drag.grabbed,
          { x: drag.grabbed.x + drag.dx, y: drag.grabbed.y + drag.dy },
          drag.angle,
        );
        // The same rule every other gesture follows: a press that turned
        // nothing is a press, and writing the angle it already had is a save
        // nobody asked for.
        if (turned !== drag.angle) void this.onTurnWidget?.(drag.id, turned);
        return;
      }

      const moves = this.movesFrom(drag);
      const from = this.boxesOf(drag.with);
      // A press that moved nothing is a press, not a drag, and writing the
      // numbers it already had would be a save nobody asked for. For a group
      // it is the same question asked of all of them: one delta moved every
      // card or none of them, so if the first is where it was, so is the rest.
      for (const [id, to] of moves) {
        const was = id === drag.id ? drag.from : from.get(id);
        if (was === undefined) continue;
        if (to.x !== was.x || to.y !== was.y || to.w !== was.w || to.h !== was.h) {
          void this.commit(moves);
          return;
        }
      }
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /**
   * Where a drag has got to, in the layout's own units.
   *
   * **The snap is the grid itself.** §14.1's "coarse magnet" on a packed page
   * is not a separate rule: a cell is the unit, so rounding the pixels to
   * cells *is* the magnet. A composed page has no cells and takes the pixels,
   * divided by the scale the frame is drawn at — the page can be shown at two
   * thirds, and a drag that ignored that would move things half again as far
   * as the finger.
   */
  private boxFrom(drag: Pick<Drag, 'id' | 'grip' | 'from' | 'dx' | 'dy' | 'angle' | 'with'>): Box {
    const step = this.stepOf(drag.dx, drag.dy);
    // Nowhere to measure a cell against — a page that has not been laid out
    // yet. Moving by the raw pixels would send a widget three hundred cells to
    // the right, so a drag that cannot be measured moves nothing.
    if (step === undefined) return drag.from;

    if (drag.grip === 'move') {
      const moved = {
        ...drag.from,
        x: Math.max(0, drag.from.x + step.dx),
        y: Math.max(0, drag.from.y + step.dy),
      };
      // A packed card lands on cells and has nothing finer to line up with;
      // a composed one gets §14.1's third magnet, the neighbours' own edges.
      if (!this.free) return moved;

      const lined = alignTo(moved, this.neighbours(drag.with));
      this.guides = lined.guides;
      return { ...lined.rect, x: Math.max(0, lined.rect.x), y: Math.max(0, lined.rect.y) };
    }
    if (drag.grip === 'turn') return drag.from;

    // **Eight handles, and the fine magnet** — §14.1's free mode. The opposite
    // edge stays put, the edge under the pointer snaps, and a rotated card has
    // the delta turned into its own frame first (`core/geometry.ts`).
    if (drag.grip !== 'size') {
      return resizedBy(drag.from, drag.grip, step, {
        step: FINE,
        angle: drag.angle,
        near: this.neighbours(drag.with),
        ...this.leastFor(drag.id),
      });
    }

    // Grid mode's one grip: the card is anchored top-left and only its extent
    // is in question, which is all a cell grid needs (§14.1).
    return {
      ...drag.from,
      w: Math.max(1, drag.from.w + step.dx),
      h: Math.max(1, drag.from.h + step.dy),
    };
  }

  /**
   * How small this element may be pulled, when it has said it has a floor.
   *
   * A slider that loses its knob below 64 should not be draggable to 48. Read
   * off the widget's own class rather than by measuring it, because §14.2's
   * rule is that every gesture works from the placement alone: measuring would
   * mean reaching inside, and a sandboxed element has no inside to reach into.
   */
  private leastFor(id: string): { leastW?: number; leastH?: number } {
    const type = (this.doc?.widgets ?? []).find((w) => w.id === id)?.type;
    const least = type === undefined ? undefined : leastOfType(type);
    if (least === undefined) return {};
    return {
      ...(least.w === undefined ? {} : { leastW: least.w }),
      ...(least.h === undefined ? {} : { leastH: least.h }),
    };
  }

  /**
   * A distance the finger travelled, in the layout's own units.
   *
   * **The snap is the grid itself.** §14.1's "coarse magnet" on a packed page
   * is not a separate rule: a cell is the unit, so rounding the pixels to
   * cells *is* the magnet. A composed page has no cells and takes the pixels,
   * divided by the scale the frame is drawn at — the page can be shown at two
   * thirds, and a drag that ignored that would move things half again as far
   * as the finger.
   *
   * `undefined` when there is nothing to measure against, which the callers
   * treat as "this drag moves nothing" rather than guessing.
   */
  private stepOf(dx: number, dy: number): { dx: number; dy: number } | undefined {
    if (this.free) {
      const scale = this.frameScale();
      return { dx: Math.round(dx / scale), dy: Math.round(dy / scale) };
    }
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    const cell = this.cellSize(layout);
    if (cell === undefined) return undefined;
    return { dx: Math.round(dx / cell.w), dy: Math.round(dy / cell.h) };
  }

  /**
   * Where every widget a drag is carrying ends up, by id.
   *
   * **One delta for the whole group, clamped once.** Clamping each widget at
   * the page edge on its own is how a selection arrives somewhere deformed:
   * the leftmost card stops at column 0 and the others keep going, so six
   * cards dragged off the left edge come back as a different arrangement from
   * the one that went. The distance is shortened until nothing would go off,
   * and the shape survives.
   *
   * A drag carrying one widget is the same function with a group of one, which
   * is why resize is here too — it has no group, because §14.1 gives grid mode
   * one grip and a group resize is a free-mode gesture with eight handles.
   */
  private movesFrom(drag: Drag): Map<string, Box> {
    const moves = new Map<string, Box>();
    // Turning changes no rectangle at all, so there is nothing here to move.
    if (drag.grip === 'turn') return moves;
    if (drag.grip !== 'move' || drag.with.size <= 1) {
      moves.set(drag.id, this.boxFrom(drag));
      return moves;
    }

    const boxes = this.boxesOf(drag.with);
    const step = this.stepOf(drag.dx, drag.dy);
    if (step === undefined) return moves;

    let { dx, dy } = step;
    for (const box of boxes.values()) {
      dx = Math.max(dx, -box.x);
      dy = Math.max(dy, -box.y);
    }
    for (const [id, box] of boxes) moves.set(id, { ...box, x: box.x + dx, y: box.y + dy });
    return moves;
  }

  /**
   * What a moving element can line up with: everything else on the page.
   *
   * **Everything it is not carrying.** A group dragged as one must not line up
   * with its own members — they are moving by the same delta, so every edge
   * would match from the first pixel and the group would be welded in place.
   */
  private neighbours(carrying: ReadonlySet<string>): DashboardRect[] {
    const now = this.itemsNow();
    if (now === undefined || now.layout.flow !== 'free') return [];
    const rects: DashboardRect[] = [];
    for (const item of now.items) {
      if (carrying.has(item.id) || item.rect == null) continue;
      rects.push(item.rect);
    }
    return rects;
  }

  /**
   * The lines a gesture in progress is lining up with.
   *
   * Derived per frame like `moving`, not state: `boxFrom` fills it in as it
   * works out where the drag lands, and it is reset at the top of every render
   * so a gesture that has ended leaves nothing behind. Held as reactive state
   * it was written *during* render — which Lit would schedule another update
   * for — and cleared at the end of a drag by a line that then ran before
   * `movesFrom` put it straight back.
   */
  private guides: readonly Guide[] = [];

  /** Where this widget should be drawn right now, gesture included. */
  private previewOf(id: string, box: Box): Box {
    const turn = this.turning;
    if (turn?.held.has(id) === true) {
      const was = turn.from.get(id);
      if (was !== undefined) {
        return turnedAbout(was, turn.angles.get(id) ?? 0, turn.by, turn.pivot).rect;
      }
    }
    return this.moving?.get(id) ?? box;
  }

  /**
   * The frames on this layout, drawn as the bodies they are (§14.1).
   *
   * **Under everything, and inert.** A frame is a coordinate space first and a
   * decoration second: its members are drawn as ordinary placements at the
   * page positions `gridItems` already resolved, so the body is a backdrop
   * behind them rather than a parent in the DOM. That keeps one render path
   * for every element — a card inside a frame is mounted exactly like a card
   * that is not — and it is why `pointer-events` is off: a press belongs to
   * whatever is actually under it.
   *
   * `clip` is the one thing the body cannot express this way, and it is left
   * for the gestures arc rather than faked: clipping a backdrop clips nothing.
   */
  private frameBodies(items: readonly GridItem[]) {
    void items;
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    const boxes = layout?.groups ?? [];
    if (boxes.length === 0) return nothing;

    const frames = framesByPath(boxes);
    const flow = flowFrames(boxes);
    return boxes.map((box) => {
      // A container draws its own body — it is a real element, and a backdrop
      // behind it would be a second box in the same place, at page coordinates
      // its contents left the moment their parent started deciding them.
      if (flow.has(box.path)) return nothing;
      const at = pageRectOf(box, frames);
      if (at === undefined) return nothing;
      return html`<div
        class="framebody"
        data-frame=${box.path}
        style="left:${at.x}px;top:${at.y}px;width:${at.w}px;height:${at.h}px"
      ></div>`;
    });
  }

  /**
   * The box around everything held, and the handle that turns it (§14.1).
   *
   * **Only for more than one.** A single card already has eight handles and a
   * turn of its own; a frame around it would be a second turn handle doing the
   * same thing from a different place.
   *
   * Drawn from the *previewed* rectangles, so the frame follows the cluster
   * through the gesture rather than sitting where it used to be — a group
   * frame that lagged its members is a box that says the selection is
   * somewhere it is not.
   */
  private groupFrame() {
    if (this.mode !== 'edit' || !this.free || this.picked.size < 2) return nothing;

    // **A container in hand is resized rather than turned.** Its box is the
    // frame, its own rect is what the grips write, and the selection bounds
    // would be the wrong rectangle anyway — a column drawn 400 tall holding
    // 300 of content is 400, and the members only cover the 300.
    const held = this.sizableContainer();
    if (held !== undefined) return this.containerFrame(held);

    if (this.onTurnWidgets === undefined) return nothing;

    const box = boundsOf([...this.boxesOf(this.picked)].map(([id, b]) => this.previewOf(id, b)));
    if (box === undefined) return nothing;

    return html`<div
      class="cluster"
      style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"
    >
      <div
        class="turn"
        part="action"
        title="Turn these together"
        @pointerdown=${(e: PointerEvent) => this.startGroupTurn(e, box)}
      ></div>
    </div>`;
  }

  /**
   * Turn everything held, about the middle of what is held.
   *
   * Its own gesture rather than a `grip` on the drag state, because it carries
   * something no single-element drag has: a pivot that is not any element's
   * own centre, and a result that changes two fields per member rather than
   * one (`turnedAbout`).
   */
  private startGroupTurn(e: PointerEvent, box: Box): void {
    if (this.mode !== 'edit' || this.onTurnWidgets === undefined) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // The same trade every gesture here makes: a lost capture costs a drag
      // that leaves the handle, a throw costs the gesture (see `startDrag`).
    }

    const pivot = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const held = new Set(this.picked);
    const from = this.boxesOf(held);
    const angles = new Map<string, number>();
    for (const item of this.itemsNow()?.items ?? []) {
      if (held.has(item.id)) angles.set(item.id, item.angle ?? 0);
    }

    const start = { x: e.clientX, y: e.clientY };
    const scale = this.frameScale();
    const at = this.shadowRoot?.querySelector('.frame')?.getBoundingClientRect();
    // The pivot is in frame units; the pointer is in screen ones.
    const centre =
      at === undefined ? start : { x: at.left + pivot.x * scale, y: at.top + pivot.y * scale };

    const turnBy = (m: PointerEvent): number => angleFrom(centre, start, m, 0);

    const move = (m: PointerEvent): void => {
      this.turning = { held, pivot, from, angles, by: turnBy(m) };
    };

    const end = (up: PointerEvent): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      this.turning = undefined;

      const by = turnBy(up);
      // A press that turned nothing is a press.
      if (by === 0) return;
      void this.onTurnWidgets?.(
        [...from].map(([id, b]) => {
          const got = turnedAbout(b, angles.get(id) ?? 0, by, pivot);
          return { id, box: got.rect, angle: got.angle };
        }),
      );
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /** A group turn in progress, so the cluster follows the finger. */
  @state() private turning:
    | {
        held: ReadonlySet<string>;
        pivot: { x: number; y: number };
        from: ReadonlyMap<string, Box>;
        angles: ReadonlyMap<string, number>;
        by: number;
      }
    | undefined;

  /**
   * What angle this item is drawn at right now, turn in progress included.
   *
   * The preview is what makes a rotation gesture usable at all: without it the
   * card sits still until the finger comes up and then jumps to its new angle,
   * which reads as the drag having done nothing and then something else
   * happening.
   */
  private angleOf(item: GridItem): number {
    const turn = this.turning;
    if (turn?.held.has(item.id) === true) {
      const was = turn.from.get(item.id);
      if (was !== undefined) {
        return turnedAbout(was, turn.angles.get(item.id) ?? 0, turn.by, turn.pivot).angle;
      }
    }

    const drag = this.dragging;
    if (drag?.grip === 'turn' && drag.id === item.id && drag.centre && drag.grabbed) {
      return angleFrom(
        drag.centre,
        drag.grabbed,
        { x: drag.grabbed.x + drag.dx, y: drag.grabbed.y + drag.dy },
        drag.angle,
      );
    }
    return item.angle ?? 0;
  }

  /**
   * The middle of a drawn placement, in screen pixels.
   *
   * Measured rather than computed, because it is the one thing the placement
   * cannot say: where the frame's own scale and the page's scroll have put the
   * card on *this* screen. It is still not reaching inside the widget — the
   * element being measured is the host's own `.placed` box (§14.2).
   */
  private centreOnScreen(id: string): { x: number; y: number } | undefined {
    // Scanned rather than selected, like every other lookup on this surface. A
    // widget id comes out of a document and goes into a CSS selector, which is
    // an escaping question nobody should have to get right — and `CSS.escape`
    // is not everywhere, so the answer would have been a throw inside a
    // pointer handler, which is the quietest possible failure.
    for (const el of this.shadowRoot?.querySelectorAll('[data-widget]') ?? []) {
      if (el.getAttribute('data-widget') !== id) continue;
      const at = el.getBoundingClientRect();
      return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
    }
    return undefined;
  }

  /** One cell, in pixels, including the gap that follows it. */
  private cellSize(layout: DashboardLayout | undefined): { w: number; h: number } | undefined {
    const columns = layout?.columns ?? 12;
    const gap = layout?.gap ?? 12;
    const width = this.shadowRoot?.querySelector('.grid')?.clientWidth ?? this.clientWidth;
    if (width <= 0) return undefined;

    return {
      w: Math.max(1, (width - gap * (columns - 1)) / columns + gap),
      h: Math.max(1, (layout?.row_height ?? 120) + gap),
    };
  }

  /** What the composed frame is drawn at, so a drag matches the finger. */
  private frameScale(): number {
    const frame = this.shadowRoot?.querySelector<HTMLElement>('.frame');
    const drawn = frame?.getBoundingClientRect().width ?? 0;
    const natural = frame?.offsetWidth ?? 0;
    return natural > 0 && drawn > 0 ? drawn / natural : 1;
  }

  /**
   * The handles a placement gets while the page is being arranged.
   *
   * Over the widget rather than around it, so nothing about the page's own
   * layout changes when the handles appear — a page that reflowed on entering
   * edit mode would be a page you arrange in a shape it does not have.
   */
  private handles(id: string, box: Box, angle = 0) {
    if (this.mode !== 'edit' || this.onPlaceWidget === undefined) return nothing;
    // **Handles belong to the selection, not to the page.** Thirty-six widgets
    // each wearing a move grip and eight resize grips is three hundred grips
    // over a page somebody is trying to read, and the household's word for it
    // was noisy. Nothing is selected on entering edit mode, so the page is the
    // page until something is pressed.
    if (!this.picked.has(id)) return nothing;

    const move = html`<div
      class="grab"
      part="action"
      title="Move"
      @pointerdown=${(e: PointerEvent) => this.startDrag(e, id, 'move', box, angle)}
    ></div>`;

    // **Grid mode gets one grip; composing gets eight and a turn** (§14.1). A
    // packed card is anchored top-left and only its extent is in question, so
    // a second handle would offer an edit the engine would immediately undo.
    // A composed card has no privileged corner: pulling its left edge left is
    // a different edit from pulling its right edge right, and doing the first
    // with a corner grip is two gestures and an arithmetic problem.
    if (!this.free) {
      return html`${move}
        <div
          class="grip"
          part="action"
          title="Resize"
          @pointerdown=${(e: PointerEvent) => this.startDrag(e, id, 'size', box, angle)}
        ></div>`;
    }

    return html`${move}
      ${HANDLES.map(
        (handle) =>
          html`<div
            class="edge ${handle}"
            part="action"
            title="Resize"
            @pointerdown=${(e: PointerEvent) => this.startDrag(e, id, handle, box, angle)}
          ></div>`,
      )}
      <div
        class="turn"
        part="action"
        title="Turn"
        @pointerdown=${(e: PointerEvent) => this.startDrag(e, id, 'turn', box, angle)}
      ></div>`;
  }

  /**
   * Which placements are picked, for a gesture that acts on more than one.
   *
   * **The page's own, not the shell's.** The tool is the shell's because the
   * palette is chrome and what a household may place is a question about the
   * session; a selection is made *on this surface*, by a rubber band this
   * element draws over its own geometry, and nothing outside needs to know.
   * It survives nothing — another page, leaving edit mode, Escape — because a
   * selection is about the last few seconds the way undo is about the last few
   * minutes.
   */
  @state() private picked: ReadonlySet<string> = new Set();

  /**
   * Pick one, or add it to what is picked.
   *
   * Plain press replaces, shift extends and toggles — the convention every
   * file manager and design application shares, and the one place a person
   * will not read documentation to discover.
   */
  override updated(changed: Map<string, unknown>): void {
    this.measureGrowth();

    // The shell renders the Group and Ungroup buttons and does the writing, so
    // it has to know what is in hand. An event rather than a callback because
    // the selection is the page's (§14.2) and this is it reporting, not the
    // shell reaching in — the same shape as `hc-open-room`.
    if (!changed.has('picked') && !changed.has('inside')) return;
    this.dispatchEvent(
      new CustomEvent('hc-picked', {
        bubbles: true,
        composed: true,
        detail: { ids: [...this.picked], inside: this.inside },
      }),
    );
  }

  /**
   * How far the content-fitting placements actually reach.
   *
   * After layout, because that is the only moment the answer exists: a list is
   * as tall as its rows turned out to be. Written back only when it changed,
   * or the render it triggers would measure again and never settle.
   */
  private measureGrowth(): void {
    const frame = this.shadowRoot?.querySelector<HTMLElement>('.frame');
    if (frame === null || frame === undefined) {
      if (this.grown !== 0) this.grown = 0;
      return;
    }

    // **Measured against the frame, not against an offset parent.** A member
    // of a container has that container as its `offsetParent`, so `offsetTop`
    // answers a different and much smaller question than the one being asked —
    // how far down the *page* the thing reaches. It went unnoticed while every
    // grown card was well inside a canvas taller than it; a nested column put
    // one near the bottom and the page stopped growing to hold it.
    const base = frame.getBoundingClientRect();
    const scale = this.frameScale();
    let reach = 0;

    const bottom = (el: HTMLElement): number =>
      (el.getBoundingClientRect().bottom - base.top) / (scale === 0 ? 1 : scale);
    // **Everything on the page, not only what grew.** The canvas was a floor,
    // so a sparse room ended in four hundred pixels of empty ground under its
    // last section — the same complaint as a frame that would not grow,
    // pointed the other way. The page is as tall as what is on it.
    //
    // Except what is measured *from* the page: a ground drawn to the foot of
    // it would set the height it reads, and the two would chase each other up
    // the screen a margin at a time.
    for (const el of frame.querySelectorAll<HTMLElement>('.placed:not([data-page])')) {
      reach = Math.max(reach, bottom(el));
    }
    // And the containers themselves: one grows when something inside it does,
    // and what ends up lowest is whatever the growth pushed down — which is
    // usually not the thing that grew.
    for (const el of frame.querySelectorAll<HTMLElement>('.stack')) {
      reach = Math.max(reach, bottom(el));
    }
    // A little air under the lowest thing, so a grown page does not end flush
    // against the last row of a list.
    const want = reach === 0 ? 0 : reach + GROWN_MARGIN;
    if (Math.abs(want - this.grown) > 1) this.grown = want;

    this.measureContainers(frame, base, scale);
  }

  /**
   * How tall each container that asked to fit its content turned out to be.
   *
   * A column needs none of this: its members are in flow and push it down. A
   * container that places its members by coordinate is the case — the house's
   * footer band is a modes block beside a scenes block, side by side and so
   * not a column, and absolutely positioned children give their parent no
   * height at all. It held a number somebody typed once, 176px for about 74px
   * of chips, which is the last hard-coded height on the page.
   *
   * Measured from the members rather than from `scrollHeight`, because the
   * container is exactly as tall as this says and asking it how tall its
   * content is would be asking it about the height this sets.
   */
  private measureContainers(frame: HTMLElement, base: DOMRect, scale: number): void {
    const boxes = frame.querySelectorAll<HTMLElement>('.stack[data-fits]');
    if (boxes.length === 0) {
      if (this.fitted.size > 0) this.fitted = new Map();
      return;
    }

    const k = scale === 0 ? 1 : scale;
    const next = new Map<string, number>();
    for (const box of boxes) {
      const path = box.dataset['frame'];
      if (path === undefined) continue;
      const top = box.getBoundingClientRect().top;
      let reach = 0;
      for (const child of box.children) {
        reach = Math.max(reach, (child.getBoundingClientRect().bottom - top) / k);
      }
      // The padding is on the box, so the bottom one has to be added back: a
      // child's bottom is inside it.
      next.set(path, Math.round(reach + (Number(box.style.paddingTop.replace('px', '')) || 0)));
    }

    // Written only when something moved, or this render triggers the next one
    // and the page never settles.
    const same =
      next.size === this.fitted.size &&
      [...next].every(([path, h]) => Math.abs((this.fitted.get(path) ?? -1) - h) <= 1);
    if (!same) this.fitted = next;
  }

  private pick(id: string, extend: boolean): void {
    const held = this.clusterOf(id);
    if (!extend) {
      this.picked = held;
      return;
    }
    const next = new Set(this.picked);
    // A cluster toggles as one: taking one card out of a group you are holding
    // would leave a selection that looks like the group and is not.
    const already = [...held].every((m) => next.has(m));
    for (const m of held) {
      if (already) next.delete(m);
      else next.add(m);
    }
    this.picked = next;
  }

  /**
   * What pressing this element actually puts in hand (§14.1's groups).
   *
   * **One click holds the cluster.** A card in a group is rarely the thing
   * somebody means to move — the group is — and getting at a single member is
   * what `inside` is for. Clicking something outside the group you are
   * standing in takes you back out of it, because a surface that ignored the
   * click would stop responding for reasons nothing on screen explains.
   */
  private clusterOf(id: string): Set<string> {
    const paths = this.groupPaths();
    const path = paths.get(id);

    // Pressing anything that is not in the group you are standing in takes you
    // out of it — **including a card in no group at all**, which the gesture
    // this was ported from leaves you standing in. Staying put there means the
    // next press on a member silently holds one card instead of the cluster,
    // with nothing on screen explaining why.
    if (this.inside !== undefined && (path === undefined || !isUnder(path, this.inside))) {
      this.inside = undefined;
    }

    const target = clickTarget(path, this.standingIn(path));
    return target === undefined ? new Set([id]) : membersOf(paths, target);
  }

  /**
   * The group a press starts from, which is not always none.
   *
   * **A container is structure, and you are always already inside one.** The
   * cluster gesture was written for groups somebody assembled by selecting
   * cards and pressing Group — and the whole value of one is that an ordinary
   * press holds all of it. A section and a column are groups too now, and the
   * same rule applied to them meant pressing one device row held the
   * thirty-five widgets in the left column: a page you cannot edit a card on
   * without pressing three times to get down to it.
   *
   * So the walk starts at the deepest container the element is in rather than
   * at the page, and a press inside a section holds the card. A group with no
   * container anywhere above it behaves exactly as it always did, which is the
   * case §14.1 describes and the one this must not change.
   *
   * Whatever the surface has been told it is standing in still wins, in both
   * directions. Pressing twice goes further in; Escape steps *out*, and out of
   * a container is a real place to be — it is how somebody deliberately takes
   * hold of a whole section again. The automatic position is where a press
   * starts, not a floor under it.
   */
  private standingIn(path: string | undefined): string | undefined {
    if (this.inside !== undefined) return this.inside;
    if (path === undefined) return undefined;
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    return containerOf(path, flowFrames(layout?.groups));
  }

  /** Every widget's group path, by id. */
  private groupPaths(): Map<string, string | undefined> {
    const paths = new Map<string, string | undefined>();
    for (const w of this.doc?.widgets ?? []) paths.set(w.id, groupOf(w.config));
    return paths;
  }

  /**
   * Which group the surface is standing in, or none.
   *
   * Entering is a gesture of its own — a double press — because the whole
   * value of a group is that an ordinary press holds all of it. Escape steps
   * out one level, which is the same key that drops a tool and clears a
   * selection: "never mind", one layer at a time.
   */
  @state() private inside: string | undefined;

  /** Step out of one group, and say whether there was one to step out of. */
  stepOutOfGroup(): boolean {
    if (this.inside === undefined) return false;
    this.inside = stepOut(this.inside);
    return true;
  }

  /** Go into the group this element belongs to, one level down. */
  private enter(id: string): void {
    const path = this.groupPaths().get(id);
    const target = clickTarget(path, this.standingIn(path));
    if (target === undefined) return;
    this.inside = target;
    // Standing inside it, the same press now holds one level deeper.
    this.picked = this.clusterOf(id);
  }

  /**
   * Where each of these sits on screen right now, in the layout's own units.
   *
   * From the *normalised* items rather than the raw placements, because that
   * is what is drawn: gravity has already pulled a packed page's cards up, and
   * a group move computed from the stored numbers would jump the moment it
   * started (§5.7).
   */
  private boxesOf(ids: ReadonlySet<string>): Map<string, Box> {
    const found = new Map<string, Box>();
    const now = this.itemsNow();
    if (now === undefined) return found;

    for (const item of now.items) {
      if (!ids.has(item.id)) continue;
      const r = now.layout.flow === 'free' ? item.rect : undefined;
      found.set(
        item.id,
        r != null
          ? { x: r.x, y: r.y, w: r.w, h: r.h }
          : { x: item.x, y: item.y, w: item.w, h: item.h },
      );
    }
    return found;
  }

  /** The layout on screen and its items, laid out the way `render` lays them. */
  private itemsNow(): { items: readonly GridItem[]; layout: DashboardLayout } | undefined {
    const doc = this.doc;
    if (doc === undefined) return undefined;
    const chosen = layoutToDraw(doc, this.breakpoint);
    if (chosen === undefined) return undefined;

    const layout = chosen.layout;
    const engine = new Engine(layout.columns, layout.flow ?? 'packed');
    return { items: engine.normalize(gridItems(layout, doc.widgets ?? [])), layout };
  }

  /** Write a set of moves, by whichever door the host has opened. */
  private async commit(moves: ReadonlyMap<string, Box>): Promise<void> {
    if (moves.size === 0) return;

    // **The whole of a container in hand is a move of the container.** One
    // delta applied to every member is right for a cluster and exactly wrong
    // here: a member's rectangle is stated in the container's space, so moving
    // all of them moves them within it and leaves the box where it was.
    const held = this.wholeContainer(moves.keys());
    if (held !== undefined && this.onPlaceGroup !== undefined) {
      const by = this.deltaOf(moves);
      if (by !== undefined) await this.onPlaceGroup(held, by);
      return;
    }

    // One call for a group, so it is one entry in the undo stack and one save.
    // A host that has not wired the group door still gets the single-widget
    // one, which is the whole of what this surface could do before.
    if (moves.size > 1 && this.onPlaceWidgets !== undefined) {
      await this.onPlaceWidgets([...moves].map(([id, box]) => ({ id, box })));
      return;
    }
    for (const [id, box] of moves) await this.onPlaceWidget?.(id, box);
  }

  /**
   * The container in hand that the *page* positions, with its rect.
   *
   * A container in a column takes its width from the column and its height
   * from its contents, so there is nothing there to resize and the grips are
   * not offered — §5.11's rule, applied to a gesture rather than to a control.
   */
  private sizableContainer(): { path: string; rect: DashboardRect } | undefined {
    if (this.onSizeGroup === undefined) return undefined;
    const path = this.wholeContainer(this.picked);
    if (path === undefined) return undefined;

    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    const flow = flowFrames(layout?.groups);
    const box = flow.get(path);
    if (box?.rect == null) return undefined;
    const parent = containerOfBox(box, flow);
    if (parent !== undefined && this.stacksAt(parent)) return undefined;

    const at = pageRectOf(box, framesByPath(layout?.groups));
    return at === undefined ? undefined : { path, rect: at };
  }

  /** The frame round a container, with the grips that write its box. */
  private containerFrame(held: { path: string; rect: DashboardRect }) {
    const at = this.boxPreview(held.path, held.rect);
    return html`<div
      class="cluster"
      data-frame=${held.path}
      style="left:${at.x}px;top:${at.y}px;width:${at.w}px;height:${at.h}px"
    >
      ${HANDLES.map(
        (h) =>
          html`<div
            class="grip ${h}"
            part="action"
            title=${`Resize ${held.path}`}
            @pointerdown=${(e: PointerEvent) => this.startBoxResize(e, held, h)}
          ></div>`,
      )}
    </div>`;
  }

  /** A container resize in progress, in the page's own units. */
  @state() private sizing:
    { path: string; from: DashboardRect; grip: Handle; dx: number; dy: number } | undefined;

  /** Where a container's box is right now, preview included. */
  private boxPreview(path: string, rect: DashboardRect): DashboardRect {
    const live = this.sizing;
    if (live === undefined || live.path !== path) return rect;
    return resizedBy(live.from, live.grip, { dx: live.dx, dy: live.dy });
  }

  /**
   * Start resizing a container, and follow it to the end.
   *
   * Its own path rather than `startDrag`'s, because every line of that one is
   * keyed by widget id — what is picked, what is carried, which neighbours to
   * line up with — and a box is none of those things. What they share is the
   * arithmetic, which is `core/geometry.ts` and is where it belongs.
   */
  private startBoxResize(
    e: PointerEvent,
    held: { path: string; rect: DashboardRect },
    grip: Handle,
  ): void {
    if (this.onSizeGroup === undefined) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer considers active. The listeners below
      // still work; only the capture is missing.
    }

    const startX = e.clientX;
    const startY = e.clientY;
    this.sizing = { path: held.path, from: held.rect, grip, dx: 0, dy: 0 };

    const move = (at: PointerEvent): void => {
      const scale = this.frameScale();
      const k = scale === 0 ? 1 : scale;
      this.sizing = {
        path: held.path,
        from: held.rect,
        grip,
        dx: Math.round((at.clientX - startX) / k),
        dy: Math.round((at.clientY - startY) / k),
      };
    };

    const end = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      const live = this.sizing;
      this.sizing = undefined;
      if (live === undefined || (live.dx === 0 && live.dy === 0)) return;
      const next = resizedBy(live.from, live.grip, { dx: live.dx, dy: live.dy });
      // The page rect back into the box's own space, which is the parent's —
      // the same conversion every other write on this surface makes.
      const layout =
        this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
      const flow = flowFrames(layout?.groups);
      const box = flow.get(held.path);
      const space = box === undefined ? undefined : containerOfBox(box, flow);
      const local = toLocal(next, space, framesByPath(layout?.groups));
      void this.onSizeGroup?.(held.path, { x: local.x, y: local.y, w: local.w, h: local.h });
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /**
   * The container whose entire contents are in hand, if that is what this is.
   *
   * Entire, because half a section being dragged out of one is a different
   * edit and a real one — those members are leaving, and moving the box would
   * take the rest with them. Outermost where several match, since holding a
   * column holds every section in it and the column is what somebody grabbed.
   */
  private wholeContainer(ids: Iterable<string>): string | undefined {
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    const flow = flowFrames(layout?.groups);
    if (flow.size === 0) return undefined;

    const held = new Set(ids);
    const paths = this.groupPaths();
    let found: string | undefined;
    for (const path of flow.keys()) {
      const members = [...paths].filter(
        ([, at]) => at !== undefined && (at === path || isUnder(at, path)),
      );
      if (members.length === 0 || members.length !== held.size) continue;
      if (!members.every(([id]) => held.has(id))) continue;
      if (found === undefined || segmentsOf(path).length < segmentsOf(found).length) found = path;
    }
    return found;
  }

  /**
   * How far a set of moves actually moved, from the first one that did.
   *
   * Every member of a container moves by the same delta — that is what makes
   * it one gesture — so one of them is the answer and reading more would be
   * averaging numbers that agree.
   */
  private deltaOf(moves: ReadonlyMap<string, Box>): { x: number; y: number } | undefined {
    const was = this.boxesOf(new Set(moves.keys()));
    for (const [id, box] of moves) {
      const from = was.get(id);
      if (from === undefined) continue;
      return { x: box.x - from.x, y: box.y - from.y };
    }
    return undefined;
  }

  /**
   * Whether a press on this surface draws a widget rather than arranges one.
   *
   * All three have to be true, and the third is the one worth naming: a
   * session that may not write pages can still be handed a tool by a shell
   * that forgot to check, and a surface that armed anyway would draw a
   * rectangle and then throw (§5.11 — not offered rather than offered and
   * refused).
   */
  private get armed(): boolean {
    return this.mode === 'edit' && this.tool !== undefined && this.onDrawWidget !== undefined;
  }

  /**
   * The box being drawn right now, in the layout's own units.
   *
   * Held rather than written, for the same reason a drag is: a create that
   * wrote per frame would make a widget on the first pixel and resize it a
   * hundred times.
   */
  @state() private drawing: Box | undefined;

  /**
   * A press on empty surface, followed to the end, making a widget.
   *
   * **The whole point of §14.1's tool palette.** You hold a tool and drag, and
   * the thing exists at the size and place you dragged it — rather than
   * appearing at the bottom of the page for you to then go and move.
   */
  private startDraw(e: PointerEvent): void {
    const type = this.tool;
    if (!this.armed || type === undefined) return;

    const from = this.pointIn(e.clientX, e.clientY);
    // Nowhere to measure against — a page that has not been laid out yet. The
    // same refusal a move makes, and for the same reason: pixels treated as
    // cells put a widget three hundred columns to the right.
    if (from === undefined) return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is no longer one the browser considers active. Losing the
      // capture costs a drag that leaves the surface; throwing here would cost
      // the gesture entirely (see `startDrag`).
    }

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const move = (m: PointerEvent): void => {
      // A press is not a drag until it has travelled. Without the threshold
      // every click would count as a one-cell drag, and a finger that shifts
      // two pixels on release would make a widget nobody could see.
      if (Math.abs(m.clientX - startX) > NUDGE || Math.abs(m.clientY - startY) > NUDGE) {
        moved = true;
      }
      const to = this.pointIn(m.clientX, m.clientY);
      if (to !== undefined)
        this.drawing = moved ? boxBetween(from, to, this.free) : this.atPoint(from);
    };

    const end = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);

      const box = this.drawing ?? this.atPoint(from);
      this.drawing = undefined;
      void this.onDrawWidget?.(type, box);
    };

    // A press that never moves still makes a widget, at the size the catalogue
    // would have given it, where the pointer is. Refusing would mean a tool
    // that is held and does nothing, which reads as broken rather than strict.
    this.drawing = this.atPoint(from);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /**
   * What a press on the surface means, which depends on whether a tool is held.
   *
   * One handler rather than two listeners, because the two gestures start
   * identically — a press on the surface that may or may not travel — and
   * deciding once here is the difference between a rule and a race.
   */
  private onSurfacePress(e: PointerEvent): void {
    if (this.armed) this.startDraw(e);
    else this.startBand(e);
  }

  /**
   * The rubber band, in screen pixels.
   *
   * **Screen, not layout.** §14.2 puts the marquee in an untransformed overlay
   * so it holds a constant pixel size at any zoom, and the same choice makes
   * the hit test trivial: everything it is compared against is a
   * `getBoundingClientRect`, which is screen pixels too. A band in cells would
   * have to be converted back for every comparison, and would snap to the grid
   * while being dragged — which is the one thing a rubber band must not do.
   */
  @state() private band: { x: number; y: number; w: number; h: number } | undefined;

  /**
   * A press on the surface with no tool held: sweep up what it covers.
   *
   * The press may well land on a widget rather than between them — in edit
   * mode a card is scenery, and §14.2 has the designer taking pointer events
   * before the widget sees them — so a press that never travels is a click on
   * whatever was under it, and one that travels is a band.
   */
  private startBand(e: PointerEvent): void {
    if (this.mode !== 'edit' || this.armed) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    const extend = e.shiftKey;
    // What was picked before the sweep, so shift adds to it rather than
    // replacing it with whatever the band happens to be over right now.
    const already = extend ? new Set(this.picked) : new Set<string>();

    e.preventDefault();
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Same trade as every other gesture here: a lost capture costs a drag
      // that leaves the surface, a throw costs the gesture (see `startDrag`).
    }

    let travelled = false;

    const move = (m: PointerEvent): void => {
      if (Math.abs(m.clientX - startX) > NUDGE || Math.abs(m.clientY - startY) > NUDGE) {
        travelled = true;
      }
      if (!travelled) return;
      this.band = {
        x: Math.min(startX, m.clientX),
        y: Math.min(startY, m.clientY),
        w: Math.abs(m.clientX - startX),
        h: Math.abs(m.clientY - startY),
      };
      const swept = new Set(already);
      for (const id of this.within(this.band)) swept.add(id);
      this.picked = swept;
    };

    const end = (upon: PointerEvent): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      this.band = undefined;

      if (travelled) return;
      // A click, not a sweep. On a card it picks that card; on the gaps
      // between them it clears, which is where somebody presses to mean
      // "never mind" without reaching for a key.
      const on = this.placementAt(upon.clientX, upon.clientY);
      if (on === undefined) {
        if (!extend) this.picked = new Set();
        return;
      }
      // A second press in the same place goes *into* the group rather than
      // holding it — the gesture of its own that §14.1's "one click holds the
      // cluster" needs, or a member could never be reached at all.
      if (upon.detail >= 2) this.enter(on);
      else this.pick(on, extend);
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  /**
   * Which placements a screen rectangle touches.
   *
   * **Touches, not contains.** A band has to reach round every card it means
   * to take, and on a page of twelve-column cards that is most of the width
   * for one row — so a containment test makes the gesture unusable at exactly
   * the size of thing it is for.
   */
  private within(band: { x: number; y: number; w: number; h: number }): string[] {
    const hit: string[] = [];
    for (const el of this.shadowRoot?.querySelectorAll('[data-widget]') ?? []) {
      const at = el.getBoundingClientRect();
      const misses =
        at.right < band.x ||
        at.left > band.x + band.w ||
        at.bottom < band.y ||
        at.top > band.y + band.h;
      if (!misses) {
        const id = el.getAttribute('data-widget');
        if (id !== null) hit.push(id);
      }
    }
    return hit;
  }

  /** Which placement is under a point on screen, if any. */
  private placementAt(x: number, y: number): string | undefined {
    for (const el of this.shadowRoot?.querySelectorAll('[data-widget]') ?? []) {
      const at = el.getBoundingClientRect();
      if (x >= at.left && x <= at.right && y >= at.top && y <= at.bottom) {
        return el.getAttribute('data-widget') ?? undefined;
      }
    }
    return undefined;
  }

  /**
   * The rubber band, drawn outside everything the page transforms (§14.2).
   *
   * A direct child of the shadow root and `position: fixed`, which matters on
   * a composed page: `.frame` carries a `transform`, and a transformed
   * ancestor becomes the containing block for `fixed` — so a band drawn inside
   * it would be scaled by the very thing it is measuring against.
   */
  /**
   * The lines a gesture is currently lining up with (§14.1, §14.2).
   *
   * **Computed in frame units and drawn in screen ones.** The claim a guide
   * makes — this edge and that edge are the same — is only true in the
   * coordinate space the two rectangles live in, so that is where `alignTo`
   * works. But §14.2 puts guides in the untransformed overlay, and the reason
   * shows up on a `contain` frame: a line inside a scaled frame is a scaled
   * line, so the hairline that says "these are aligned" gets thinner as the
   * page gets smaller and disappears exactly when the alignment is hardest to
   * see by eye.
   */
  private guideOverlay() {
    if (this.guides.length === 0 || !this.free) return nothing;
    const frame = this.shadowRoot?.querySelector('.frame')?.getBoundingClientRect();
    if (frame === undefined) return nothing;
    const k = this.frameScale();

    return html`${this.guides.map((g) => {
      const from = frame.left + g.from * k;
      const to = frame.left + g.to * k;
      return g.axis === 'x'
        ? html`<div
            class="guide"
            style="left:${frame.left + g.at * k}px;top:${frame.top + g.from * k}px;
                   width:1px;height:${(g.to - g.from) * k}px"
          ></div>`
        : html`<div
            class="guide"
            style="left:${from}px;top:${frame.top + g.at * k}px;
                   height:1px;width:${to - from}px"
          ></div>`;
    })}`;
  }

  private bandOverlay() {
    const band = this.band;
    if (band === undefined) return nothing;
    return html`<div
      class="band"
      style="left:${band.x}px;top:${band.y}px;width:${band.w}px;height:${band.h}px"
    ></div>`;
  }

  /** Whether the layout on screen composes by rect rather than by cell. */
  private get free(): boolean {
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    return layout?.flow === 'free';
  }

  /**
   * A point on the screen, in the units the layout is written in.
   *
   * Cells on a packed page and frame pixels on a composed one — the same split
   * `boxFrom` makes for a drag, and for the same reason: writing cells into a
   * composed layout moves nothing and looks broken.
   */
  private pointIn(clientX: number, clientY: number): { x: number; y: number } | undefined {
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;

    if (layout?.flow === 'free') {
      const frame = this.shadowRoot?.querySelector('.frame');
      if (frame === null || frame === undefined) return undefined;
      const at = frame.getBoundingClientRect();
      const scale = this.frameScale();
      return { x: (clientX - at.left) / scale, y: (clientY - at.top) / scale };
    }

    const grid = this.shadowRoot?.querySelector('.grid');
    const cell = this.cellSize(layout);
    if (grid === null || grid === undefined || cell === undefined) return undefined;
    const at = grid.getBoundingClientRect();
    return {
      x: Math.floor((clientX - at.left) / cell.w),
      y: Math.floor((clientY - at.top) / cell.h),
    };
  }

  /** The size a widget gets when it was pointed at rather than dragged out. */
  private atPoint(from: { x: number; y: number }): Box {
    const layout =
      this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout;
    // The same defaults `placeBelow` uses, so a widget is the size somebody is
    // used to whichever way they made it.
    const size = this.free ? { w: 360, h: 200 } : { w: Math.min(6, layout?.columns || 12), h: 2 };
    return { x: Math.max(0, Math.round(from.x)), y: Math.max(0, Math.round(from.y)), ...size };
  }

  /** The rectangle being drawn, drawn — in the grid, or in the frame. */
  private drawPreview() {
    const box = this.drawing;
    if (box === undefined) return nothing;

    return this.free
      ? html`<div
          class="drawing"
          style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"
        ></div>`
      : html`<div
          class="drawing"
          style="grid-column:${box.x + 1}/span ${box.w};grid-row:${box.y + 1}/span ${box.h}"
        ></div>`;
  }

  private grid(
    items: readonly GridItem[],
    byId: Map<string, DashboardWidget>,
    columns: number,
    rowHeight: number,
    gap: number,
  ) {
    // **Somewhere to draw, and somewhere to press.** A CSS grid is exactly as
    // tall as its rows, so the empty space below the last widget — which is
    // where a person reaches to put the next one, and where they press to mean
    // "never mind" — does not exist as far as the pointer is concerned.
    //
    // The whole of edit mode and not only while a tool is held, which is what
    // it was at first: with no surface below the cards, the only place to
    // start a rubber band was the gaps between them, and a click meant to
    // clear the selection landed on nothing and did nothing. It shrinks again
    // on leaving, because a page permanently taller than its content would be
    // scrollable past the end for everyone, including a wall panel that is
    // only ever looked at.
    const used = items.reduce((low, i) => Math.max(low, i.y + i.h), 0);
    const room = this.mode === 'edit' ? `min-height:${(used + SPARE) * (rowHeight + gap)}px;` : '';

    return html`
      <div
        class="grid"
        ?data-armed=${this.armed}
        ?data-editing=${this.mode === 'edit'}
        @pointerdown=${(e: PointerEvent) => this.onSurfacePress(e)}
        style="grid-template-columns:repeat(${columns},1fr);
               grid-auto-rows:${rowHeight}px;
               gap:${gap}px;${room}"
      >
        ${this.drawPreview()}
        ${items.map((item) => {
          const w = byId.get(item.id);
          if (w === undefined) return nothing;
          // Where it is going, while a finger is on it. The document is not
          // written until the drag ends, so this is the only thing that says
          // where the drop will land.
          const at = this.previewOf(item.id, { x: item.x, y: item.y, w: item.w, h: item.h });
          return html`<div
            class="cell"
            data-widget=${item.id}
            ?data-picked=${this.mode === 'edit' && this.picked.has(item.id)}
            ?data-dragging=${this.dragging?.with.has(item.id) === true}
            style="grid-column:${at.x + 1}/span ${at.w};
                   grid-row:${at.y + 1}/span ${at.h}"
          >
            <div class="body">${this.draw(w)}</div>
            ${this.handles(item.id, { x: item.x, y: item.y, w: item.w, h: item.h })}
          </div>`;
        })}
      </div>
    `;
  }

  /**
   * Draw one widget, or say plainly that we cannot.
   *
   * An unknown `type` is expected, not exceptional (see `widgets/registry.ts`):
   * core accepts types it has never heard of, so a client that treats one as an
   * error is a client that breaks whenever a plugin ships a card. The
   * placeholder names the type, which is also what makes it useful while the
   * widget family is still being written.
   */
  /** What every widget on this page is given (§4.2's shape, in practice). */
  private env(): MountEnv {
    return {
      store: this.store,
      context: this.context,
      // The page owns `@picked`, because every other element resolving that
      // token is resolving it here (§14.1).
      onPick: (deviceId: string) => {
        this.context = { ...this.context, picked: deviceId };
      },
      // Tapping a room opens it: the same document, a different `@room`.
      onOpenRoom: (room, page) => {
        this.dispatchEvent(
          new CustomEvent('hc-open-room', {
            detail: { room, page },
            bubbles: true,
            composed: true,
          }),
        );
      },
      ...(this.templates !== undefined ? { templates: this.templates } : {}),
      ...(this.onCommand !== undefined ? { onCommand: this.onCommand } : {}),
      ...(this.onFetch !== undefined ? { onFetch: this.onFetch } : {}),
      ...(this.onEvents !== undefined ? { onEvents: this.onEvents } : {}),
      ...(this.onDetails !== undefined ? { onDetails: this.onDetails } : {}),
      ...(this.onAction !== undefined ? { onAction: this.onAction } : {}),
      ...(this.onArt !== undefined ? { onArt: this.onArt } : {}),
      ...(this.plugins !== undefined ? { plugins: this.plugins } : {}),
      ...(this.scopes !== undefined ? { scopes: this.scopes } : {}),
      ...(this.onUpdateDevice !== undefined ? { onUpdateDevice: this.onUpdateDevice } : {}),
      ...(this.onSaveIconRules !== undefined ? { onSaveIconRules: this.onSaveIconRules } : {}),
      ...(this.onSavePreferences !== undefined
        ? { onSavePreferences: this.onSavePreferences }
        : {}),
      ...(this.vocabulary !== undefined ? { vocabulary: this.vocabulary } : {}),
      ...(this.pages !== undefined ? { pages: this.pages } : {}),
      ...(this.onSaveWidget !== undefined ? { onSaveWidget: this.onSaveWidget } : {}),
      ...(this.onAddWidget !== undefined ? { onAddWidget: this.onAddWidget } : {}),
      ...(this.onRemoveWidget !== undefined ? { onRemoveWidget: this.onRemoveWidget } : {}),
      ...(this.onPlaceWidget !== undefined ? { onPlaceWidget: this.onPlaceWidget } : {}),
      // The layout actually on screen, which is not always the one for this
      // size (§5.7). A surface that showed the numbers from a layout nobody is
      // looking at would be showing the wrong arrangement.
      pagePlacements:
        this.doc === undefined ? undefined : layoutToDraw(this.doc, this.breakpoint)?.layout,
      breakpoint: this.breakpoint,
      mode: this.mode,
      ...(this.extensions !== undefined ? { extensions: this.extensions } : {}),
      ...(this.assets !== undefined ? { assets: this.assets } : {}),
      ...(this.onMakeTemplate !== undefined ? { onMakeTemplate: this.onMakeTemplate } : {}),
      ...(this.onDetachTemplate !== undefined ? { onDetachTemplate: this.onDetachTemplate } : {}),
      ...(this.onSaveTemplate !== undefined ? { onSaveTemplate: this.onSaveTemplate } : {}),
      ...(this.onUploadAsset !== undefined ? { onUploadAsset: this.onUploadAsset } : {}),
      ...(this.onInstallExtension !== undefined
        ? { onInstallExtension: this.onInstallExtension }
        : {}),
      // The page it is drawing, so a widget that edits one can offer the
      // choice. Taken from the document rather than passed in: this element
      // already has it, and a second source would be a second answer.
      pageWidgets: this.doc?.widgets ?? [],
    };
  }

  private draw(w: DashboardWidget) {
    // An element the document says to hide is not drawn at all, rather than
    // drawn and hidden: the SETS controls exist to aim at a light you have
    // touched, and before you touch one there is nothing to aim at (§14.1).
    if (!isVisible(w.config ?? {}, this.store?.list() ?? [], this.context, w.type)) return nothing;

    // A template instance stands for another widget entirely, so what to draw
    // is decided before which tag draws it (§5.4).
    const spec = specFor({ type: w.type, config: w.config ?? {} }, this.env());
    const tag = tagFor(spec.type);
    if (tag === undefined) {
      const said = spec.config?.['text'];
      return html`<div class="unknown" part="unknown">
        ${typeof said === 'string' ? said : spec.type}
      </div>`;
    }

    // **Reused, not recreated.** `draw` runs on every render, and the page
    // re-renders on every device change — 184 devices streaming means many a
    // second. Creating a fresh element each time destroys and rebuilds every
    // widget, which reads as a flicker and, for the history chart, re-fetches
    // six hours of readings each time. Keyed by the widget's own id, which is
    // exactly what it is for.
    const key = `${w.id}:${tag}`;
    const cached = this.elements.get(key);
    const el = (cached ?? document.createElement(tag)) as MountTarget;
    this.elements.set(key, el);

    // One wiring, shared with the overlay (§5.6): a widget that works on a
    // page works in a sheet, because it is given the same things in both.
    //
    // **Caught, because a widget is somebody else's code** (§8.1). A throw
    // here used to propagate out of `render`, which aborts the *page* — Lit
    // leaves the previous frame's DOM in place, so the symptom is a dashboard
    // that has quietly stopped updating while the new document is already
    // installed. One extension with a bad config is not allowed to do that;
    // the widget that failed says so where it sits and the rest draw.
    try {
      mountWidget(el, spec, this.env());
    } catch (e) {
      // Dropped from the cache: a half-mounted element would be reused on the
      // next render and fail the same way with its state already wrong.
      this.elements.delete(key);
      return html`<div class="unknown" part="unknown">
        ${spec.type}: ${e instanceof Error ? e.message : String(e)}
      </div>`;
    }
    el.style.height = '100%';
    return el;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-page': HcPage;
  }
}
