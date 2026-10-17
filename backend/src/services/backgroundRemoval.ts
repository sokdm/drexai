import sharp from "sharp";

/** Remove only matching pixels connected to the border; never claim subject segmentation. */
export async function removeSolidBackground(source: Buffer, color: string, tolerance: number) {
 const { data, info } = await sharp(source, { limitInputPixels: 16000000 }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
 const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
 const count = info.width * info.height, visited = new Uint8Array(count), queue = new Uint32Array(count);
 let tail = 0, removed = 0;
 const enqueue = (p: number) => {
  if (visited[p]) return; visited[p] = 1;
  const offset = p * 4;
  if (Math.max(...rgb.map((v, channel) => Math.abs(data[offset + channel] - v))) > tolerance) return;
  queue[tail++] = p;
 };
 for (let x = 0; x < info.width; x++) { enqueue(x); enqueue((info.height - 1) * info.width + x); }
 for (let y = 0; y < info.height; y++) { enqueue(y * info.width); enqueue(y * info.width + info.width - 1); }
 for (let head = 0; head < tail; head++) {
  const p = queue[head]; if (data[p * 4 + 3]) removed++; data[p * 4 + 3] = 0;
  const x = p % info.width, y = Math.floor(p / info.width);
  if (x) enqueue(p - 1); if (x + 1 < info.width) enqueue(p + 1);
  if (y) enqueue(p - info.width); if (y + 1 < info.height) enqueue(p + info.width);
 }
 if (!removed) throw Object.assign(new Error("No matching background touches the image edges. Choose its background color or increase tolerance."), { statusCode: 422 });
 return { buffer: await sharp(data, { raw: info }).png().toBuffer(), removedPixels: removed };
}
