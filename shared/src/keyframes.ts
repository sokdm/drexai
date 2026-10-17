import type { EditorClip } from "./editor.js";
export function sliceKeyframes(clip: Pick<EditorClip, "keyframes">, from: number, to: number) {
  if (!clip.keyframes?.length) return undefined;
  return [{ ...clipTransform(clip, from), time: 0 }, ...clip.keyframes.filter(k => k.time > from && k.time < to).map(k => ({ ...k, time: k.time - from })), { ...clipTransform(clip, to), time: to - from }];
}
export function clipTransform(clip: Pick<EditorClip, "keyframes">, time: number) {
  const keys = clip.keyframes || [];
  if (!keys.length) return { zoom: 1, x: .5, y: .5 };
  const next = keys.findIndex(k => k.time > time);
  if (next === 0) return keys[0];
  if (next < 0) return keys[keys.length - 1];
  const a = keys[next - 1], b = keys[next], p = (time - a.time) / (b.time - a.time);
  return { zoom: a.zoom + (b.zoom - a.zoom) * p, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}
// Expressions contain only schema-validated finite numbers, never user expressions.
export function keyframeExpression(keys: NonNullable<EditorClip["keyframes"]>, field: "zoom" | "x" | "y", clock = "t") {
  if (!keys.length) return String(field === "zoom" ? 1 : .5);
  let expression = String(keys[keys.length - 1][field]);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i], b = keys[i + 1];
    expression = `if(lt(${clock},${b.time}),${a[field]}+(${b[field] - a[field]})*max(0,(${clock}-${a.time})/${b.time - a.time}),${expression})`;
  }
  return expression;
}
