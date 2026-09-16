/**
 * Decode a base64 payload of raw RGBA bytes.
 *
 * Both RDP paths ship pixels this way — framebuffer tiles and pointer bitmaps —
 * and both feed the result straight to `ImageData`.
 */
// The `ArrayBuffer` argument is load-bearing: TypeScript's typed arrays are
// generic over their buffer, and `ImageData` only accepts the non-shared one.
export function base64ToRgba(data: string): Uint8ClampedArray<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
