import { div, image } from "gpui-kit";
import { shared, theme } from "herdr";
import { visibleWallpaper, cover, WALLPAPER_KEY } from "./core/wallpaper.js";

export const currentWallpaper = (cx) => visibleWallpaper(shared(WALLPAPER_KEY), shared("layout"), cx.theme().appearance);
export function wallpaperLayer(value, width, height) {
  if (value.kind === "solid") return div().absolute().inset_0().bg(value.color);
  const box = cover(value, width, height);
  return div().absolute().inset_0().overflow_hidden().bg(theme().background)
    .when(Boolean(box), (el) => el.child(image(value.path).absolute().left(box.left).top(box.top).w(box.w).h(box.h).opacity(1 - value.transparency / 100)));
}
export function wallpaperTheme(t, value) {
  // Native Markdown and inputs use the host palette even inside a locally coloured parent.
  return value ? { ...t, wallpaper: true } : t;
}
