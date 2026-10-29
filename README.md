# Cover Lab

线上：[封面预览](https://mrknowwind.github.io/webimgtest/) · [图片处理](https://mrknowwind.github.io/webimgtest/process/)

封面页支持图片和整个文件夹拖入、子目录递归、尺寸与 DPR 检查。默认 1 张示例，导入后替换。已移除耗时估算，仅保留实际读取 / URL 测量。

图片处理使用 React + Vite。默认在浏览器 Worker 中执行真实 ImageMagick WASM + Oxipng WASM 转换，**使用者无需服务器、账号或密钥，图片不上传**。Node.js + Sharp + Oxipng 作为真实可选后端保留。Sharp 原生模块不能直接运行在 GitHub Pages 上，不能把它伪装成浏览器功能。

## 使用

支持 PNG、JPG、WebP、AVIF 批量转换、图片和文件夹拖放、文件夹选择、无损 / 有损、质量参数、等比例缩小、原图与结果预览、体积对比、单图与 ZIP 下载。

默认：**WebP / 无损 / 质量 85 / 原始分辨率**。无损模式保留质量偏好，但不使用质量参数量化像素。处理页每张最多 25 MB / 2400 万像素，每批最多 50 张，输入与结果各 200 MB；封面页独立支持 500 张。

所有编码器、WASM、脚本和样式随仓库部署，不依赖第三方 CDN。WASM 在首次开始处理时加载。原始体积约 15.4 MB，传输压缩后约 5.5 MB。单线程版本不依赖 SharedArrayBuffer 或额外 HTTP 安全头。

## 无损、元数据和原文件

- 网页将普通 8-bit 输入解码为 RGBA8，输出后重新解码，比较每个通道，包括透明像素下面的 RGB。只有尺寸、所有像素和 ICC 检查通过，才返回“像素一致已验证”；失败会拒绝结果，不以肉眼相似冒充无损。
- 报告包含引擎、验证范围、像素深度、基准 / 输出像素 SHA-256、源文件 / 输出文件 SHA-256、尺寸、体积和警告。ZIP 附 `verification.json`。不同解码器对 JPEG 的舍入可能不同，不声称跨解码器哈希必然一致。
- 缩放只等比例缩小，不放大。开启后以缩放后的像素为校验基准，明确标记原始像素已改变，不把整项操作说成对原图无损。
- JPEG 跨格式输出或缩放不提供像素级无损；透明转 JPEG 默认拒绝，需明确允许背景铺底。AVIF 编码即使设置无损，也可能因 RGB / YUV 转换改变像素，校验不通过时拒绝输出。
- 网页引擎对高位深输入、AVIF 输入转换及 CMYK 转换不能承诺逐像素无损，会明确拒绝。动画 / 多帧不会静默取第一帧。可保留原文件、明确使用有损模式，或使用可选 Sharp 服务。
- 同格式 JPG / WebP / AVIF 默认原样直出，不重复编码，报告为“原样保留”，不代表源文件本身采用无损编码。需要同格式有损压缩时，必须勾选“允许同格式有损重编码”。每次从最初上传的 File 开始，不使用上次输出再次编码。
- 优先保留透明、ICC、EXIF、XMP 等。ICC 无法原样保留时不能声明无损；其他元数据不能保留或被容器重写时显示警告。PNG 优化不使用会修改透明 RGB 的 `--alpha` 或清除元数据的 `--strip`。
- 不覆盖原文件。输出使用 `_processed` 后缀，ZIP 重名自动编号。文件变大时明确显示增幅和提醒，由使用者决定是否下载。

## 本地开发

需要 Node.js 22.12+。原生 Oxipng 由 `oxipng-bin` 提供，也可用 `OXIPNG_PATH` 指定自己的可执行文件。

```powershell
npm ci
npm run dev
```

前端：<http://127.0.0.1:4173/>；处理页 `/process/`。可选 API：<http://127.0.0.1:3001/api/health>。本地前端将 `/api` 代理到此服务，默认仍在浏览器处理。

```powershell
npm test
npm run build
npm run preview
```

`preview` 仅提供构建后的静态网页，适合验证无服务器路径；不要与 `dev` 同时占用 4173。浏览器编码在 Worker 内运行，停止处理会终止 Worker。

## GitHub 自动部署

`.github/workflows/deploy.yml` 在默认分支 push 后执行：安装依赖 → 真实编码 / API 测试 → Vite 构建 → GitHub Pages 部署。PR 只验证，不部署。

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。默认浏览器处理路径不需要服务器、Secrets 或后端地址。资源使用相对路径，适配 `/webimgtest/` 子路径。

## 可选 Node / Docker 服务

只在需要 Sharp 时使用，GitHub Pages 无需此步骤。

```powershell
npm run build
npm start
```

`npm start` 在 3001 端口同时提供完整静态网站和 API，可配置 `PORT`、`HOST`。`ALLOWED_ORIGINS` 配置允许的前端来源，逗号分隔。网页展开“可选 Sharp 服务”后可选择服务模式并填写地址；文件会发送至该服务，本地开发地址留空则使用代理。

```powershell
docker build -t cover-lab .
docker run --rm -p 3001:3001 cover-lab
```

API：`POST /api/process`，multipart 字段 `image` 和 JSON 字符串 `options`。返回真实图片二进制，URI 编码的 JSON 报告位于 `X-Image-Report` 响应头。支持 `format`、`mode`、`quality`、可选 `width/height`、`allowReencode`、`flattenAlpha/background`。不持久保存原图，PNG 临时目录在结束后清理，最多同时处理 2 张。

## 验证

`npm test` 使用 Node 内置测试，直接加载与网页相同的 WASM 引擎，也测试 Sharp 和真实 HTTP 上传，不是模拟界面：

- 四种格式真实读写，再由 Sharp 独立解码检查；透明、ICC、EXIF、方向标记和像素哈希。
- 高位深拒绝、JPEG 无损限制、透明铺底需明确允许、等比缩放基准和原文件直出。
- ZIP 内容、重名 / 路径处理、校验报告与输出一致；文件夹多批次递归与错误处理。

界面另经浏览器验证实际批量转换、预览、增大提示及 ZIP 下载。部署后检查真实 Pages 子路径的 Worker / WASM 加载。

代码：`public/` 封面页；`client/` React、Worker 与网页引擎；`server/` 可选 Sharp 服务；`shared/` 参数和 ZIP；`tests/` 真实功能测试。

上游：[Sharp](https://sharp.pixelplumbing.com/api-output/)、[ImageMagick WASM](https://github.com/dlemstra/magick-wasm)、[Oxipng WASM](https://github.com/jamsinclair/jSquash/tree/main/packages/oxipng)。
