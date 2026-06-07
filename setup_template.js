// 一回限り: 現行 index.html から template.html と data/*.json を切り出す
const fs = require("fs");
fs.mkdirSync("data", { recursive: true });
let src = fs.readFileSync("index.html", "utf-8");

// 1) PLUGINS（1行に注入済み）→ プレースホルダ
const before = src;
src = src.replace(/^const PLUGINS = .*$/m, "const PLUGINS = __PLUGINS_JSON__;");
if (src === before) throw new Error("PLUGINS行が見つからない");

// 2) SKILLS ブロック → メタ抽出＋プレースホルダ
const skRe = /const SKILLS = \[([\s\S]*?)\]\.map\([\s\S]*?\}\)\);/;
const ms = src.match(skRe);
if (!ms) throw new Error("SKILLSブロックが見つからない");
const skills = [...ms[1].matchAll(/\{name:"(.*?)", description:"(.*?)", category:"(.*?)"\}/g)]
  .map(x => ({ name: x[1], description: x[2], category: x[3] }));
fs.writeFileSync("data/skills_meta.json", JSON.stringify(skills, null, 2));
src = src.replace(skRe, "const SKILLS = __SKILLS_JSON__;");

// 3) MCPS ブロック → メタ抽出＋プレースホルダ
const mcRe = /const MCPS = \[([\s\S]*?)\]\.map\([\s\S]*?\}\)\);/;
const mm = src.match(mcRe);
if (!mm) throw new Error("MCPSブロックが見つからない");
const mcps = [...mm[1].matchAll(/\{name:"(.*?)", folder:"(.*?)", description:"(.*?)"\}/g)]
  .map(x => ({ name: x[1], folder: x[2], description: x[3] }));
fs.writeFileSync("data/mcp_meta.json", JSON.stringify(mcps, null, 2));
src = src.replace(mcRe, "const MCPS = __MCPS_JSON__;");

fs.writeFileSync("template.html", src);
const count = (s, t) => s.split(t).length - 1;
console.log("template.html 作成 / skills:", skills.length, "mcp:", mcps.length);
console.log("placeholders:", count(src, "__PLUGINS_JSON__"), count(src, "__SKILLS_JSON__"), count(src, "__MCPS_JSON__"));
