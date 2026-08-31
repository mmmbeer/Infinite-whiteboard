const encoder = new TextEncoder();
const decoder = new TextDecoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();

function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function u16(value) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function concat(parts) { const length = parts.reduce((sum, part) => sum + part.length, 0); const output = new Uint8Array(length); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }
function dosDate(date = new Date()) { return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(); }
function dosTime(date = new Date()) { return (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1); }
async function bytesOf(value) { if (value instanceof Uint8Array) return value; if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer()); return encoder.encode(String(value)); }

export async function makeZip(entries) {
  const localParts = []; const centralParts = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name); const data = await bytesOf(entry.data); const crc = crc32(data); const date = entry.date || new Date();
    const local = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(dosTime(date)), u16(dosDate(date)), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    const central = concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dosTime(date)), u16(dosDate(date)), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    localParts.push(local); centralParts.push(central); offset += local.length;
  }
  const central = concat(centralParts); const local = concat(localParts);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(local.length), u16(0)]);
  return new Blob([local, central, end], { type: "application/zip" });
}

async function inflate(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read compressed ZIP files.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const entries = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50 || offset + 30 > bytes.length) throw new Error("The ZIP backup is not valid.");
    const flags = view.getUint16(offset + 6, true); const method = view.getUint16(offset + 8, true);
    const expectedCrc = view.getUint32(offset + 14, true); const compressedSize = view.getUint32(offset + 18, true);
    const expectedSize = view.getUint32(offset + 22, true); const nameLength = view.getUint16(offset + 26, true); const extraLength = view.getUint16(offset + 28, true);
    if (flags & 0x08) throw new Error("ZIP backups with data descriptors are not supported.");
    const nameStart = offset + 30; const dataStart = nameStart + nameLength + extraLength; const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error("The ZIP backup is truncated.");
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const compressed = bytes.slice(dataStart, dataEnd); const data = method === 0 ? compressed : method === 8 ? await inflate(compressed) : null;
    if (!data) throw new Error(`Unsupported ZIP compression method for ${name}.`);
    if (data.length !== expectedSize || crc32(data) !== expectedCrc) throw new Error(`ZIP integrity check failed for ${name}.`);
    entries.set(name, data); offset = dataEnd;
  }
  if (!entries.size) throw new Error("The ZIP backup contains no readable files.");
  return entries;
}
