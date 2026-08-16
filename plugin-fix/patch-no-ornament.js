// patch-no-ornament.js
// 用法：在插件目录（maid-whale-webui/）下运行：
//   node patch-no-ornament.js
// 或指定路径：
//   node patch-no-ornament.js <lib/client.js 的路径>
//
// 作用：停掉 dsh-maid-whale-webUI 里导致卡顿的两处常驻 JS
//   (1) 装饰件控制器 ornaments（MutationObserver + ResizeObserver，每次 DOM 变化都重定位固定元素）
//   (2) 桌宠重定位观察器 mascotObserver（监听整个 body 的 childList/subtree）
//   保留：主题配色/背景、桌宠、九宫格边框（frames 控制器不动）。
const fs = require('fs');
const file = process.argv[2] || 'lib/client.js';
const src = fs.readFileSync(file, 'utf8');
let c = src;

const edits = [
  {
    name: '装饰件控制器 ornaments',
    re: /const ornaments = createOrnamentController\([^;]+\);/,
    to: 'const ornaments = { setMode() {}, setWide() {}, sync() {}, dispose() {} };'
  },
  {
    name: '桌宠重定位观察器 mascotObserver',
    re: /const mascotObserver = new MutationObserver\(syncChrome\);\r?\n[ \t]*mascotObserver\.observe\(body, \{\r?\n[ \t]*childList: true,\r?\n[ \t]*subtree: true\r?\n[ \t]*\}\);/,
    to: 'const mascotObserver = { disconnect() {} };'
  }
];

let applied = 0;
for (const e of edits) {
  if (e.re.test(c)) {
    c = c.replace(e.re, e.to);
    applied++;
    console.log('已应用：' + e.name);
  } else {
    console.log('未找到（可能已改过或版本不同）：' + e.name);
  }
}

if (applied === 0) {
  console.log('没有可应用的改动，退出（文件可能已被修改过）。');
  process.exit(1);
}
fs.writeFileSync(file + '.bak', src);
fs.writeFileSync(file, c);
console.log('完成。原文件已备份为 ' + file + '.bak');
console.log('请刷新网页查看效果；若无效，重新执行：dsh plugin --profile web add ./maid-whale-webui');
