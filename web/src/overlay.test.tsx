import { expect, test } from 'bun:test'
import { isValidElement, type ReactElement } from 'react'
import { closeAll, layersNow, openForm } from './overlay.tsx'

// SHEP-308: on a phone the keyboard coming up redraws the app, and each redraw draws every open dialog again. A form's
// fields only stay (and keep the focus) when each redraw gives the same component; a new one puts new fields in.

test('a form is the same component at every redraw, so its fields and their focus stay', () => {
  function Form() {
    return null
  }
  openForm(Form, { label: 'New space' })
  const [layer] = layersNow()
  const first = layer.render(() => {}) as ReactElement
  const again = layer.render(() => {}) as ReactElement
  expect(isValidElement(first)).toBe(true)
  expect(first.type).toBe(Form)
  expect(again.type).toBe(first.type)
  closeAll()
  expect(layersNow()).toHaveLength(0)
})
