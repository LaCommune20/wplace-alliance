// Minimal PNG decoder for Radar Lab / Cloudflare Workers.
//
// Supported PNGs:
// - non-interlaced images
// - 8-bit RGB/RGBA
// - 8-bit grayscale / grayscale+alpha
// - palette images with 1/2/4/8-bit indices
// - grayscale images with 1/2/4/8-bit samples
//
// The decoder intentionally returns RGBA8 so the Radar diff engine can
// compare tiles without knowing the source PNG color model.

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a
]);

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

async function inflateZlib(data) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream n'est pas disponible dans cet environnement");
  }

  const stream = new Blob([data]).stream().pipeThrough(
    new DecompressionStream("deflate")
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readChunks(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 || !equalBytes(bytes.subarray(0, 8), PNG_SIGNATURE)) {
    throw new Error("Réponse non-PNG");
  }

  const view = new DataView(buffer);
  let offset = 8;
  const chunks = [];

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (crcEnd > bytes.length) {
      throw new Error(`Chunk PNG tronqué: ${type}`);
    }

    chunks.push({ type, data: bytes.slice(dataStart, dataEnd) });
    offset = crcEnd;

    if (type === "IEND") break;
  }

  return chunks;
}

function readPalette(chunks) {
  const chunk = chunks.find((item) => item.type === "PLTE");
  if (!chunk) return null;
  if (chunk.data.length % 3 !== 0) throw new Error("Palette PNG invalide");

  const palette = [];
  for (let i = 0; i < chunk.data.length; i += 3) {
    palette.push([chunk.data[i], chunk.data[i + 1], chunk.data[i + 2], 255]);
  }

  const transparency = chunks.find((item) => item.type === "tRNS");
  if (transparency) {
    for (let i = 0; i < transparency.data.length && i < palette.length; i += 1) {
      palette[i][3] = transparency.data[i];
    }
  }

  return palette;
}

function unpackSample(row, bitDepth, index) {
  if (bitDepth === 8) return row[index];
  const perByte = 8 / bitDepth;
  const byteIndex = Math.floor(index / perByte);
  const shift = 8 - bitDepth * ((index % perByte) + 1);
  const mask = (1 << bitDepth) - 1;
  return (row[byteIndex] >> shift) & mask;
}

function scaleSample(value, bitDepth) {
  const max = (1 << bitDepth) - 1;
  return Math.round((value * 255) / max);
}

function reconstructRows(filtered, width, height, bytesPerPixel, rowBytes) {
  const output = new Uint8Array(height * rowBytes);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;

    if (sourceOffset + rowBytes > filtered.length) {
      throw new Error("Données PNG IDAT insuffisantes");
    }

    const rowStart = y * rowBytes;
    const previousStart = (y - 1) * rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? output[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? output[previousStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel
        ? output[previousStart + x - bytesPerPixel]
        : 0;

      let value;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + Math.floor((left + up) / 2);
          break;
        case 4:
          value = raw + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Filtre PNG inconnu: ${filter}`);
      }

      output[rowStart + x] = value & 255;
    }

    sourceOffset += rowBytes;
  }

  return output;
}

function rgbaFromRows(rows, width, height, bitDepth, colorType, palette) {
  const channels = {
    0: 1,
    2: 3,
    3: 1,
    4: 2,
    6: 4
  }[colorType];

  if (!channels) throw new Error(`Type de couleur PNG non supporté: ${colorType}`);

  const samplesPerPixel = channels;
  const bitsPerPixel = samplesPerPixel * bitDepth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const rgba = new Uint8Array(width * height * 4);

  let sourceOffset = 0;
  let targetOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const row = rows.subarray(sourceOffset, sourceOffset + rowBytes);
    sourceOffset += rowBytes;

    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;

      if (colorType === 6) {
        const base = x * 4;
        r = row[base];
        g = row[base + 1];
        b = row[base + 2];
        a = row[base + 3];
      } else if (colorType === 2) {
        const base = x * 3;
        r = row[base];
        g = row[base + 1];
        b = row[base + 2];
      } else if (colorType === 4) {
        const base = x * 2;
        r = g = b = row[base];
        a = row[base + 1];
      } else if (colorType === 3) {
        const index = unpackSample(row, bitDepth, x);
        const color = palette?.[index];
        if (!color) throw new Error(`Index de palette PNG invalide: ${index}`);
        [r, g, b, a] = color;
      } else if (colorType === 0) {
        const sample = unpackSample(row, bitDepth, x);
        r = g = b = scaleSample(sample, bitDepth);
      }

      rgba[targetOffset++] = r;
      rgba[targetOffset++] = g;
      rgba[targetOffset++] = b;
      rgba[targetOffset++] = a;
    }
  }

  return rgba;
}

export async function decodePng(buffer) {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((item) => item.type === "IHDR");
  if (!ihdr || ihdr.data.length !== 13) throw new Error("IHDR PNG absent ou invalide");

  const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = ihdrView.getUint32(0);
  const height = ihdrView.getUint32(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const compression = ihdr.data[10];
  const filterMethod = ihdr.data[11];
  const interlace = ihdr.data[12];

  if (!width || !height) throw new Error("Dimensions PNG invalides");
  if (compression !== 0 || filterMethod !== 0) throw new Error("Méthode PNG non supportée");
  if (interlace !== 0) throw new Error("PNG interlacé non supporté");
  if (![0, 2, 3, 4, 6].includes(colorType)) throw new Error(`Type de couleur PNG non supporté: ${colorType}`);
  if (![1, 2, 4, 8].includes(bitDepth) || (colorType === 2 && bitDepth !== 8) || (colorType === 4 && bitDepth !== 8) || (colorType === 6 && bitDepth !== 8)) {
    throw new Error(`Combinaison PNG non supportée: colorType=${colorType}, bitDepth=${bitDepth}`);
  }

  const idatParts = chunks.filter((item) => item.type === "IDAT").map((item) => item.data);
  const compressedLength = idatParts.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const part of idatParts) {
    compressed.set(part, compressedOffset);
    compressedOffset += part.length;
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const filtered = await inflateZlib(compressed);
  const rows = reconstructRows(filtered, width, height, bytesPerPixel, rowBytes);
  const rgba = rgbaFromRows(rows, width, height, bitDepth, colorType, readPalette(chunks));

  return { width, height, rgba };
}
