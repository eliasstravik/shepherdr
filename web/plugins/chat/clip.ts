// The plus menu is Photos and Files on a phone or tablet. A picture on the clipboard goes in the way any paste does
// (long-press the box and Paste, or the keyboard): Shepherdr never reads the clipboard itself.

/** a pointer that is a finger: a phone or a tablet, where the plus menu is */
export const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
/** a mouse or trackpad as the main pointer: a desktop (a phone's or tablet's is a finger) */
export const fineOnly = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches
