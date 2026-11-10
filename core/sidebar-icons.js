const ICONS = new Map([
  ["🖥", "monitor"], ["⚙", "settings"], ["🏛", "landmark"], ["🖼", "image"],
  ["📁", "folder"], ["📂", "folder"], ["🎨", "palette"],
]);

export const sidebarIcon = (value) => typeof value === "string" ? ICONS.get(value.replace(/\ufe0f/g, "")) ?? null : null;
