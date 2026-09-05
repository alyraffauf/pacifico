/** @jsxImportSource satori/jsx */

import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";
import satori from "satori";

const width = 1200;
const height = 630;
const logo = await readFile(
  new URL("../public/site-mark.png", import.meta.url),
);
const logoUrl = `data:image/png;base64,${logo.toString("base64")}`;

const svg = await satori(
  <div
    style={{
      alignItems: "center",
      background: "#1e1e2e",
      display: "flex",
      height: "100%",
      justifyContent: "center",
      width: "100%",
    }}
  >
    <img
      src={logoUrl}
      style={{ height: 420, objectFit: "contain", width: 420 }}
    />
  </div>,
  { width, height },
);

const image = new Resvg(svg, {
  fitTo: { mode: "width", value: width },
}).render();
await writeFile(new URL("../public/og.png", import.meta.url), image.asPng());

console.log(`Generated public/og.png (${image.width}×${image.height})`);
