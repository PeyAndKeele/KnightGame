// Prints a table of contents for the game scripts: each js/ file in load order, with every
// "/* ---------- title ---------- */" section header and its line number.
// Run with:  npm run map
const fs = require("fs");
const dir = __dirname + "/../js/";
const parts = JSON.parse(fs.readFileSync(dir + "parts.json", "utf8"));
for (const p of parts) {
  const lines = fs.readFileSync(dir + p, "utf8").split("\n");
  console.log("\n" + p + "  (" + lines.length + " lines)");
  lines.forEach((l, i) => {
    const m = l.match(/^\/\* -{6,}\s*(.*?)(?:\s*-{6,}\s*\*\/)?$/);
    if (m) console.log("  " + String(i + 1).padStart(5) + "  " + m[1].slice(0, 100));
  });
}
