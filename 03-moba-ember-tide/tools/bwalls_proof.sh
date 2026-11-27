#!/bin/zsh
# 换画风 B · b-walls：证明墙、石头、城墙、树的位置和挡路范围没变。把 tools/bwalls_proof_entry.ts 分别对“改前的源码”和“现在的源码”打包、在 node 里跑，比两份输出。
# 用法: zsh tools/bwalls_proof.sh <改前源码的根目录（里面有 src/）> <输出目录>
# 例:   git archive <改前的提交> src | tar -x -C /某个临时目录 ；zsh tools/bwalls_proof.sh /某个临时目录 docs/style_b/b-walls/proof
set -e
OLD=$1; OUT=$2; HERE=${0:A:h}/..
mkdir -p $OUT $OLD/tools
cp $HERE/tools/bwalls_proof_entry.ts $OLD/tools/bwalls_proof_entry.ts
ES=$HERE/node_modules/.bin/esbuild
$ES $OLD/tools/bwalls_proof_entry.ts --bundle --platform=node --format=esm --log-level=warning "--banner:js=globalThis.location={search:\"\"};" --outfile=$OUT/proof_old.mjs
$ES $HERE/tools/bwalls_proof_entry.ts --bundle --platform=node --format=esm --log-level=warning "--banner:js=globalThis.location={search:\"\"};" --outfile=$OUT/proof_new.mjs
node $OUT/proof_old.mjs > $OUT/layout_before.json
node $OUT/proof_new.mjs > $OUT/layout_after.json
rm -f $OUT/proof_old.mjs $OUT/proof_new.mjs
node -e '
const a = JSON.parse(require("fs").readFileSync(process.argv[1])), b = JSON.parse(require("fs").readFileSync(process.argv[2]));
let bad = 0;
for (const k of Object.keys(a)) { if (k === "info") continue; const same = JSON.stringify(a[k]) === JSON.stringify(b[k]); if (!same) bad++; const n = Array.isArray(a[k]) ? a[k].length + " 项" : JSON.stringify(a[k]).slice(0, 90); console.log((same ? "一样  " : "不一样") + "  " + k + "  " + n); }
console.log("（会变的，只记一下）改前 " + JSON.stringify(a.info) + "\n（会变的，只记一下）改后 " + JSON.stringify(b.info));
console.log(bad ? "有 " + bad + " 项不一样" : "全部一样");
process.exit(bad ? 1 : 0);' $OUT/layout_before.json $OUT/layout_after.json
