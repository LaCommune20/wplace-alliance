const PROXY =
  "https://wplace-commune-proxy.mathieu-peter.workers.dev";

// Tuile de laboratoire. On la changera ensuite pour une tuile
// située dans une zone réellement surveillée.
const TILE_X = 1057;
const TILE_Y = 751;

function readPngInfo(buffer) {
  const bytes = new Uint8Array(buffer);
  const signature = [
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a
  ];

  const validSignature = signature.every(
    (value, index) => bytes[index] === value
  );

  if (!validSignature) {
    return { validPng: false };
  }

  // Le premier chunk PNG doit être IHDR.
  const chunkType = String.fromCharCode(
    bytes[12], bytes[13], bytes[14], bytes[15]
  );

  if (chunkType !== "IHDR") {
    return { validPng: false, reason: `Premier chunk: ${chunkType}` };
  }

  const view = new DataView(buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const compression = bytes[26];
  const filter = bytes[27];
  const interlace = bytes[28];

  return {
    validPng: true,
    width,
    height,
    bitDepth,
    colorType,
    compression,
    filter,
    interlace
  };
}

async function main() {
  const url = `${PROXY}/tile/${TILE_X}/${TILE_Y}.png`;

  console.log("Radar Lab");
  console.log("==========");
  console.log("Tuile :", TILE_X, TILE_Y);
  console.log("URL   :", url);
  console.log("");

  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: {
      Accept: "image/png"
    }
  });
  const elapsed = Date.now() - startedAt;

  console.log("HTTP :", response.status);
  console.log("Type :", response.headers.get("content-type"));
  console.log("Taille annoncée :", response.headers.get("content-length"));
  console.log("Cache-Control :", response.headers.get("cache-control"));
  console.log("ETag :", response.headers.get("etag"));
  console.log("Last-Modified :", response.headers.get("last-modified"));
  console.log("Temps réseau :", `${elapsed} ms`);
  console.log("");

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `WPlace proxy returned ${response.status}: ${text}`
    );
  }

  const buffer = await response.arrayBuffer();
  const info = readPngInfo(buffer);

  console.log("Octets réellement reçus :", buffer.byteLength);
  console.log("");

  if (!info.validPng) {
    console.error("Réponse invalide : ce n'est pas un PNG exploitable.");
    console.log("Premiers octets :");
    const bytes = new Uint8Array(buffer.slice(0, 32));
    console.log(
      Array.from(bytes)
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" ")
    );
    process.exitCode = 1;
    return;
  }

  console.log("PNG : OK");
  console.log("Dimensions :", `${info.width} × ${info.height}`);
  console.log("Bit depth :", info.bitDepth);
  console.log("Color type :", info.colorType);
  console.log("Compression :", info.compression);
  console.log("Filter :", info.filter);
  console.log("Interlace :", info.interlace);
  console.log("");
  console.log("Premiers octets :");

  const bytes = new Uint8Array(buffer.slice(0, 32));
  console.log(
    Array.from(bytes)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(" ")
  );
}

main().catch((error) => {
  console.error("");
  console.error("ERREUR RADAR :", error);
  process.exitCode = 1;
});
