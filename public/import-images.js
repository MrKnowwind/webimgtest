export const isImage = (file) => file.type?.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|svg|bmp|ico)$/i.test(file.name);

export const imagesFromFiles = (files) => Array.from(files).filter(isImage).map((file) => ({ file, path: file.webkitRelativePath || file.name }));

export async function collectDroppedImages(dataTransfer) {
  // drop 事件结束后 DataTransfer 可能进入保护模式，必须在首次 await 前读取入口。
  const roots = Array.from(dataTransfer.items || []).map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile?.() }));
  const fallback = imagesFromFiles(dataTransfer.files || []);
  if (!roots.some((root) => root.entry)) return fallback;
  const images = [];
  async function visit(entry) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      if (isImage(file)) images.push({ file, path: (entry.fullPath || file.name).replace(/^\//, '') });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // Chromium 一次 readEntries 通常只返回最多 100 项，必须读到空批次。
      while (true) {
        const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!entries.length) break;
        for (const child of entries) await visit(child);
      }
    }
  }
  for (const root of roots) {
    if (root.entry) await visit(root.entry);
    else if (root.file && isImage(root.file)) images.push({ file: root.file, path: root.file.name });
  }
  return images.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }));
}
