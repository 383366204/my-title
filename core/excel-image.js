'use strict';

const fs = require('fs');
const JSZip = require('jszip');

const { EMBEDDABLE_IMAGE_FORMATS, readImageDimensions, sniffImageFormat } = require('./image-format');

const EMU_PER_PIXEL = 9525;
const EMU_PER_POINT = 12700;
const DEFAULT_THUMBNAIL_SIZE = 70;
const DEFAULT_THUMBNAIL_GAP = 6;
const DEFAULT_THUMBNAIL_INSET = 4;

function columnWidthToEmu(widthChars) {
  const chars = Number(widthChars) > 0 ? Number(widthChars) : 8.43;
  return (Math.round(chars * 7) + 5) * EMU_PER_PIXEL;
}

function rowHeightToEmu(heightPoints) {
  const points = Number(heightPoints) > 0 ? Number(heightPoints) : 15;
  return points * EMU_PER_POINT;
}

/**
 * Excel 列宽（字符）换算成像素后再加 5 的内边距，这里做反向换算。
 * @param {number} pixels 目标像素宽度
 * @returns {number} 列宽字符数
 */
function pixelsToColumnWidth(pixels) {
  return Math.max(8.43, (Number(pixels) - 5) / 7);
}

function buildAxisPrefix(sizes) {
  const prefix = [0];
  for (let i = 0; i < sizes.length; i += 1) prefix.push(prefix[i] + sizes[i]);
  return prefix;
}

function axisOrigin(prefix, sizes, index) {
  if (index < prefix.length) return prefix[index];
  const fallback = sizes.length > 0 ? sizes[sizes.length - 1] : prefix[prefix.length - 1];
  return prefix[prefix.length - 1] + (index - (prefix.length - 1)) * fallback;
}

function anchorPoint(body, tag) {
  const block = new RegExp(`<xdr:${tag}>([\\s\\S]*?)</xdr:${tag}>`).exec(body);
  if (!block) return null;
  const num = (name) => Number(new RegExp(`<xdr:${name}>(-?\\d+)</xdr:${name}>`).exec(block[1])?.[1] || 0);
  return { col: num('col'), colOff: num('colOff'), row: num('row'), rowOff: num('rowOff') };
}

function escapeXmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 按原图比例把图片缩进 maxWidth x maxHeight 的框里，不改变长宽比。
 * @param {{width:number,height:number}|null} dimensions 原图像素尺寸
 * @param {number} maxWidth 框宽上限（像素）
 * @param {number} maxHeight 框高上限（像素）
 * @returns {{width:number, height:number}} 等比缩放后的显示尺寸（保留小数，避免取整破坏比例）
 */
function fitImageBox(dimensions, maxWidth, maxHeight) {
  const width = Number(dimensions && dimensions.width);
  const height = Number(dimensions && dimensions.height);
  // 读不出尺寸时退回整框，至少保证图片可见
  if (!(width > 0) || !(height > 0)) return { width: maxWidth, height: maxHeight };
  // 上限 1：比框还小的图保持原尺寸，放大只会更糊
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, width * scale),
    height: Math.max(1, height * scale)
  };
}

/**
 * 以缩略图形式嵌入一张图片，位置是"第 row 行第 col 列"里第 slot 个格子位。
 * 显示尺寸按原图长宽比等比缩放后在格位内居中，因此横图和竖图都不会被拉伸变形。
 * 每张图单独一个 twoCellAnchor 对象，因此在 Excel 里可以单独点选和复制。
 * @param {ExcelJS.Workbook} workbook 目标工作簿
 * @param {object} sheet 目标工作表
 * @param {{buffer: Buffer, extension: string}} image 图片字节与格式
 * @param {object} [options] 摆放参数
 * @param {number} options.col 列索引（0-based）
 * @param {number} options.row 行号（1-based）
 * @param {number} [options.slot] 同一行内的第几张，0 起
 * @param {number} [options.maxWidth] 缩略图框宽上限像素
 * @param {number} [options.maxHeight] 缩略图框高上限像素
 * @param {number} [options.gap] 缩略图之间的间隔像素
 * @param {number} [options.inset] 距行顶的最小留白像素
 * @returns {number} 图片 ID
 */
function addThumbnailImage(workbook, sheet, image, options = {}) {
  const col = Number(options.col);
  const row = Number(options.row);
  if (!Number.isInteger(col) || col < 0 || !Number.isInteger(row) || row < 1) {
    throw new Error('缩略图位置参数不合法');
  }
  const maxWidth = Number(options.maxWidth) || DEFAULT_THUMBNAIL_SIZE;
  const maxHeight = Number(options.maxHeight) || maxWidth;
  const gap = Number(options.gap) >= 0 ? Number(options.gap) : DEFAULT_THUMBNAIL_GAP;
  const inset = Number(options.inset) >= 0 ? Number(options.inset) : DEFAULT_THUMBNAIL_INSET;
  const slot = Math.max(0, Number(options.slot) || 0);
  const box = fitImageBox(readImageDimensions(image && image.buffer), maxWidth, maxHeight);
  // 在格位内居中，横图竖图看起来都整齐，也不会和相邻格位的图重叠
  const leftPad = (maxWidth - box.width) / 2;
  const topPad = inset + (maxHeight - box.height) / 2;
  // 全程按 EMU 取整，像素级取整会把 4000x1000 这类极端比例算成 110x28（应为 27.5）而破坏等比
  const fromX = Math.round((slot * (maxWidth + gap) + leftPad) * EMU_PER_PIXEL);
  const fromY = Math.round(topPad * EMU_PER_PIXEL);
  const imageId = workbook.addImage(image);
  sheet.addImage(imageId, {
    tl: { nativeCol: col, nativeColOff: fromX, nativeRow: row - 1, nativeRowOff: fromY },
    br: {
      nativeCol: col,
      nativeColOff: fromX + Math.round(box.width * EMU_PER_PIXEL),
      nativeRow: row - 1,
      nativeRowOff: fromY + Math.round(box.height * EMU_PER_PIXEL)
    },
    editAs: 'oneCell'
  });
  return imageId;
}

/**
 * 补齐 ExcelJS 写死的图片元数据，让手机 WPS/Excel 等渲染器也能画出图片。
 * ExcelJS 会把 spPr/a:xfrm 写成 off=0,0 / ext=0,0，并给 a:blip 加上 cstate="print"，
 * 还把图片名硬编码成 "Picture N"。桌面版 Excel 会按锚点重算所以看不出问题，
 * 只读 xfrm 的渲染器则算出零尺寸图片而什么都不画。
 * @param {string} file 已写出的 xlsx 路径
 * @param {object} [layout] 工作表布局，用于把单元格坐标换算成绝对 EMU
 * @param {Array<number>} [layout.columnWidths] 各列宽度（字符）
 * @param {Array<number>} [layout.rowHeights] 各行高度（磅）
 * @param {Array<string>} [layout.labels] 按嵌入顺序给图片起的名字，便于在 Excel 里辨认与单独复制
 * @returns {Promise<number>} 修补的锚点数量
 */
async function hardenDrawingAnchors(file, layout = {}) {
  const colSizes = (Array.isArray(layout.columnWidths) ? layout.columnWidths : []).map(columnWidthToEmu);
  const rowSizes = (Array.isArray(layout.rowHeights) ? layout.rowHeights : []).map(rowHeightToEmu);
  const colPrefix = buildAxisPrefix(colSizes);
  const rowPrefix = buildAxisPrefix(rowSizes);
  const labels = Array.isArray(layout.labels) ? layout.labels : null;
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const drawingNames = Object.keys(zip.files).filter(name => /^xl\/drawings\/drawing\d+\.xml$/.test(name));
  let patched = 0;

  for (const name of drawingNames) {
    const xml = await zip.file(name).async('string');
    let anchorIndex = -1;
    const next = xml.replace(
      /<xdr:(one|two)CellAnchor([^>]*)>([\s\S]*?)<\/xdr:\1CellAnchor>/g,
      (whole, kind, attrs, body) => {
        const from = anchorPoint(body, 'from');
        if (!from) return whole;
        anchorIndex += 1;
        const x = axisOrigin(colPrefix, colSizes, from.col) + from.colOff;
        const y = axisOrigin(rowPrefix, rowSizes, from.row) + from.rowOff;
        let width = null;
        let height = null;
        if (kind === 'two') {
          const to = anchorPoint(body, 'to');
          if (to) {
            width = axisOrigin(colPrefix, colSizes, to.col) + to.colOff - x;
            height = axisOrigin(rowPrefix, rowSizes, to.row) + to.rowOff - y;
          }
        } else {
          const ext = /<xdr:ext cx="(-?\d+)" cy="(-?\d+)"\s*\/>/.exec(body);
          if (ext) {
            width = Number(ext[1]);
            height = Number(ext[2]);
          }
        }
        if (!(width > 0) || !(height > 0)) return whole;
        patched += 1;
        let fixed = body.replace(
          /<a:xfrm><a:off x="[^"]*" y="[^"]*"\s*\/><a:ext cx="[^"]*" cy="[^"]*"\s*\/><\/a:xfrm>/,
          `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`
        );
        // cstate 是给外链图片用的完成状态标记，纯内嵌图片带上它会让部分渲染器以为图片待加载
        fixed = fixed.replace(/\s+cstate="[^"]*"/g, '');
        const label = labels ? String(labels[anchorIndex] || '').trim() : '';
        if (label) {
          fixed = fixed.replace(
            /(<xdr:cNvPr id="\d+" name=")[^"]*(")/,
            (match, prefix, suffix) => `${prefix}${escapeXmlText(label)}${suffix}`
          );
        }
        return `<xdr:${kind}CellAnchor${attrs}>${fixed}</xdr:${kind}CellAnchor>`;
      }
    );
    if (next !== xml) zip.file(name, next);
  }

  if (patched > 0) {
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(file, buffer);
  }
  return patched;
}

module.exports = {
  DEFAULT_THUMBNAIL_GAP,
  DEFAULT_THUMBNAIL_INSET,
  DEFAULT_THUMBNAIL_SIZE,
  EMBEDDABLE_IMAGE_FORMATS,
  addThumbnailImage,
  columnWidthToEmu,
  fitImageBox,
  hardenDrawingAnchors,
  pixelsToColumnWidth,
  readImageDimensions,
  rowHeightToEmu,
  sniffImageFormat
};
