// Prints a table of contents for main.js: every "/* ---------- title ---------- */" section header with its line number.
// Run with:  npm run map
const fs = require("fs");
const lines = fs.readFileSync(__dirname + "/../main.js", "utf8").split("\n");
lines.forEach((l, i) => {
  const m = l.match(/^\s{2}\/\* -{6,}\s*(.*?)(?:\s*-{6,}\s*\*\/)?$/);
  if (m) console.log(String(i + 1).padStart(6), " ", m[1].slice(0, 110));
});
