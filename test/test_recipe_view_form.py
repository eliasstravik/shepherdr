"""The window's recipe view (mods/artifacts/recipe-view.js) makes every form field's InputState in init(), never in
render(): GPUI refuses InputState.new during render, so `herdr-artifact publish` refused every recipe with a form
(GitHub #1026). The view runs in node with the window's modules stubbed: InputState.new throws while render runs,
as the window's does."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEW = os.path.join(ROOT, "mods", "artifacts", "recipe-view.js")
RECIPE = os.path.join(ROOT, "core", "recipe.js")

# The window's modules, enough to build the element tree: every element method returns the element.
STUB = r"""
export let rendering = false;
export const setRendering = (v) => { rendering = v; };
const el = () => new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : (...a) => {
  if (k === "when" && a[0]) a[1](el()); return el(); }), apply: () => el() });
export class View {}
export const div = () => el(), image = () => el(), v_flex = () => el(), h_flex = () => el();
export const TextView = { markdown: () => el() };
export const Input = { new: () => el() };
export const made = [];
export const InputState = { new: (o) => {
  if (rendering) throw new Error("InputState.new(...) cannot run during render");
  const s = { o, value: () => "" }; made.push(s); return s; } };
export const theme = () => new Proxy({}, { get: () => "#000" });
export const asset = (x) => x, reply = async () => true;
"""

HARNESS = r"""
import RecipeView from "./recipe-view.js";
import { setRendering, made } from "./stub.js";
const v = new RecipeView();
v.init();
const before = made.length;
setRendering(true);
let error = null;
try { v.render({}); v.render({}); } catch (e) { error = String(e.message || e); }
setRendering(false);
console.log(JSON.stringify({ error, made: before, after: made.length, viewError: v.error }));
"""


def run(recipe):
    d = tempfile.mkdtemp(prefix="recipe-view-")
    try:
        src = open(VIEW, encoding="utf-8").read()
        src = re.sub(r'from "(gpui-kit|gpui-base|herdr|\./artifact\.js)"', 'from "./stub.js"', src)
        with open(os.path.join(d, "recipe-view.js"), "w") as f:
            f.write(src)
        shutil.copy(RECIPE, os.path.join(d, "recipe.js"))
        with open(os.path.join(d, "stub.js"), "w") as f:
            f.write(STUB)
        with open(os.path.join(d, "recipe-data.js"), "w") as f:
            f.write("export default " + json.dumps(recipe) + ";\n")
        with open(os.path.join(d, "main.mjs"), "w") as f:
            f.write(HARNESS)
        with open(os.path.join(d, "package.json"), "w") as f:
            f.write('{"type": "module"}')
        r = subprocess.run(["node", os.path.join(d, "main.mjs")], capture_output=True, text=True, timeout=30)
        if r.returncode:
            raise AssertionError(r.stderr)
        return json.loads(r.stdout.strip().splitlines()[-1])
    finally:
        shutil.rmtree(d, ignore_errors=True)


@unittest.skipUnless(shutil.which("node"), "needs node")
class FormFieldsMadeInInit(unittest.TestCase):
    def test_a_form_draws_without_making_state_in_render(self):
        out = run({"recipe": 1, "blocks": [{"type": "form", "fields": [
            {"name": "why", "label": "Why", "kind": "text"}, {"name": "pick", "kind": "select", "options": ["a", "b"]},
            {"name": "ok", "kind": "checkbox"}]}]})
        self.assertIsNone(out["viewError"])
        self.assertIsNone(out["error"])
        self.assertEqual(out["made"], 2)  # the text and the select field; a checkbox has none
        self.assertEqual(out["after"], 2)

    def test_forms_inside_columns_tabs_and_details_too(self):
        form = {"type": "form", "fields": [{"name": "a"}]}
        out = run({"recipe": 1, "blocks": [
            {"type": "columns", "columns": [[form], [dict(form)]]},
            {"type": "tabs", "tabs": [{"label": "One", "blocks": [dict(form)]}, {"label": "Two", "blocks": [dict(form)]}]},
            {"type": "details", "summary": "More", "blocks": [dict(form)]}]})
        self.assertIsNone(out["error"])
        self.assertEqual(out["made"], 5)
        self.assertEqual(out["after"], 5)


if __name__ == "__main__":
    unittest.main()
