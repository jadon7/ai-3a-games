三界座舱 Starship Cockpits
赛博朋克 / NASA 朋克 / Y2K 三套实时渲染的飞船仪表盘

怎么打开
  双击 starship-cockpits.html 即可(单文件版,所有代码都在这一个文件里)。
  three.js 已从 CDN 下载到 js/vendor/,双击即可离线打开(字体仍从 Google Fonts 加载,
  加载不到时用系统字体代替)。
  浏览器需支持 WebGL2 并开启硬件加速(Chrome / Edge / Safari 新版本均可)。

操作
  底部按钮或键盘 1 / 2 / 3   切换风格
  移动鼠标                   机位视差
  底部右侧按钮               全屏
  每套第一次切换需要几秒生成贴图。

文件
  starship-cockpits.html     单文件版,直接双击(依赖同目录 js/vendor/)
  js/vendor/                 本地 three.js r170 与七个 addon(离线可用)
  index.html + js/           源码(多文件版,需通过本地服务器打开,例如在本目录运行
                             python -m http.server 8731 后访问 http://localhost:8731 )
    js/core.js               渲染核心:程序化 PBR 贴图、座舱构件、镜头后期
    js/cyber.js              赛博朋克座舱
    js/nasa.js               NASA 朋克座舱
    js/y2k.js                Y2K 座舱
  tools/build_standalone.py  改完源码后重新生成单文件版: python tools/build_standalone.py
