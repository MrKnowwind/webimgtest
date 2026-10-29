import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDroppedImages, imagesFromFiles } from '../public/import-images.js';

test('拖入文件夹时递归读取所有批次和子目录，只保留图片并保留相对路径', async () => {
  const photo = { name: 'cover.JPG', type: '' };
  const nested = { name: 'cover.webp', type: 'image/webp' };
  const fileEntry = (file, path) => ({ isFile: true, fullPath: path, file: (ok) => ok(file) });
  const folder = (pages) => ({ isDirectory: true, createReader: () => ({ readEntries: (ok) => ok(pages.shift() || []) }) });
  const root = folder([
    [fileEntry({ name: 'readme.txt', type: 'text/plain' }, '/covers/readme.txt')],
    [fileEntry(photo, '/covers/cover.JPG'), folder([[fileEntry(nested, '/covers/sub/cover.webp')]])],
  ]);
  const result = await collectDroppedImages({ items: [{ webkitGetAsEntry: () => root }], files: [] });
  assert.deepEqual(result, [{ file: photo, path: 'covers/cover.JPG' }, { file: nested, path: 'covers/sub/cover.webp' }]);
});

test('文件夹选择器保留相同文件名的不同子目录，无目录 API 时仍可拖入普通图片', async () => {
  const a = { name: 'cover.jpg', type: 'image/jpeg', webkitRelativePath: 'set/a/cover.jpg' };
  const b = { name: 'cover.jpg', type: 'image/jpeg', webkitRelativePath: 'set/b/cover.jpg' };
  const text = { name: 'readme.txt', type: 'text/plain' };
  assert.deepEqual(imagesFromFiles([a, b, text]).map((image) => image.path), ['set/a/cover.jpg', 'set/b/cover.jpg']);
  assert.deepEqual(await collectDroppedImages({ files: [a, text] }), [{ file: a, path: 'set/a/cover.jpg' }]);
});

test('目录读取权限失败会返回明确错误，不会悄悄导入空文件夹', async () => {
  const directory = { isDirectory: true, createReader: () => ({ readEntries: (_ok, fail) => fail(new Error('permission denied')) }) };
  await assert.rejects(collectDroppedImages({ items: [{ webkitGetAsEntry: () => directory }] }), /permission denied/);
});
