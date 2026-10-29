import magickUrl from '@imagemagick/magick-wasm/magick.wasm?url';
import oxipngUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url';
import { initializeBrowserProcessor, processInBrowser } from './browser-process.js';

let initialization;
self.onmessage = async ({ data }) => {
  try {
    initialization ||= Promise.all([magickUrl, oxipngUrl].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('编码器加载失败，请刷新重试');
      return new Uint8Array(await response.arrayBuffer());
    })).then(([magick, oxipng]) => initializeBrowserProcessor(magick, oxipng));
    await initialization;
    const result = await processInBrowser(new Uint8Array(data.buffer), data.options);
    self.postMessage({ id: data.id, result }, [result.buffer.buffer]);
  } catch (error) { self.postMessage({ id: data.id, error: error.message || '处理失败' }); }
};
