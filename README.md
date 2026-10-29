# Cover Lab · 游戏封面测试台

一个无运行依赖的静态测试网站。在类似游戏平台的大厅网格中临时查看图片，检查尺寸、清晰度、裁切和加载耗时。所有资源随项目一起发布，不依赖第三方字体或图片。

## 本地使用

安装 Node.js 22 或更高版本，在此目录运行：

```powershell
npm ci
npm run dev
```

浏览器打开 <http://127.0.0.1:4173>。按 Ctrl+C 停止。

```powershell
npm test          # 测试传输估算与高 DPR / 裁切像素判断
npm run build    # 输出 dist/
npm run preview  # 用 HTTP 查看构建产物，仍使用 4173 端口
```

`dev` 和 `preview` 不要同时占用同一个端口。可通过 `$env:PORT=4174` 指定其他端口。不要直接双击 HTML：浏览器的 ES 模块需要 HTTP 服务。

## 上传到 GitHub 后自动部署

已配置 [GitHub Actions 工作流](.github/workflows/deploy.yml)，不需要个人 Token、额外密钥或付费后端。

1. 在 GitHub 建立仓库。免费个人账号建议使用公开仓库；私有仓库的 Pages 支持取决于账号方案。
2. 将这个目录的**全部源码（包含 `.github` 文件夹）**提交到仓库默认分支。不要只上传 `dist/`。可以用 GitHub Desktop，也可以执行下面的命令，把地址换成自己的空仓库地址：

   ```powershell
   git init -b main
   git add .
   git commit -m "Add Cover Lab image test bench"
   git remote add origin https://github.com/你的用户名/你的仓库名.git
   git push -u origin main
   ```

3. 仓库 **Settings → Pages → Build and deployment → Source → GitHub Actions**。这是首次需要进行的一次设置。
4. 如果第一次提交发生在开启 Pages 之前，进入 **Actions → Test and deploy Cover Lab → Run workflow**，选择默认分支再运行一次。失败后也可以点击 Re-run all jobs。
5. 部署成功后，在仓库 **Settings → Pages** 或 Actions 中的 `github-pages` 环境查看访问地址，通常为 `https://你的用户名.github.io/你的仓库名/`。

之后每次 push 到**仓库默认分支**都会自动测试、构建并部署。其他分支和 PR 只测试与构建，不部署。资源使用相对路径，可部署到仓库子路径，不需要改域名或 base 配置。

首次启用 Pages 需要你在自己的 GitHub 仓库里设置；此项目没有连接远程仓库，尚未执行线上部署。

参考：[GitHub 官方自定义 Pages 工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 怎么测试

- **图片来源**：多选上传或拖入图片，或填写 HTTP(S) 图片 URL / 本站相对路径。每张不超过 25 MB，一次会话最多保留 60 张；本地文件不发送至服务器，刷新即清除。
- **展示**：调节宽度（80–280 CSS px）、封面比例、Cover / Contain / Fill、重复份数和预览宽度。桌面、手机按钮只切换容器宽度。重复份数复用相同资源，不代表多次下载。
- **尺寸与清晰度**：点击封面查看原图尺寸、文件字节和实际 `<img>` 渲染尺寸；根据 `object-fit` 和所选 DPR 判断像素是否够用。DPR 下拉只用于计算，不改变浏览器的实际像素密度。SVG 为矢量，不能通过它判断位图压缩效果。
- **原图对比**：查看原图，切换适应窗口 / 1:1。1:1 对应 CSS 像素，高分屏仍需结合实际显示检查。不做任何压缩或格式转换。
- **F12**：右键封面 → 检查；可以直接检查真实 `img` 的 Rendered size、Intrinsic size、宽高、object-fit 和源地址。页面右上角也有操作指南。

## 本地上传与网络测速的区别

本地文件生成 `blob:` URL，只能测浏览器读取和 `decode()` 等待时间。**它没有网络下载，不能代表 CDN、GitHub Pages 或实际玩家的加载速度。** 浏览器也可能已在触发 `load` 前完成部分解码，所以单列的 `decode()` 等待并非独立纯解码 CPU 耗时。

URL 测试使用真实 `Image` 请求，记录设置 `src` 到 `decode()` 完成的耗时，不包含最终绘制。跨域图片通常能显示，但原站防盗链、访问鉴权、HTTP 混合内容或浏览器不支持的格式可能导致失败；只有原站允许时才会暴露详细 Resource Timing。文件体积 / 传输大小拿不到时会显示未知，不把它当成 0。

“添加随机参数”用于尽量获得不同缓存键，不能保证所有 CDN 绕过缓存，也可能破坏签名 URL。需要原样访问时取消勾选。**F12 Network 勾选 Disable cache，设置限速并检查 Timing，才是检查缓存和链路的依据**。不要把 localhost 的时间当作线上速度。

要测自己图片的真实线上下载：

1. 将图片放入 `public/test-images/`，如 `public/test-images/game-a.webp`。
2. 提交并等待 GitHub 自动部署完成。
3. 在已部署的网站中输入 `./test-images/game-a.webp`。
4. F12 → Network → Disable cache → 选择目标限速 → 重新测试。建议冷、热缓存各测 3–5 次，并用真实手机和目标地区网络验证。

提交到 `public/` 的文件会随网站公开发布。网页内临时选取的文件不会写入仓库，也不会持久保存。

## 加载速度参考

以下是测试起点，不是对所有平台的硬标准：

- 对约 150 × 200 CSS px 的封面，可先尝试 30–100 KB 的 WebP / AVIF，像素宽高覆盖目标 DPR；以实际压缩细节和观感为准。
- 目标网络下，未缓存单张请求到可解码尽量 ≤ 500 ms；500–1000 ms 可优化，超过 1 s 优先排查体积、延迟与缓存。测试台不对本地读取时间给出网络速度评级。
- 单张表现不能代表整个大厅。还需要检查首屏图片合计体积、并发下载、懒加载、设备解码能力与 CDN 地理位置。
- 整页加载参考 [Google LCP 指标](https://web.dev/articles/lcp)：75% 访问的 LCP ≤ 2.5 s 为良好。这个指标和单图加载时间不同，本工具没有声称测量整页 LCP。
- “带宽估算”是 `字节数 × 8 ÷ (Mbps × 1,000,000) × 1000 + 首包延迟`，只是传输下限，不会真的限速，也不计服务端处理、并发争用、丢包、解码与绘制。合计按每个库中原图一次计算，重复展示不重复累加。

## 文件结构

```text
public/                   网页源码与静态资源
  app.js                  上传、预览、测量与交互
  metrics.js              传输估算、DPR 与填充像素判断
  demo/                   6 张原创 SVG 示例封面
  test-images/            可自行添加需要线上测速的图片
scripts/build.mjs         复制静态资源到 dist
scripts/serve.mjs         本地预览服务器
scripts/make-demo-art.mjs  重新生成示例封面（一般不需要执行）
tests/                    Node.js 内置测试，无测试依赖
.github/workflows/        GitHub Pages 自动测试与部署
```
