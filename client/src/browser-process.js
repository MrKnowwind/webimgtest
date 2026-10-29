import { initializeImageMagick, ImageMagick, MagickFormat, MagickGeometry, MagickColor, AlphaAction, QuantizeSettings, ColorSpace, ResourceLimits } from '@imagemagick/magick-wasm';
import initOxi, { optimise } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import { normalizeOptions, targetSize, ProcessingError, bytesEqual, sha256 } from '../../shared/options.js';

let ready = false;
export async function initializeBrowserProcessor(magickWasm, oxipngWasm) {
  if (ready) return;
  await initializeImageMagick(magickWasm);
  await initOxi(oxipngWasm);
  ResourceLimits.width = 12000n; ResourceLimits.height = 12000n;
  ResourceLimits.memory = 384n * 1024n * 1024n; ResourceLimits.disk = 0n;
  ResourceLimits.listLength = 2n;
  ready = true;
}

const formatMap = { png: MagickFormat.Png, jpeg: MagickFormat.Jpeg, webp: MagickFormat.WebP, avif: MagickFormat.Avif };
const rawPixels = (image) => image.getPixels((pixels) => pixels.toByteArray(0, 0, image.width, image.height, 'RGBA')).slice();
const profile = (image, name) => image.getProfile(name)?.data.slice();
const optimize = (bytes) => optimise(bytes, 2, false, false).slice();

export async function processInBrowser(input, settings = {}) {
  if (!ready) throw new ProcessingError('编码器尚未就绪');
  const options = normalizeOptions(settings), bytes = new Uint8Array(input);
  return ImageMagick.readCollection(bytes, async (images) => {
    if (images.length !== 1) throw new ProcessingError('暂不处理动画或多帧图片，以免丢失帧');
    const image = images[0], sourceFormat = image.format.toLowerCase();
    if (!formatMap[sourceFormat]) throw new ProcessingError('仅支持 PNG、JPG、WebP 和 AVIF');
    if (image.width * image.height > 24_000_000) throw new ProcessingError('单张图片最多 2400 万像素');
    const inputWidth = image.width, inputHeight = image.height;
    const size = targetSize(inputWidth, inputHeight, options);
    const passThrough = sourceFormat === options.format && sourceFormat !== 'png' && !size.resized && (!options.allowReencode || options.mode === 'lossless');
    if (!passThrough && options.mode === 'lossless' && options.format === 'jpeg') throw new ProcessingError('JPEG 转换或缩放不支持可验证的无损编码，请改用 PNG / WebP');
    const png16 = sourceFormat === 'png' && bytes[24] > 8;
    if (!passThrough && options.mode === 'lossless' && (image.depth > 8 || png16 || sourceFormat === 'avif')) throw new ProcessingError('网页引擎不能对高位深或 AVIF 输入承诺逐像素无损，请保留原文件或选用有损模式');
    if (!passThrough && image.colorSpace === ColorSpace.CMYK) throw new ProcessingError('CMYK 色彩空间请使用本地 Sharp 服务处理，网页不会静默更改 ICC');
    const originalProfiles = Object.fromEntries(image.profileNames.map((name) => [name, profile(image, name)]));
    const warnings = [], engines = ['ImageMagick WASM'];
    if (size.resized) {
      const geometry = new MagickGeometry(size.width, size.height); geometry.ignoreAspectRatio = false;
      image.resize(geometry);
      warnings.push('已等比例缩放；像素校验以缩放后的结果为基准，原始像素已改变');
    }
    const verified = passThrough || options.mode === 'lossless';
    const before = verified ? rawPixels(image) : null;
    let buffer;
    if (passThrough) {
      buffer = bytes.slice(); warnings.push('同格式原样保留，未再次编码；源文件本身可能采用有损编码');
    } else if (sourceFormat === 'png' && options.format === 'png' && !size.resized && options.mode === 'lossless') {
      buffer = optimize(bytes); engines.push('Oxipng WASM');
    } else {
      image.quality = options.mode === 'lossless' ? 100 : options.quality;
      if (options.format === 'jpeg' && !image.isOpaque) {
        if (!options.flattenAlpha) throw new ProcessingError('JPEG 不支持透明，请选择其他格式或明确允许铺底');
        image.backgroundColor = new MagickColor(options.background); image.alpha(AlphaAction.Remove);
        warnings.push(`透明通道已铺底为 ${options.background}`);
      }
      image.settings.setDefine(MagickFormat.WebP, 'lossless', options.mode === 'lossless');
      image.settings.setDefine(MagickFormat.WebP, 'exact', true);
      image.settings.setDefine(MagickFormat.WebP, 'alpha-quality', 100);
      image.settings.setDefine('heic:chroma', '444');
      image.settings.setDefine('heic:speed', '6');
      if (options.format === 'avif' && options.mode === 'lossless') image.quality = 100;
      if (options.format === 'png' && options.mode === 'lossy') {
        const quantize = new QuantizeSettings(); quantize.colors = Math.max(2, Math.round(options.quality * 2.56)); image.quantize(quantize);
      }
      buffer = image.write(formatMap[options.format], (data) => data.slice());
      if (options.format === 'png') { buffer = optimize(buffer); engines.push('Oxipng WASM'); }
    }
    const after = ImageMagick.read(buffer, (output) => ({
      data: verified ? rawPixels(output) : null, width: output.width, height: output.height,
      profiles: Object.fromEntries(output.profileNames.map((name) => [name, profile(output, name)])),
    }));
    if (verified && (!bytesEqual(before, after.data) || image.width !== after.width || image.height !== after.height)) throw new ProcessingError('像素一致性验证失败（包括透明像素 RGB）；请改用 PNG 或有损模式');
    const icc = originalProfiles.icc || originalProfiles.icm, outputIcc = after.profiles.icc || after.profiles.icm;
    const iccPreserved = !icc || bytesEqual(icc, outputIcc);
    if (verified && !iccPreserved) throw new ProcessingError('ICC 配置无法原样保留，不能声明无损');
    if (!iccPreserved) warnings.push('ICC 配置未能原样保留');
    for (const name of ['exif', 'xmp', 'iptc']) {
      if (originalProfiles[name] && !after.profiles[name]) warnings.push(`${name.toUpperCase()} 不受目标容器支持，未能保留`);
      else if (originalProfiles[name] && !bytesEqual(originalProfiles[name], after.profiles[name])) warnings.push(`${name.toUpperCase()} 已按输出格式重写，建议核对`);
    }
    if (buffer.length > bytes.length) warnings.push('输出体积比原文件大');
    return { buffer, report: {
      format: options.format, mode: passThrough ? 'passthrough' : options.mode, verified,
      verificationScope: size.resized ? 'resized' : 'original', pixelDepth: 'RGBA8',
      inputPixelHash: before ? await sha256(before) : null, outputPixelHash: after.data ? await sha256(after.data) : null,
      inputSha256: await sha256(bytes), outputSha256: await sha256(buffer),
      inputBytes: bytes.length, outputBytes: buffer.length, width: after.width, height: after.height,
      inputWidth, inputHeight, iccPreserved, engines, warnings,
    } };
  });
}
