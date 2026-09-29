import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderOpen, Image as ImageIcon, Loader2, RefreshCw, Scan, Trash2, Wand2 } from 'lucide-react';

import { autoDetectWatermarkBoxes, inpaintImageData, normalizeBox } from '../../watermark/watermark-inpaint.js';
import { createZipStore } from '../../watermark/zip-writer.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const OUTPUT_QUALITY = 0.92;

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function outputName(name) {
  return `${String(name || '图片').replace(/\.[^.]+$/, '')}-无水印.jpg`;
}

async function readImageSize(file) {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function decodeToImageData(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { imageData: context.getImageData(0, 0, canvas.width, canvas.height), canvas, context };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))), 'image/jpeg', OUTPUT_QUALITY);
  });
}

function statusLabel(status) {
  if (status === 'processing') return '修复中';
  if (status === 'done') return '已修复';
  if (status === 'error') return '失败';
  return '待处理';
}

/** Toolbar/mode/action button base style */
const TOOLBAR_BTN = 'inline-flex items-center bg-slate-900/70 border border-slate-600/70 rounded-md text-slate-300 cursor-pointer text-xs gap-1.5 py-1.5 px-2.5 disabled:cursor-not-allowed disabled:opacity-45';
const TOOLBAR_BTN_ACTIVE = 'bg-sky-400/15 border-sky-400/50 text-sky-300';

/** Empty-state action button style */
const EMPTY_ACTION_BTN = 'inline-flex items-center bg-sky-400/10 border border-sky-400/40 rounded-[10px] text-sky-300 cursor-pointer text-sm gap-2 py-4 px-6 transition-all duration-150 ease-in-out hover:bg-sky-400/20 hover:-translate-y-px';

/**
 * 批量去水印工作台：打开图片/文件夹 → 自动或手动框选水印 → 批量修复 → 预览对比 → 打包下载。
 * 全部在本机浏览器内完成，图片不会上传服务器。
 * @param {object} props 组件属性
 * @param {Function} props.onClose 关闭回调
 * @returns {JSX.Element} 工作台面板
 */
export function WatermarkStudioPanel({ onClose }) {
  const [images, setImages] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [mode, setMode] = useState('auto');
  const [applyToAll, setApplyToAll] = useState(true);
  const [drawing, setDrawing] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [notice, setNotice] = useState('');
  const [processing, setProcessing] = useState(null);
  const [compareRatio, setCompareRatio] = useState(50);
  const [downloading, setDownloading] = useState(false);
  const filesRef = useRef(null);
  const folderRef = useRef(null);
  const editorRef = useRef(null);

  const activeImage = useMemo(() => images.find((image) => image.id === activeId) || null, [activeId, images]);
  const doneCount = images.filter((image) => image.status === 'done').length;
  const pendingCount = images.length - doneCount - images.filter((image) => image.status === 'error').length;

  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  // 只在组件卸载时回收 object URL；依赖 images 会在每次编辑后误撤当前显示的图片
  useEffect(() => () => {
    for (const image of imagesRef.current) {
      URL.revokeObjectURL(image.url);
      if (image.resultUrl) URL.revokeObjectURL(image.resultUrl);
    }
  }, []);

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter((file) => IMAGE_TYPES.has(file.type));
    if (files.length === 0) {
      setNotice('没有识别到图片文件（支持 JPG / PNG / WebP）');
      return;
    }
    setNotice('');
    const next = [];
    for (const file of files.slice(0, 200)) {
      try {
        const size = await readImageSize(file);
        next.push({
          id: createId(),
          name: file.name,
          file,
          url: URL.createObjectURL(file),
          width: size.width,
          height: size.height,
          boxes: [],
          status: 'pending',
          resultUrl: '',
          resultBlob: null,
          error: ''
        });
      } catch (_error) {
        // 单个文件解码失败时跳过，不阻断整批
      }
    }
    if (next.length === 0) {
      setNotice('图片读取失败，请确认文件没有损坏');
      return;
    }
    setImages((current) => {
      const merged = [...current, ...next];
      return merged;
    });
    setActiveId((current) => current || next[0].id);
  }, []);

  const updateImage = useCallback((id, patch) => {
    setImages((current) => current.map((image) => (image.id === id ? { ...image, ...patch } : image)));
  }, []);

  const syncBoxesToBatch = useCallback((boxes) => {
    if (!applyToAll) return;
    setImages((current) => current.map((image) => (
      image.status === 'pending' ? { ...image, boxes: boxes.map(normalizeBox) } : image
    )));
  }, [applyToAll]);

  const runAutoDetect = useCallback(async () => {
    if (!activeImage || activeImage.status === 'processing') return;
    try {
      const { imageData } = await decodeToImageData(activeImage.file);
      const boxes = autoDetectWatermarkBoxes(imageData);
      updateImage(activeImage.id, { boxes });
      syncBoxesToBatch(boxes);
      setNotice(boxes.length > 0
        ? `识别到 ${boxes.length} 个疑似水印区域，可拖动调整或删掉误判框`
        : '没有识别到明显水印，可切换手动模式框选');
    } catch (error) {
      setNotice(`自动识别失败：${error.message}`);
    }
  }, [activeImage, syncBoxesToBatch, updateImage]);

  useEffect(() => {
    if (mode === 'auto' && activeImage && activeImage.boxes.length === 0 && activeImage.status === 'pending') {
      runAutoDetect();
    }
    // 自动识别只在该图首次进入时触发，避免编辑框时被反复覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, mode]);

  const addBox = (box) => {
    if (!activeImage) return;
    const normalized = normalizeBox(box);
    const boxes = [...activeImage.boxes, normalized];
    updateImage(activeImage.id, { boxes });
    syncBoxesToBatch(boxes);
  };

  const updateBox = (index, box) => {
    if (!activeImage) return;
    const boxes = activeImage.boxes.map((item, position) => (position === index ? normalizeBox(box) : item));
    updateImage(activeImage.id, { boxes });
  };

  const removeBox = (index) => {
    if (!activeImage) return;
    const boxes = activeImage.boxes.filter((_item, position) => position !== index);
    updateImage(activeImage.id, { boxes });
    syncBoxesToBatch(boxes);
  };

  const processOne = async (image) => {
    updateImage(image.id, { status: 'processing', error: '' });
    const { imageData, canvas, context } = await decodeToImageData(image.file);
    let effectiveBoxes = image.boxes;
    if (effectiveBoxes.length === 0) {
      // 手动模式下没有框就跳过该图；自动模式现场识别一次
      if (mode === 'manual') throw new Error('未框选水印区域');
      effectiveBoxes = autoDetectWatermarkBoxes(imageData);
      updateImage(image.id, { boxes: effectiveBoxes });
    }
    if (effectiveBoxes.length === 0) throw new Error('没有可修复的水印区域');
    const repaired = inpaintImageData(imageData, effectiveBoxes);
    context.putImageData(new ImageData(repaired, imageData.width, imageData.height), 0, 0);
    const blob = await canvasToBlob(canvas);
    if (image.resultUrl) URL.revokeObjectURL(image.resultUrl);
    updateImage(image.id, {
      status: 'done',
      resultBlob: blob,
      resultUrl: URL.createObjectURL(blob),
      error: ''
    });
  };

  const processBatch = async () => {
    const queue = images.filter((image) => image.status !== 'done');
    if (queue.length === 0) {
      setNotice('所有图片都已修复完成');
      return;
    }
    setProcessing({ current: 0, total: queue.length });
    for (const [index, image] of queue.entries()) {
      setProcessing({ current: index, total: queue.length });
      try {
        await processOne(image);
      } catch (error) {
        updateImage(image.id, { status: 'error', error: error.message || '修复失败' });
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    setProcessing({ current: queue.length, total: queue.length });
    setNotice('批量修复完成，可逐张对比预览后打包下载');
  };

  const resetAll = () => {
    for (const image of images) {
      URL.revokeObjectURL(image.url);
      if (image.resultUrl) URL.revokeObjectURL(image.resultUrl);
    }
    setImages([]);
    setActiveId('');
    setProcessing(null);
    setNotice('');
  };

  const download = async () => {
    const finished = images.filter((image) => image.status === 'done' && image.resultBlob);
    if (finished.length === 0) return;
    setDownloading(true);
    try {
      const stamp = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      const stampText = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
      if (finished.length === 1) {
        const link = document.createElement('a');
        link.href = finished[0].resultUrl;
        link.download = outputName(finished[0].name);
        link.click();
      } else {
        const files = [];
        const used = new Set();
        for (const image of finished) {
          let name = outputName(image.name);
          let counter = 2;
          while (used.has(name)) {
            name = outputName(image.name).replace(/\.jpg$/, `-${counter}.jpg`);
            counter += 1;
          }
          used.add(name);
          files.push({ name, bytes: new Uint8Array(await image.resultBlob.arrayBuffer()) });
        }
        const zip = createZipStore(files, { date: stamp });
        const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `去水印-${stampText}.zip`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } finally {
      setDownloading(false);
    }
  };

  const pointerLocation = (event) => {
    const rect = editorRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  };

  const handleEditorPointerDown = (event) => {
    if (!activeImage || activeImage.status === 'processing') return;
    if (event.button !== 0 || event.target.closest('.watermark-box')) return;
    const point = pointerLocation(event);
    setDrawing({ start: point, current: point });
  };

  const handleEditorPointerMove = (event) => {
    if (drawing) {
      setDrawing((current) => (current ? { ...current, current: pointerLocation(event) } : current));
    } else if (dragging) {
      const point = pointerLocation(event);
      setDragging((current) => {
        if (!current) return current;
        if (current.kind === 'move') {
          const dx = point.x - current.start.x;
          const dy = point.y - current.start.y;
          return { ...current, box: normalizeBox({
            x: current.origin.x + dx,
            y: current.origin.y + dy,
            w: current.origin.w,
            h: current.origin.h
          }) };
        }
        return { ...current, box: normalizeBox({
          x: Math.min(current.origin.x, point.x),
          y: Math.min(current.origin.y, point.y),
          w: Math.abs(point.x - current.origin.x) || 0.005,
          h: Math.abs(point.y - current.origin.y) || 0.005
        }) };
      });
    }
  };

  const handleEditorPointerUp = () => {
    if (drawing) {
      const box = normalizeBox({
        x: Math.min(drawing.start.x, drawing.current.x),
        y: Math.min(drawing.start.y, drawing.current.y),
        w: Math.abs(drawing.current.x - drawing.start.x),
        h: Math.abs(drawing.current.y - drawing.start.y)
      });
      if (box.w > 0.01 && box.h > 0.01) addBox(box);
      setDrawing(null);
    }
    if (dragging) {
      const { index, box } = dragging;
      setDragging(null);
      updateBox(index, box);
      syncBoxesToBatch(images.find((image) => image.id === activeId)?.boxes.map((item, position) => (position === index ? box : item)) || []);
    }
  };

  const drawingBox = drawing && Math.abs(drawing.current.x - drawing.start.x) > 0.005
    ? normalizeBox({
      x: Math.min(drawing.start.x, drawing.current.x),
      y: Math.min(drawing.start.y, drawing.current.y),
      w: Math.abs(drawing.current.x - drawing.start.x),
      h: Math.abs(drawing.current.y - drawing.start.y)
    })
    : null;

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3.5 min-h-[420px] px-5 py-10 text-center">
        <div className="text-slate-200 text-lg font-bold">批量去水印</div>
        <p className="text-slate-400 text-xs m-0">选择商品图片或整个文件夹，全部在本机处理，不上传服务器。</p>
        <div className="flex gap-3.5">
          <button type="button" className={EMPTY_ACTION_BTN} onClick={() => filesRef.current?.click()}>
            <ImageIcon size={18} />
            打开图片
          </button>
          <button type="button" className={EMPTY_ACTION_BTN} onClick={() => folderRef.current?.click()}>
            <FolderOpen size={18} />
            打开文件夹
          </button>
        </div>
        {notice && <div className="bg-sky-400/10 rounded-md text-sky-300 text-[11px] py-1.5 px-2.5">{notice}</div>}
        <input ref={filesRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
        <input
          ref={folderRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          webkitdirectory=""
          directory=""
          hidden
          onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center flex-wrap gap-2.5 justify-between">
        <div className="flex items-center flex-wrap gap-2">
          <button type="button" className={`${TOOLBAR_BTN} ${mode === 'auto' ? TOOLBAR_BTN_ACTIVE : ''}`} onClick={() => setMode('auto')}><Scan size={13} /> 自动识别</button>
          <button type="button" className={`${TOOLBAR_BTN} ${mode === 'manual' ? TOOLBAR_BTN_ACTIVE : ''}`} onClick={() => setMode('manual')}><Wand2 size={13} /> 手动框选</button>
          <label className="flex items-center text-slate-400 text-[11px] gap-1.5">
            <input type="checkbox" checked={applyToAll} onChange={(event) => setApplyToAll(event.target.checked)} />
            水印框应用到全部
          </label>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <button type="button" className={TOOLBAR_BTN} onClick={runAutoDetect} disabled={!activeImage || processing}><Scan size={13} /> 重新识别</button>
          <button type="button" className="node-primary-button" onClick={processBatch} disabled={processing || pendingCount === 0}>
            {processing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            {processing ? `修复中 ${processing.current}/${processing.total}` : '开始批量修复'}
          </button>
          <button type="button" className={TOOLBAR_BTN} onClick={download} disabled={downloading || doneCount === 0}>
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            打包下载{doneCount > 0 ? `（${doneCount}）` : ''}
          </button>
          <button type="button" className={TOOLBAR_BTN} onClick={resetAll} disabled={processing}><RefreshCw size={13} /> 重新选择</button>
          <button type="button" className={TOOLBAR_BTN} onClick={onClose}>收起</button>
        </div>
      </div>

      {processing && (
        <div className="bg-slate-800/90 rounded h-[5px] overflow-hidden">
          <div className="h-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-[width] duration-200 ease-in-out" style={{ width: `${Math.round((processing.current / Math.max(1, processing.total)) * 100)}%` }} />
        </div>
      )}
      {notice && <div className="bg-sky-400/10 rounded-md text-sky-300 text-[11px] py-1.5 px-2.5">{notice}</div>}

      <div className="grid gap-3 grid-cols-[168px_minmax(0,1fr)] min-h-[460px] max-md:grid-cols-1">
        <aside className="flex flex-col gap-2 max-h-[62vh] overflow-y-auto pr-0.5 max-md:flex-row max-md:max-h-32 max-md:overflow-x-auto">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              className={`watermark-file ${image.id === activeId ? 'is-active' : ''} is-${image.status}`}
              onClick={() => setActiveId(image.id)}
            >
              <img src={image.resultUrl || image.url} alt={image.name} loading="lazy" />
              <span className="text-slate-300 text-[11px] overflow-hidden text-ellipsis whitespace-nowrap" title={image.name}>{image.name}</span>
              <span className={`rounded text-[10px] ${image.status === 'done' ? 'text-emerald-300' : image.status === 'processing' ? 'text-sky-300' : image.status === 'error' ? 'text-red-300' : 'text-slate-400'}`}>{statusLabel(image.status)}</span>
              {image.status === 'error' && <span className="text-red-300 text-[10px] overflow-hidden text-ellipsis whitespace-nowrap" title={image.error}>{image.error}</span>}
            </button>
          ))}
        </aside>

        <div
          className="relative flex justify-center overflow-hidden rounded-lg border border-slate-600/60 touch-none"
          style={{
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            backgroundImage: 'linear-gradient(45deg, rgba(30, 41, 59, 0.7) 25%, transparent 25%, transparent 75%, rgba(30, 41, 59, 0.7) 75%), linear-gradient(45deg, rgba(30, 41, 59, 0.7) 25%, transparent 25%, transparent 75%, rgba(30, 41, 59, 0.7) 75%)',
            backgroundPosition: '0 0, 10px 10px',
            backgroundSize: '20px 20px'
          }}
          onPointerDown={handleEditorPointerDown}
          onPointerMove={handleEditorPointerMove}
          onPointerUp={handleEditorPointerUp}
          onPointerLeave={handleEditorPointerUp}
          ref={editorRef}
        >
          {activeImage && (
            <>
              <div className="relative max-h-[62vh] max-w-full"><img src={activeImage.url} alt="原图" draggable={false} className="block max-h-[62vh] max-w-full select-none" /></div>
              {activeImage.resultUrl && (
                <div className="absolute inset-0 z-[2]" style={{ clipPath: `inset(0 ${100 - compareRatio}% 0 0)` }}>
                  <img src={activeImage.resultUrl} alt="去水印后" draggable={false} className="block max-h-[62vh] max-w-full select-none" />
                </div>
              )}
              {activeImage.status !== 'done' && activeImage.boxes.map((box, index) => {
                const view = dragging?.index === index ? dragging.box : box;
                return (
                  <div
                    key={`${activeImage.id}-${index}`}
                    className="absolute border-[1.5px] border-dashed border-sky-400/95 bg-sky-400/10 cursor-move z-[3]"
                    style={{ left: `${view.x * 100}%`, top: `${view.y * 100}%`, width: `${view.w * 100}%`, height: `${view.h * 100}%` }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      const point = pointerLocation(event);
                      const corner = event.target.classList.contains('watermark-box-corner');
                      setDragging({
                        index,
                        kind: corner ? 'resize' : 'move',
                        origin: corner ? box : { x: box.x, y: box.y, w: box.w, h: box.h },
                        start: point,
                        box
                      });
                    }}
                  >
                    <span className="absolute left-[3px] top-[3px] bg-sky-400/90 rounded-[3px] text-slate-900 text-[10px] px-1 py-[1px] whitespace-nowrap">水印 {index + 1}</span>
                    <button type="button" className="absolute right-[3px] top-[3px] flex items-center bg-red-400/90 border-0 rounded-[3px] text-white cursor-pointer p-0.5" onPointerDown={(event) => event.stopPropagation()} onClick={() => removeBox(index)}>
                      <Trash2 size={10} />
                    </button>
                    <span className="watermark-box-corner" />
                  </div>
                );
              })}
              {drawingBox && (
                <div
                  className="absolute border-[1.5px] border-dashed border-emerald-400/95 bg-emerald-400/10 pointer-events-none z-[3]"
                  style={{ left: `${drawingBox.x * 100}%`, top: `${drawingBox.y * 100}%`, width: `${drawingBox.w * 100}%`, height: `${drawingBox.h * 100}%` }}
                />
              )}
              {activeImage.resultUrl && (
                <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-[5] flex items-center bg-slate-900/85 rounded-md text-slate-400 text-[10px] gap-2 px-2.5 py-1.5">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={compareRatio}
                    onChange={(event) => setCompareRatio(Number(event.target.value))}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="w-[180px] accent-sky-400"
                  />
                  <span>拖动对比：左原图 / 右修复后</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
