import { div, image } from "gpui-kit";
import { shared } from "herdr";
import { wallpaper, cover, wallpaperColors, WALLPAPER_KEY } from "./core/wallpaper.js";

export const currentWallpaper = () => wallpaper(shared(WALLPAPER_KEY), shared("layout"));
export function wallpaperLayer(value, width, height) {
  if (value.kind === "solid") return div().absolute().inset_0().bg(value.color);
  const box = cover(value, width, height);
  return div().absolute().inset_0().overflow_hidden().bg("#f9f9fa")
    .when(Boolean(box), (el) => el.child(image(value.path).absolute().left(box.left).top(box.top).w(box.w).h(box.h).opacity(1 - value.transparency / 100)));
}
export function wallpaperTheme(t, value) {
  return value ? { ...t, wallpaper: true, ...wallpaperColors(value) } : t;
}
