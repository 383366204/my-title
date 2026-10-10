/**
 * 从单元格分离指标与趋势，颜色仅用于趋势方向。
 * @param {HTMLElement} cell 指标单元格。
 * @returns {object} 原始指标和趋势证据。
 */
function readMetricCell(cell) {
  const text = (cell.innerText || cell.textContent || '').trim();
  const leaves = Array.from(cell.querySelectorAll('*')).filter(el => !el.children.length && el.textContent.trim());
  const trendElement = [...leaves].reverse().find(el => /^[+-]?\d+(?:\.\d+)?%$/.test(el.textContent.trim()));
  const trendText = trendElement?.textContent.trim();
  const lines = text.split(/\n+/).map(value => value.trim()).filter(Boolean);
  const prefix = trendText ? text.slice(0, -trendText.length).trim() : '';
  const separated = trendElement && text !== trendText && text.endsWith(trendText) && !/[~～至—–]$/.test(prefix);
  const candidate = text.match(/^(.*?)\s+([+-]?\d+(?:\.\d+)?%)$/);
  const match = candidate && !/[~～至—–]$/.test(candidate[1].trim()) ? candidate : null;
  const value = separated ? text.slice(0, -trendText.length).trim() : lines.length > 1 ? lines[0] : match ? match[1] : text;
  const trendRaw = separated ? trendText : lines.length > 1 ? lines.at(-1) : match?.[2] || null;
  const color = separated ? getComputedStyle(trendElement).color : null;
  const rgb = color?.match(/[\d.]+/g)?.map(Number);
  let direction = rgb && rgb[0] > rgb[1] * 1.2 && rgb[0] > rgb[2] * 1.2 ? 'up'
    : rgb && rgb[1] > rgb[0] * 1.2 && rgb[1] > rgb[2] * 1.1 ? 'down' : null;
  if (!direction && trendRaw) direction = trendRaw.startsWith('-') ? 'down' : trendRaw.startsWith('+') ? 'up' : null;
  return { value, trendRaw, direction, color };
}

module.exports = { readMetricCell };
