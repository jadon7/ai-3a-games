# 打包、手机、上线（阶段 8）

这份手册讲三件事：怎么把游戏打成能上线的包，手机上是怎么适配的，怎么发到 Cloudflare。改了相关代码以后照着后面的“改完要跑的检查”过一遍。

## 一、打包

```bash
npm run build        # 出 dist/
npx vite preview     # 在 5184 端口上看打包以后的样子（离线缓存只在这种打包版里才注册）
```

打包只出游戏这一页（入口 `map.html`，打完抄一份成 `index.html`，所以线上 `/` 和 `/map.html` 都是游戏）。规则都在 `vite.config.ts` 里：

| 做了什么 | 为什么 |
|---|---|
| 代码放 `dist/app/`，文件名带哈希 | 可以永久缓存；`dist/assets/` 留给模型和贴图，和开发时的地址一样 |
| `public/` 里只抄游戏会下载的（`KEEP` 那个函数） | 样板间、建筑查看器这些调试页用的旧资源不上线 |
| 每个 `.glb` 旁边再出一份 gzip 的 `.glbz` | 网格已经用 meshopt 压过，再套一层通用压缩还能小四成；页面里用 `DecompressionStream` 自己解（`src/map/quality.ts` 的 `loadGLB`），不指望 CDN 替我们压 |
| 生成 `sw.js`（模板在 `src/pwa/sw.js`） | 离线缓存。外壳装的时候就存，模型贴图用到才存；进过一次对局以后在后台把这一档剩下的补齐 |
| 生成 `_headers` | 带哈希的代码永久缓存；模型贴图缓存一天；页面和 `sw.js` 每次都问 |
| 生成 `404.html` | 没有这张的话，静态托管会把首页当 404 发回去，缺了的模型就成了“下载成功的一张网页” |

新增了要上线的资源目录，记得加进 `KEEP`，不然线上是 404。

### 资源怎么压的

| 资源 | 做法 | 脚本 |
|---|---|---|
| 建筑（`public/assets/kit`） | meshopt 压缩（high 档），30.6 MB → 7 MB，打包后的 `.glbz` 共 3 MB | `tools/kit_collect.py` 收模型时顺手做 |
| 英雄、野怪的手机档（`hero/m/`、`unit/m/`） | 颜色贴图缩到 1024，法线和粗糙度缩到 512 | `zsh tools/pack_assets.sh`（内部用 `tools/lite_glb.mjs`） |
| 小野怪（狼、山魈、蟾、野猪） | 电脑上也只用 1024 的贴图；2048 的原件在 `art/unit/full/` | 同上 |
| 草的蒙版 `ground_mask` | 4096 的 PNG → 2048 的 WebP；原图在 `art/map/` | 同上；`tools/map_ground.py` 重新生成地面时也会出 |
| 墙和石头的贴图 `slice/tex` | JPG → WebP；原图在 `art/tex_src/slice/` | 同上 |

换了英雄或者野怪的模型以后跑一遍 `zsh tools/pack_assets.sh lite`，不然手机上用的还是旧的。

量下载量：`node tools/net_probe.mjs "http://localhost:5184/map.html?h=lan" [mobile]`（列出每个目录下了多少）。

## 二、手机

档位只在 `src/map/quality.ts` 里判断一次：

- `TOUCH`：主要的指点设备是手指 → 开触屏操作和手机布局。
- `LITE`：手机和平板 → 用 `m/` 里贴图小一号的模型，阴影贴图 2048，不开多重采样，总像素不超过 170 万。
- 测试时用 `?touch=1`、`?q=lite` 强制（会记在这个标签页里，从主菜单进对局换了网址也还管用）。

帧率撑不住时自动降画质（`main.ts` 主循环里的 `adapt`）：每两秒看一次，不到 45 帧降分辨率，最低降到一半；降到底还不到 30 帧就关阴影。自动化的截图和测试不动分辨率，要测带 `?adapt=1`。

触屏操作在 `src/map/game/touch.ts`（手指怎么变成命令）和 `play.ts` 的 `stick / aimBegin / aimDrag / aimEnd / attackNear`（命令怎么执行）。按钮长什么样、摆在哪在 `hud.ts` 样式里 `.hud.touch` 那一段，尺寸都按 `--u` 走（屏幕高 390 时是 16 像素），刘海和底部横条用 `env(safe-area-inset-*)` 让开。

技能在触屏上点一下（不拖）默认自动对准敌人；位移技能不该朝敌人去，在技能定义里写 `tapAim: "move"`（朝摇杆的方向，没推就朝面前）。新加位移技能时记得写。

竖屏、手势、全屏、安装提示在 `src/map/game/mobile.ts`。苹果的浏览器不给网页全屏，只能“添加到主屏幕”，主菜单上有一句提示。

## 三、上线（Cloudflare）

用的是 Workers 的静态资源托管，配置在 `wrangler.jsonc`。

```bash
npm run build
npx wrangler deploy
```

- 登录用的是这台机器上 wrangler 已有的授权（`npx wrangler whoami` 能看到）。不要把任何令牌写进仓库。
- 自定义域名写在 `wrangler.jsonc` 的 `routes` 里（`custom_domain: true`），域名要在同一个 Cloudflare 账号下，发布时它自己建解析记录和证书。
- 重新发布以后，老用户下一次打开页面就会装上新的 service worker，旧版本的缓存整个删掉。

## 四、改完要跑的检查

测试服务器：`npx vite --config vite.test.config.ts`（5190，不会自己刷新）。

```bash
# 桌面：鼠标和键盘（21 项）
MOBA_URL=http://localhost:5190/map.html node tools/click_test.mjs <目录>
# 手机：真的发触摸事件（摇杆、攻击键、技能键点和拖、取消、商店、计分板、菜单、回城、竖屏暂停）
MOBA_URL=http://localhost:5190/map.html node tools/touch_test.mjs <目录>
# 打包版再跑一遍触屏测试
npm run build && MOBA_URL=http://localhost:5184/map.html node tools/touch_test.mjs <目录>     # 先开 npx vite preview
# Safari 的内核（Playwright 带的 WebKit）按 iPhone 横屏走一遍主菜单 → 选人 → 对局
node tools/webkit_test.mjs <目录>
# 手机横屏的截图
node tools/mobile_shot.mjs <目录> 844 390 名字:"查询串"
# 调画面时的新旧对比（固定机位）
zsh tools/ab_shots.sh <目录> <名字> "<附加参数>"
# 声音：录一段，量峰值（我听不了，靠这个确认有声、不爆音）
node tools/sfx_rec.mjs <输出.webm> "director=1&h=lan" 16 55
```

## 五、没法在这台机器上验证的

- 真手机（尤其是 iPhone 的 Safari）：刘海和地址栏的实际占位、真实显卡上的帧率和发热、内存够不够。WebKit 测试只说明同一个内核下页面能跑、布局对。
- 安卓上的全屏和锁横屏、Chrome 的“安装”提示。
- 声音好不好听。
