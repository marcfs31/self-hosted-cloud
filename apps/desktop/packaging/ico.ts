/**
 * Packs PNG images into a Windows .ico (PNG-compressed entries, supported since Windows Vista).
 * No dependencies: an ICO is a 6-byte header, a 16-byte directory entry per image, then the images.
 */
export type IcoImage = { size: number; png: Buffer };

const HEADER = 6;
const ENTRY = 16;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function packIco(images: readonly IcoImage[]): Buffer {
  if (images.length === 0 || images.length > 0xffff)
    throw new Error("An ICO needs 1 to 65535 images.");
  const directory = Buffer.alloc(HEADER + ENTRY * images.length);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, index) => {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256) {
      throw new Error(`ICO images are 1 to 256 pixels square, got ${image.size}.`);
    }
    if (!image.png.subarray(0, 8).equals(PNG_SIGNATURE))
      throw new Error("ICO entries must be PNG.");
    const at = HEADER + ENTRY * index;
    const dimension = image.size === 256 ? 0 : image.size; // 0 means 256
    directory[at] = dimension; // width
    directory[at + 1] = dimension; // height
    directory[at + 2] = 0; // palette colours: none
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  });
  return Buffer.concat([directory, ...images.map((image) => image.png)]);
}
