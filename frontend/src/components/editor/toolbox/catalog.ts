// aidir3 fork: every tool of the docked pro toolbox, in one place: name,
// shortcut, icon, one-line description, section, and what it does.
//
// The sections and tool names follow the previous aidir3 Design editor's
// toolbox so it reads as the same toolbox. A tool is listed only if it does
// something in this editor: it activates a canvas tool, inserts an element,
// runs a command on the selection, or opens the panel that holds the control.
// Tools that need canvas interaction this editor does not have are left out
// rather than stubbed.
//
// `tr()` is only ever called inside toolboxSections(), never at module scope,
// so every label follows the interface language.

import {
  ArrowBigRight,
  Blend,
  Circle,
  Combine,
  Crop,
  Eclipse,
  Flag,
  Grid3x3,
  Heart,
  Hexagon,
  Link2,
  Maximize,
  MessageSquare,
  MessageSquarePlus,
  MousePointer2,
  MousePointerClick,
  MoveUpRight,
  PaintRoller,
  Paintbrush,
  PenLine,
  PenTool,
  Pencil,
  Pipette,
  ScanSearch,
  Scissors,
  Shell,
  SlidersHorizontal,
  Sparkle,
  Sparkles,
  Square,
  SquareMinus,
  SquaresExclude,
  SquaresIntersect,
  SquaresUnite,
  Star,
  Table2,
  TextCursorInput,
  Type,
  Workflow,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import type { PathContour } from "@hc/schema";
import { tr } from "@/lib/i18n";
import { complexStar, complexStars, familyShape, graphPaper, previewContours, spiral, type BuiltShape, type ShapeStyle } from "@/lib/toolbox/shapes";
import {
  canvasTool,
  combineShapes,
  connectSelection,
  cropSelection,
  insertParagraph,
  insertPathShape,
  insertRegularShape,
  insertTable,
  nodeTool,
  pickScreenColor,
  pickTool,
  refineSelection,
  regularPreview,
  revealPropertiesSection,
  setOpacity,
  smartDrawTool,
  toggleShadow,
  zoomActualSize,
  zoomFitPage,
  zoomIn,
  zoomOut,
  zoomToSelection,
} from "./actions";

export type SectionId = "select" | "draw" | "shapes" | "text" | "connect" | "effects" | "color" | "photo" | "nav";

/** What the toolbox knows about the editor when it draws itself: enough to
 *  highlight the active tool and to say why a tool cannot run right now. */
export interface ToolState {
  tool: string;
  nodeEdit: boolean;
  smartDraw: boolean;
  canEdit: boolean;
  canComment: boolean;
  /** Types of the selected nodes. */
  types: string[];
  /** The one selected node is a photo that is neither rotated nor scaled. */
  croppable: boolean;
  /** The one selected node is locked. */
  locked: boolean;
  /** Some selected node has a drop shadow. */
  shadow: boolean;
  /** Some selected node takes a fill (the Properties panel shows Fill for it). */
  fillable: boolean;
  /** Some selected node can take a colour: a fill, or text. */
  colorable: boolean;
  /** The browser has a screen colour picker. */
  screenPicker: boolean;
}

/** What a tool may ask of the toolbox when it runs. */
export interface ToolEnv {
  /** Confirms an insert, the way the Elements panel does. */
  inserted(name: string): void;
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  blocked?(s: ToolState): string | null;
  run(env: ToolEnv): void;
}

export interface ShapeItem {
  id: string;
  label: string;
  /** The shape in a 100 x 100 box and how it is painted, drawn on its tile. */
  preview(): { contours: PathContour[]; paint: ShapeStyle };
  run(env: ToolEnv): void;
}

export type Flyout = { kind: "menu"; items: MenuItem[] } | { kind: "shapes"; items: ShapeItem[] };

export interface Tool {
  id: string;
  label: string;
  /** One line on what the tool does. */
  tip: string;
  icon: LucideIcon;
  shortcut?: string;
  /** True while this is the tool the canvas is using. */
  active?(s: ToolState): boolean;
  /** True while a switch the tool controls is on (a drop shadow). */
  on?(s: ToolState): boolean;
  /** Why the tool cannot run right now, or null when it can. */
  blocked?(s: ToolState): string | null;
  /** Left out entirely when true (no screen colour picker in this browser). */
  hidden?(s: ToolState): boolean;
  run?(env: ToolEnv): void;
  flyout?: Flyout;
}

export interface ToolSection {
  id: SectionId;
  label: string;
  /** A one-word name for the icon-only layout. */
  short: string;
  tools: Tool[];
}

// Keys are shown as the platform prints them, like the shortcuts sheet does.
// Resolved once at module scope so rendering stays pure.
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
const mod = mac ? "Cmd" : "Ctrl";
const keyZoomIn = `${mod} +`;
const keyZoomOut = `${mod} -`;
const keyFit = "Shift+1";
const keySelection = "Shift+2";

const noShadow = new Set(["text", "image", "group"]);

export function toolboxSections(): ToolSection[] {
  const needEdit = (s: ToolState) => (s.canEdit ? null : tr("editor.you_do_not_have_edit_access"));
  const needSelection = (s: ToolState) => needEdit(s) ?? (s.types.length ? null : tr("editor.toolbox_need_selection"));
  const needPhoto = (s: ToolState) => needEdit(s) ?? (s.types.length === 1 && s.types[0] === "image" ? null : tr("editor.toolbox_need_photo"));
  const needCroppable = (s: ToolState) => needPhoto(s) ?? (s.croppable ? null : tr("editor.reset_rotation_scale_to_crop"));
  const needUnlockedPhoto = (s: ToolState) => needPhoto(s) ?? (s.locked ? tr("editor.toolbox_need_unlocked") : null);
  const needShapes = (s: ToolState) => needEdit(s) ?? (s.types.filter((t) => t === "shape").length >= 2 ? null : tr("editor.toolbox_need_two_shapes"));
  const needPair = (s: ToolState) => needEdit(s) ?? (s.types.length === 2 && !s.types.includes("connector") ? null : tr("editor.toolbox_need_two_objects"));
  const needShadowable = (s: ToolState) => needEdit(s) ?? (s.types.some((t) => !noShadow.has(t)) ? null : tr("editor.toolbox_need_shape"));
  const needFillable = (s: ToolState) => needEdit(s) ?? (s.fillable ? null : tr("editor.toolbox_need_fillable"));
  const needColorable = (s: ToolState) => needEdit(s) ?? (s.colorable ? null : tr("editor.toolbox_need_colorable"));

  /** A flyout tile that places a ready-made path shape. `name` is what the
   *  new layer is called when the tile's own label would not read as one. */
  const pathItem = (id: string, label: string, build: () => BuiltShape | null, name = label): ShapeItem => ({
    id,
    label,
    preview: () => {
      const shape = build();
      return shape ? { contours: previewContours(shape), paint: shape.style } : { contours: [], paint: "fill" };
    },
    run: (env) => {
      const shape = build();
      if (!shape) return;
      insertPathShape(shape, name);
      env.inserted(name);
    },
  });
  /** A flyout tile that places a regular polygon or star shape node. */
  const regularItem = (id: string, label: string, kind: "polygon" | "triangle" | "star", sides: number, innerRadius?: number): ShapeItem => ({
    id,
    label,
    preview: () => ({ contours: regularPreview(sides, innerRadius), paint: "fill" }),
    run: (env) => {
      insertRegularShape(kind, sides, label, innerRadius);
      env.inserted(label);
    },
  });
  const arrow = (id: string, label: string) => pathItem(id, label, () => familyShape("arrows", id));
  const flow = (id: string, label: string) => pathItem(id, label, () => familyShape("flowchart", id));
  const banner = (id: string, label: string) => pathItem(id, label, () => familyShape("banners", id));
  const callout = (id: string, label: string) => pathItem(id, label, () => familyShape("callouts", id));
  const basic = (id: string, label: string) => pathItem(id, label, () => familyShape("basic", id));
  const tableItem = (rows: number, cols: number): MenuItem => {
    const label = tr("editor.toolbox_cols_by_rows", { cols, rows });
    return {
      id: `${cols}x${rows}`,
      label,
      icon: Table2,
      run: (env) => {
        insertTable(rows, cols);
        env.inserted(tr("editor.table"));
      },
    };
  };
  const opacityItem = (percent: number): MenuItem => ({
    id: String(percent),
    label: tr("editor.toolbox_opacity_percent", { percent }),
    run: () => setOpacity(percent / 100),
  });

  return [
    {
      id: "select",
      label: tr("editor.toolbox_sec_select"),
      short: tr("editor.select"),
      tools: [
        {
          id: "pick",
          label: tr("editor.toolbox_pick"),
          tip: tr("editor.toolbox_pick_tip"),
          icon: MousePointer2,
          shortcut: "V",
          active: (s) => s.tool === "select" && !s.nodeEdit,
          run: pickTool,
        },
        {
          id: "nodes",
          label: tr("editor.toolbox_nodes"),
          tip: tr("editor.toolbox_nodes_tip"),
          icon: MousePointerClick,
          active: (s) => s.tool === "select" && s.nodeEdit,
          blocked: needEdit,
          run: nodeTool,
        },
        {
          id: "crop",
          label: tr("editor.crop"),
          tip: tr("editor.toolbox_crop_tip"),
          icon: Crop,
          blocked: needCroppable,
          run: cropSelection,
        },
        {
          id: "combine",
          label: tr("editor.toolbox_combine"),
          tip: tr("editor.toolbox_combine_tip"),
          icon: Combine,
          blocked: needShapes,
          flyout: {
            kind: "menu",
            items: [
              { id: "union", label: tr("editor.toolbox_combine_unite"), icon: SquaresUnite, run: () => combineShapes("union") },
              { id: "subtract", label: tr("editor.toolbox_combine_subtract"), icon: SquareMinus, run: () => combineShapes("subtract") },
              { id: "intersect", label: tr("editor.toolbox_combine_intersect"), icon: SquaresIntersect, run: () => combineShapes("intersect") },
              { id: "exclude", label: tr("editor.toolbox_combine_exclude"), icon: SquaresExclude, run: () => combineShapes("exclude") },
            ],
          },
        },
      ],
    },
    {
      id: "draw",
      label: tr("editor.toolbox_sec_draw"),
      short: tr("editor.draw"),
      tools: [
        {
          id: "pen",
          label: tr("editor.pen"),
          tip: tr("editor.toolbox_pen_tip"),
          icon: PenTool,
          shortcut: "P",
          active: (s) => s.tool === "pen",
          blocked: needEdit,
          run: () => canvasTool("pen"),
        },
        {
          id: "freehand",
          label: tr("editor.toolbox_freehand"),
          tip: tr("editor.toolbox_freehand_tip"),
          icon: Pencil,
          shortcut: "B",
          active: (s) => s.tool === "pencil" && !s.smartDraw,
          blocked: needEdit,
          run: () => canvasTool("pencil"),
        },
        {
          id: "line",
          label: tr("editor.toolbox_line"),
          tip: tr("editor.toolbox_line_tip"),
          icon: PenLine,
          shortcut: "L",
          active: (s) => s.tool === "line",
          blocked: needEdit,
          run: () => canvasTool("line"),
        },
        {
          id: "arrow",
          label: tr("editor.arrow"),
          tip: tr("editor.toolbox_arrow_tip"),
          icon: MoveUpRight,
          shortcut: "A",
          active: (s) => s.tool === "arrow",
          blocked: needEdit,
          run: () => canvasTool("arrow"),
        },
        {
          id: "smart",
          label: tr("editor.toolbox_smart"),
          tip: tr("editor.toolbox_smart_tip"),
          icon: Sparkle,
          active: (s) => s.tool === "pencil" && s.smartDraw,
          blocked: needEdit,
          run: smartDrawTool,
        },
      ],
    },
    {
      id: "shapes",
      label: tr("editor.shapes"),
      short: tr("editor.shapes"),
      tools: [
        {
          id: "rect",
          label: tr("editor.rectangle"),
          tip: tr("editor.toolbox_rect_tip"),
          icon: Square,
          shortcut: "R",
          active: (s) => s.tool === "rect",
          blocked: needEdit,
          run: () => canvasTool("rect"),
        },
        {
          id: "ellipse",
          label: tr("editor.ellipse"),
          tip: tr("editor.toolbox_ellipse_tip"),
          icon: Circle,
          shortcut: "E",
          active: (s) => s.tool === "ellipse",
          blocked: needEdit,
          run: () => canvasTool("ellipse"),
        },
        {
          id: "polygon",
          label: tr("editor.toolbox_polygon"),
          tip: tr("editor.toolbox_polygon_tip"),
          icon: Hexagon,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [
              regularItem("3", tr("editor.triangle"), "triangle", 3),
              regularItem("4", tr("editor.diamond"), "polygon", 4),
              regularItem("5", tr("editor.pentagon"), "polygon", 5),
              regularItem("6", tr("editor.hexagon"), "polygon", 6),
              regularItem("8", tr("editor.octagon"), "polygon", 8),
            ],
          },
        },
        {
          id: "star",
          label: tr("editor.star"),
          tip: tr("editor.toolbox_star_tip"),
          icon: Star,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [
              regularItem("4", tr("editor.toolbox_points_star", { points: 4 }), "star", 4, 0.4),
              regularItem("5", tr("editor.toolbox_points_star", { points: 5 }), "star", 5, 0.5),
              regularItem("6", tr("editor.toolbox_points_star", { points: 6 }), "star", 6, 0.55),
              regularItem("8", tr("editor.toolbox_points_star", { points: 8 }), "star", 8, 0.6),
              regularItem("12", tr("editor.burst"), "star", 12, 0.62),
            ],
          },
        },
        {
          id: "cstar",
          label: tr("editor.toolbox_cstar"),
          tip: tr("editor.toolbox_cstar_tip"),
          icon: Sparkles,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: complexStars.map((c) =>
              pathItem(c.id, tr("editor.toolbox_cstar_item", { points: c.points, step: c.step }), () => complexStar(c.points, c.step), tr("editor.toolbox_cstar")),
            ),
          },
        },
        {
          id: "spiral",
          label: tr("editor.toolbox_spiral"),
          tip: tr("editor.toolbox_spiral_tip"),
          icon: Shell,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [2, 3, 4, 6].map((turns) => pathItem(String(turns), tr("editor.toolbox_turns", { count: turns }), () => spiral(turns), tr("editor.toolbox_spiral"))),
          },
        },
        {
          id: "grid",
          label: tr("editor.toolbox_grid"),
          tip: tr("editor.toolbox_grid_tip"),
          icon: Grid3x3,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [[4, 4], [6, 6], [8, 8], [12, 8]].map(([cols, rows]) =>
              pathItem(`${cols}x${rows}`, tr("editor.toolbox_cols_by_rows", { cols, rows }), () => graphPaper(cols, rows), tr("editor.toolbox_grid")),
            ),
          },
        },
        {
          id: "arrows",
          label: tr("editor.toolbox_arrows"),
          tip: tr("editor.toolbox_arrows_tip"),
          icon: ArrowBigRight,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [
              arrow("right", tr("editor.toolbox_arrow_right")),
              arrow("left", tr("editor.toolbox_arrow_left")),
              arrow("up", tr("editor.toolbox_arrow_up")),
              arrow("down", tr("editor.toolbox_arrow_down")),
              arrow("both", tr("editor.toolbox_arrow_both")),
              arrow("four", tr("editor.toolbox_arrow_four")),
              arrow("chevron", tr("editor.toolbox_arrow_chevron")),
              arrow("tag", tr("editor.toolbox_arrow_tag")),
              arrow("notched", tr("editor.toolbox_arrow_notched")),
              arrow("uturn", tr("editor.toolbox_arrow_uturn")),
              arrow("curved", tr("editor.toolbox_arrow_curved")),
              arrow("circular", tr("editor.toolbox_arrow_circular")),
            ],
          },
        },
        {
          id: "flow",
          label: tr("editor.toolbox_flow"),
          tip: tr("editor.toolbox_flow_tip"),
          icon: Workflow,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [
              flow("process", tr("editor.toolbox_flow_process")),
              flow("decision", tr("editor.toolbox_flow_decision")),
              flow("terminator", tr("editor.toolbox_flow_terminator")),
              flow("data", tr("editor.toolbox_flow_data")),
              flow("document", tr("editor.toolbox_flow_document")),
              flow("subroutine", tr("editor.toolbox_flow_subroutine")),
              flow("manual-input", tr("editor.toolbox_flow_manual_input")),
              flow("preparation", tr("editor.toolbox_flow_preparation")),
              flow("delay", tr("editor.toolbox_flow_delay")),
              flow("database", tr("editor.toolbox_flow_database")),
              flow("offpage", tr("editor.toolbox_flow_offpage")),
              flow("connector", tr("editor.toolbox_flow_connector")),
              flow("manual-step", tr("editor.toolbox_flow_manual_step")),
              flow("merge", tr("editor.toolbox_flow_merge")),
            ],
          },
        },
        {
          id: "banner",
          label: tr("editor.toolbox_banner"),
          tip: tr("editor.toolbox_banner_tip"),
          icon: Flag,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [
              banner("ribbon", tr("editor.toolbox_banner_ribbon")),
              banner("flag", tr("editor.toolbox_banner_flag")),
              banner("seal", tr("editor.toolbox_banner_seal")),
              banner("shield", tr("editor.toolbox_banner_shield")),
              banner("label", tr("editor.toolbox_banner_label")),
              banner("pennant", tr("editor.toolbox_banner_pennant")),
              banner("bookmark", tr("editor.toolbox_banner_bookmark")),
              banner("forked", tr("editor.toolbox_banner_forked")),
            ],
          },
        },
        {
          id: "callout",
          label: tr("editor.toolbox_callout"),
          tip: tr("editor.toolbox_callout_tip"),
          icon: MessageSquare,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [
              callout("speech", tr("editor.toolbox_callout_speech")),
              callout("rounded", tr("editor.toolbox_callout_rounded")),
              callout("oval", tr("editor.toolbox_callout_oval")),
              callout("thought", tr("editor.toolbox_callout_thought")),
              callout("shout", tr("editor.toolbox_callout_shout")),
              callout("line", tr("editor.toolbox_callout_line")),
              callout("pointer-left", tr("editor.toolbox_callout_pointer_left")),
              callout("pointer-down", tr("editor.toolbox_callout_pointer_down")),
            ],
          },
        },
        {
          id: "basic",
          label: tr("editor.toolbox_basic"),
          tip: tr("editor.toolbox_basic_tip"),
          icon: Heart,
          blocked: needEdit,
          flyout: {
            kind: "shapes",
            items: [
              basic("heart", tr("editor.toolbox_basic_heart")),
              basic("cloud", tr("editor.toolbox_basic_cloud")),
              basic("lightning", tr("editor.toolbox_basic_lightning")),
              basic("gear", tr("editor.toolbox_basic_gear")),
              basic("moon", tr("editor.toolbox_basic_moon")),
              basic("drop", tr("editor.toolbox_basic_drop")),
              basic("cross", tr("editor.toolbox_basic_cross")),
              basic("trapezoid", tr("editor.toolbox_basic_trapezoid")),
              basic("parallelogram", tr("editor.toolbox_basic_parallelogram")),
              basic("octagon", tr("editor.octagon")),
              basic("cylinder", tr("editor.toolbox_basic_cylinder")),
              basic("cube", tr("editor.toolbox_basic_cube")),
              basic("frame", tr("editor.toolbox_basic_frame")),
              basic("ring", tr("editor.toolbox_basic_ring")),
              basic("arc", tr("editor.toolbox_basic_arc")),
              basic("smiley", tr("editor.toolbox_basic_smiley")),
              basic("burst", tr("editor.burst")),
              basic("plaque", tr("editor.toolbox_basic_plaque")),
            ],
          },
        },
      ],
    },
    {
      id: "text",
      label: tr("editor.toolbox_sec_text"),
      short: tr("editor.text"),
      tools: [
        {
          id: "text",
          label: tr("editor.text"),
          tip: tr("editor.toolbox_text_tip"),
          icon: Type,
          shortcut: "T",
          active: (s) => s.tool === "text",
          blocked: needEdit,
          run: () => canvasTool("text"),
        },
        {
          id: "para",
          label: tr("editor.toolbox_para"),
          tip: tr("editor.toolbox_para_tip"),
          icon: TextCursorInput,
          blocked: needEdit,
          run: (env) => {
            insertParagraph(tr("editor.toolbox_para_placeholder"), tr("editor.toolbox_para"));
            env.inserted(tr("editor.toolbox_para"));
          },
        },
        {
          id: "table",
          label: tr("editor.table"),
          tip: tr("editor.toolbox_table_tip"),
          icon: Table2,
          blocked: needEdit,
          flyout: { kind: "menu", items: [tableItem(2, 2), tableItem(3, 3), tableItem(3, 4), tableItem(4, 5), tableItem(6, 6)] },
        },
      ],
    },
    {
      id: "connect",
      label: tr("editor.toolbox_sec_connect"),
      short: tr("editor.toolbox_sec_connect_short"),
      tools: [
        {
          id: "conn",
          label: tr("editor.toolbox_conn"),
          tip: tr("editor.toolbox_conn_tip"),
          icon: Link2,
          blocked: needPair,
          run: () => connectSelection("straight"),
        },
        {
          id: "conn-elbow",
          label: tr("editor.toolbox_conn_elbow"),
          tip: tr("editor.toolbox_conn_elbow_tip"),
          icon: Workflow,
          blocked: needPair,
          run: () => connectSelection("elbow"),
        },
      ],
    },
    {
      id: "effects",
      label: tr("editor.effects"),
      short: tr("editor.effects"),
      tools: [
        {
          id: "shadow",
          label: tr("editor.drop_shadow"),
          tip: tr("editor.toolbox_shadow_tip"),
          icon: Blend,
          on: (s) => s.shadow,
          blocked: needShadowable,
          run: () => {
            toggleShadow();
            revealPropertiesSection(tr("editor.style"));
          },
        },
        {
          id: "transparency",
          label: tr("editor.toolbox_transparency"),
          tip: tr("editor.toolbox_transparency_tip"),
          icon: Eclipse,
          blocked: needSelection,
          flyout: { kind: "menu", items: [100, 75, 50, 25, 10].map(opacityItem) },
        },
        {
          id: "fill",
          label: tr("editor.fill"),
          tip: tr("editor.toolbox_fill_tip"),
          icon: PaintRoller,
          blocked: needFillable,
          run: () => revealPropertiesSection(tr("editor.fill")),
        },
      ],
    },
    {
      id: "color",
      label: tr("editor.color"),
      short: tr("editor.color"),
      tools: [
        {
          id: "eyedropper",
          label: tr("editor.toolbox_eyedropper"),
          tip: tr("editor.toolbox_eyedropper_tip"),
          icon: Pipette,
          hidden: (s) => !s.screenPicker,
          blocked: needColorable,
          run: () => void pickScreenColor(),
        },
        {
          id: "harmonies",
          label: tr("editor.toolbox_harmonies"),
          tip: tr("editor.toolbox_harmonies_tip"),
          icon: Paintbrush,
          blocked: needFillable,
          run: () => revealPropertiesSection(tr("editor.fill")),
        },
      ],
    },
    {
      id: "photo",
      label: tr("editor.toolbox_sec_photo"),
      short: tr("editor.toolbox_sec_photo_short"),
      tools: [
        {
          id: "remove-bg",
          label: tr("editor.remove_background"),
          tip: tr("editor.toolbox_removebg_tip"),
          icon: Scissors,
          blocked: needPhoto,
          run: () => revealPropertiesSection(tr("editor.image_effects"), tr("editor.effects")),
        },
        {
          id: "refine",
          label: tr("editor.refine_edges"),
          tip: tr("editor.toolbox_refine_tip"),
          icon: ScanSearch,
          blocked: needUnlockedPhoto,
          run: refineSelection,
        },
        {
          id: "adjust",
          label: tr("editor.adjust"),
          tip: tr("editor.toolbox_adjust_tip"),
          icon: SlidersHorizontal,
          blocked: needPhoto,
          run: () => revealPropertiesSection(tr("editor.image_effects"), tr("editor.adjust")),
        },
      ],
    },
    {
      id: "nav",
      label: tr("editor.toolbox_sec_nav"),
      short: tr("editor.toolbox_sec_nav_short"),
      tools: [
        {
          id: "zoom",
          label: tr("editor.zoom"),
          tip: tr("editor.toolbox_zoom_tip"),
          icon: ZoomIn,
          flyout: {
            kind: "menu",
            items: [
              { id: "in", label: tr("editor.zoom_in"), icon: ZoomIn, shortcut: keyZoomIn, run: zoomIn },
              { id: "out", label: tr("editor.zoom_out"), icon: ZoomOut, shortcut: keyZoomOut, run: zoomOut },
              { id: "fit", label: tr("editor.fit_page"), icon: Maximize, shortcut: keyFit, run: zoomFitPage },
              { id: "selection", label: tr("editor.zoom_to_selection"), icon: ScanSearch, shortcut: keySelection, run: zoomToSelection },
              { id: "actual", label: tr("editor.toolbox_zoom_actual"), icon: Square, run: zoomActualSize },
            ],
          },
        },
        {
          id: "comment",
          label: tr("editor.comment"),
          tip: tr("editor.toolbox_comment_tip"),
          icon: MessageSquarePlus,
          active: (s) => s.tool === "comment",
          hidden: (s) => !s.canComment,
          run: () => canvasTool("comment"),
        },
      ],
    },
  ];
}
