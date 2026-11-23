/** A value for a quoted attribute selector (`[data-x="${attr(v)}"]`) without `CSS.escape`: test DOMs and old browsers
 * have no `CSS` global. Inside a double-quoted CSS string only `\`, `"` and line breaks need escaping. */
export const attr = (value: string) => value.replace(/["\\]/g, '\\$&').replace(/\r\n|[\n\r\f]/g, '\\a ')
