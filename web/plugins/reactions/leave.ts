/** What runs once a lifted message is set back down: the overlay closes first, then what was picked (Fork, Rewind).
 *  A pick that ran instead of the close left the overlay up, invisible, taking every tap (#788). */
export const setDown = (close: () => void, then?: () => void) => () => {
  close()
  then?.()
}
