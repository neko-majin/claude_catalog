// ビルド: 公式ソース取得 ＋ data/ のメタを合成 → index.html を生成
// 使い方: node build.js
const fs = require("fs");
const crypto = require("crypto");

const MARKETPLACE =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";
const SKILLS_API = "https://api.github.com/repos/anthropics/skills/contents/skills";
const MCP_API = "https://api.github.com/repos/modelcontextprotocol/servers/contents/src";

const HEADERS = { "User-Agent": "cc-catalog-build" };
if (process.env.GITHUB_TOKEN) HEADERS.Authorization = "Bearer " + process.env.GITHUB_TOKEN;

async function fetchText(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return await r.text();
}
async function fetchJson(url) { return JSON.parse(await fetchText(url)); }
// GitHub contents API からサブディレクトリ名一覧を取得（失敗時は fallback を返す）
async function dirNames(url, fallback, label) {
  try {
    const j = await fetchJson(url);
    const dirs = j.filter(x => x.type === "dir").map(x => x.name);
    if (!dirs.length) throw new Error("no dirs");
    return dirs;
  } catch (e) {
    console.warn(`! ${label} の取得に失敗 (${e.message}) → メタの固定一覧を使用`);
    return fallback;
  }
}

async function main() {
  const tpl = fs.readFileSync("template.html", "utf-8");

  // --- プラグイン（公式マーケットプレイスから取得） ---
  const mp = JSON.parse(await fetchText(MARKETPLACE));
  const plugins = mp.plugins.map(p => {
    const src = p.source;
    const internal = typeof src === "string";
    let homepage;
    if (internal) {
      homepage = "https://github.com/anthropics/claude-plugins-official/tree/main/" +
        String(src).replace(/^\.\//, "");
    } else {
      homepage = p.homepage || (src && src.url) || String(src);
    }
    return {
      name: p.name, description: p.description, category: p.category,
      type: internal ? "plugin-internal" : "plugin-external", homepage,
    };
  });

  // --- スキル（公式 anthropics/skills を自動取得し、data の日本語メタを合成） ---
  const skillsMetaArr = JSON.parse(fs.readFileSync("data/skills_meta.json", "utf-8"));
  const skillsMeta = Object.fromEntries(skillsMetaArr.map(s => [s.name, s]));
  const skillNames = await dirNames(SKILLS_API, skillsMetaArr.map(s => s.name), "skills");
  const newSkills = [];
  const skills = skillNames.map(n => {
    const m = skillsMeta[n];
    if (!m) newSkills.push(n);
    return {
      name: n, description: (m && m.description) || n, category: (m && m.category) || "skill",
      type: "skill", homepage: "https://github.com/anthropics/skills/tree/main/skills/" + n,
    };
  });

  // --- MCP（公式 modelcontextprotocol/servers の src を自動取得し、data メタを合成） ---
  const mcpMetaArr = JSON.parse(fs.readFileSync("data/mcp_meta.json", "utf-8"));
  const mcpByFolder = Object.fromEntries(mcpMetaArr.map(m => [m.folder, m]));
  const mcpFolders = await dirNames(MCP_API, mcpMetaArr.map(m => m.folder), "mcp/src");
  const newMcps = [];
  const mcps = mcpFolders.map(f => {
    const m = mcpByFolder[f];
    if (!m) newMcps.push(f);
    return {
      name: (m && m.name) || f, description: (m && m.description) || f, category: "mcp",
      type: "mcp", homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/" + f,
    };
  });

  // --- プラグイン説明の日本語キャッシュ（data/desc_ja.json） ---
  const descJa = JSON.parse(fs.readFileSync("data/desc_ja.json", "utf-8"));
  const untranslated = plugins.filter(p => !descJa[p.name]).map(p => p.name);

  // --- 公式ドキュメントの差分検知（本文ハッシュのみ保存。本文は保存しない） ---
  const { docsStatus, changedDocs } = await watchDocs();

  // --- 差分検出（スナップショット比較） ---
  let { badges, changelog } = diffAndRecord([...plugins, ...skills, ...mcps]);

  // 公式ドキュメント更新を更新履歴に追記
  if (changedDocs.length) {
    changelog = [{ date: new Date().toISOString().slice(0, 10), kind: "docs", docs: changedDocs }, ...changelog];
    fs.writeFileSync("snapshots/changelog.json", JSON.stringify(changelog, null, 2));
  }

  const out = tpl
    .replace("__PLUGINS_JSON__", JSON.stringify(plugins))
    .replace("__SKILLS_JSON__", JSON.stringify(skills))
    .replace("__MCPS_JSON__", JSON.stringify(mcps))
    .replace("__DESC_JA_JSON__", JSON.stringify(descJa))
    .replace("__DOCS_STATUS_JSON__", JSON.stringify(docsStatus))
    .replace("__BADGES_JSON__", JSON.stringify(badges))
    .replace("__CHANGELOG_JSON__", JSON.stringify(changelog));

  fs.writeFileSync("index.html", out);
  const internal = plugins.filter(p => p.type === "plugin-internal").length;
  console.log(`built index.html  plugins:${plugins.length}(内${internal}/外${plugins.length - internal}) skills:${skills.length} mcp:${mcps.length}`);
  console.log(`  日本語訳キャッシュ desc_ja: ${Object.keys(descJa).length}件 / 未翻訳プラグイン: ${untranslated.length}件`);
  console.log(`  公式ドキュメント監視: ${Object.keys(docsStatus).length}件 / 今回更新: ${changedDocs.length}件${changedDocs.length ? " (" + changedDocs.map(d => d.key).join(", ") + ")" : ""}`);
  if (newSkills.length) console.log(`  NEW skills（日本語メタ未整備）: ${newSkills.join(", ")}`);
  if (newMcps.length) console.log(`  NEW mcp（日本語メタ未整備）: ${newMcps.join(", ")}`);
}

// 公式ドキュメント(.md)の本文ハッシュを前回と比較し、更新を検知（本文は保存しない）
async function watchDocs() {
  const list = JSON.parse(fs.readFileSync("data/docs_watch.json", "utf-8"));
  fs.mkdirSync("snapshots", { recursive: true });
  const SNAP = "snapshots/docs.json";
  const prev = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, "utf-8")) : {};
  const today = new Date().toISOString().slice(0, 10);
  const status = {}, changed = [], next = {};
  for (const d of list) {
    let hash = null;
    try {
      const md = await fetchText(d.page + ".md");
      hash = crypto.createHash("sha1").update(md.replace(/\s+/g, "")).digest("hex");
    } catch (e) { console.warn(`! docs取得失敗 ${d.key}: ${e.message}`); }
    const p = prev[d.key];
    let lastChanged, isChanged = false;
    if (!hash) {                         // 取得失敗 → 前回維持
      lastChanged = p ? p.lastChanged : today; hash = p ? p.hash : null;
    } else if (!p) {                     // 初回 = baseline
      lastChanged = today;
    } else if (p.hash !== hash) {        // 変更検知
      isChanged = true; lastChanged = today; changed.push({ key: d.key, label: d.label });
    } else {                             // 変化なし
      lastChanged = p.lastChanged;
    }
    status[d.key] = { label: d.label, page: d.page, gsec: d.gsec, lastChanged, changed: isChanged };
    next[d.key] = { hash, lastChanged };
  }
  fs.writeFileSync(SNAP, JSON.stringify(next, null, 2));
  return { docsStatus: status, changedDocs: changed };
}

// 前回スナップショットと比較し、changelog / badges を更新して返す
function diffAndRecord(items) {
  fs.mkdirSync("snapshots", { recursive: true });
  const SNAP = "snapshots/catalog.json", CLOG = "snapshots/changelog.json", BDG = "snapshots/badges.json";
  const today = new Date().toISOString().slice(0, 10);
  const sig = x => `${x.description}${x.category}${x.homepage}`;
  const cur = {};
  for (const x of items) cur[`${x.type}|${x.name}`] = { name: x.name, type: x.type, sig: sig(x) };

  const readJson = (p, d) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : d;
  const prev = readJson(SNAP, null);
  let changelog = readJson(CLOG, []);
  let badges = readJson(BDG, { new: [], updated: [] });

  if (!prev) {
    // 初回 = ベースライン
    const counts = {};
    for (const x of items) counts[x.type.startsWith("plugin") ? "plugin" : x.type] = (counts[x.type.startsWith("plugin") ? "plugin" : x.type] || 0) + 1;
    changelog = [{ date: today, kind: "baseline", counts }];
    badges = { new: [], updated: [] };
    console.log("  差分: 初回ベースラインを記録");
  } else {
    const added = [], updated = [], removed = [];
    for (const k of Object.keys(cur)) {
      if (!(k in prev)) added.push(k);
      else if (prev[k].sig !== cur[k].sig) updated.push(k);
    }
    for (const k of Object.keys(prev)) if (!(k in cur)) removed.push({ name: prev[k].name, type: prev[k].type });
    if (added.length || updated.length || removed.length) {
      changelog = [{
        date: today, kind: "diff",
        added: added.map(k => ({ name: cur[k].name, type: cur[k].type })),
        updated: updated.map(k => ({ name: cur[k].name, type: cur[k].type })),
        removed,
      }, ...changelog];
      badges = { new: added, updated };
      console.log(`  差分: 追加${added.length} 更新${updated.length} 削除${removed.length}`);
    } else {
      console.log("  差分: 変更なし（バッジ・履歴は前回を維持）");
    }
  }

  // スナップショット保存
  const snapOut = {};
  for (const k of Object.keys(cur)) snapOut[k] = cur[k];
  fs.writeFileSync(SNAP, JSON.stringify(snapOut, null, 0));
  fs.writeFileSync(CLOG, JSON.stringify(changelog, null, 2));
  fs.writeFileSync(BDG, JSON.stringify(badges, null, 2));
  return { badges, changelog };
}

main().catch(e => { console.error("BUILD ERROR:", e.message); process.exit(1); });
