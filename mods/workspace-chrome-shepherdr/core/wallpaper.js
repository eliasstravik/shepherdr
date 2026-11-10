// Desktop wallpaper preferences stay in this window's shared state, outside synced agent settings.
export const WALLPAPER_KEY = "bossgoat.wallpaper";
export const WALLPAPER_DIR = "data/bossgoat-wallpaper";
export const DEFAULT_TRANSPARENCY = 0;
export const DEFAULT_WALLPAPER = { path: "mods/chat/bossgoat-background.png", width: 1588, height: 991,
  transparency: DEFAULT_TRANSPARENCY, name: "bossgoat-background.png" };
// HolyCow's website/src/styles/eden.css: paper surfaces, pastel accents and inverse ink tones.
export const SOLID_BACKGROUNDS = [
  { id: "paper", name: "Paper", color: "#f9f9fa", tone: "light" },
  { id: "pearl", name: "Pearl", color: "#f5f5f7", tone: "light" },
  { id: "sage", name: "Sage", color: "#e3f0e6", tone: "light" },
  { id: "peach", name: "Peach", color: "#fdd4a3", tone: "light" },
  { id: "ink", name: "Ink", color: "#1d1d1f", tone: "dark" },
  { id: "midnight", name: "Midnight", color: "#111413", tone: "dark" },
  { id: "charcoal", name: "Charcoal", color: "#333333", tone: "dark" },
];
export function wallpaperColors(value) {
  return value?.kind === "solid" && value.tone === "dark"
    ? { background: "#1d1d1f", foreground: "#ffffff", muted: "#ffffffcc", dim: "#ffffff99",
        surface: "#1d1d1f", popover: "#1d1d1f", chrome: "#111413", canvas: "#111413", raised: "#333333",
        border: "#ffffff21", input: "#ffffff4d", hover: "#333333", selected: "#ffffff1a",
        accent: "#90dcf7", accent_foreground: "#111413", solid: "#f5f5f7", solid_foreground: "#1d1d1f" }
    : { background: "#ffffff", foreground: "#1d1d1f", muted: "#1d1d1fcc", dim: "#1d1d1f80",
        surface: "#ffffff", popover: "#ffffff", chrome: "#f9f9fa", canvas: "#f9f9fa", raised: "#f5f5f7",
        border: "#1d1d1f21", input: "#1d1d1f21", hover: "#f0f0f2", selected: "#e3edff",
        accent: "#0070d9", accent_foreground: "#ffffff", solid: "#1d1d1f", solid_foreground: "#ffffff" };
}
export const APPEARANCE = { id: "appearance", title: "Appearance", icon: "image" };
export const WALLPAPER = {
  title: "Background", scope: "BossGoat on this computer.",
  about: "Chat and Terminal share your solid colour or image.",
  choose: "Choose image…", choosing: "Choosing image…", reset: "Reset to default",
  empty: "Choose a picture or drop one here", formats: "PNG, JPEG or WebP · up to 30 MB · stored locally",
  transparency: "Transparency", transparencyAbout: "0% shows the full image. 100% hides it.",
  inactive: "Select the BossGoat layout to see your wallpaper.",
  saved: "Saved on this computer", failed: "Couldn’t load this image. Try a PNG, JPEG or WebP file.",
};
export function wallpaper(value, layout = "BossGoat") {
  if (layout !== "BossGoat") return null;
  if (value == null) return { ...DEFAULT_WALLPAPER };
  if (value.kind === "solid") {
    const preset = SOLID_BACKGROUNDS.find((p) => p.id === value.preset);
    return preset ? { kind: "solid", preset: preset.id, color: preset.color, tone: preset.tone, name: preset.name } : null;
  }
  if (value.path === "mods/chat/Warp_bg.png") value = { ...value, path: DEFAULT_WALLPAPER.path, name: DEFAULT_WALLPAPER.name };
  if (value.path === DEFAULT_WALLPAPER.path) value = { ...DEFAULT_WALLPAPER, ...value };
  else if (!new RegExp(`^${WALLPAPER_DIR}/[a-f0-9]{64}\\.png$`).test(value.path)) return null;
  if (![value.width, value.height].every((n) => Number.isInteger(n) && n > 0 && n <= 4096)) return null;
  const saved = Number.isFinite(value.transparency) ? value.transparency : value.fade;
  const transparency = Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : DEFAULT_TRANSPARENCY;
  return { path: value.path, width: value.width, height: value.height, transparency, name: String(value.name ?? "Wallpaper").slice(0, 200) };
}
export function cover(image, width, height) {
  if (!image || image.kind === "solid" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  return { w, h, left: (width - w) / 2, top: (height - h) / 2 };
}

export function terminalWallpaper(tree, value, base = "#f9f9fa") {
  if (!value) return tree;
  const next = JSON.parse(JSON.stringify(tree));
  const background = value.kind === "solid" ? value.color : { image: value.path, fit: "cover" };
  const tint = value.kind === "solid" ? "#00000000"
    : `${base.slice(0, 7)}${Math.round(value.transparency * 255 / 100).toString(16).padStart(2, "0")}`;
  next.terminal_opacity = 0;
  function paint(node) {
    if (node.id === "main") {
      node.background = background;
      if (node.content?.pane) node.content.pane.background = tint;
    }
    if (node.id === "tasks-thread-body") node.background = background;
    if (node.id === "tasks-thread-term") node.background = tint;
    for (const child of node.children ?? []) paint(child);
  }
  paint(next);
  return next;
}
