/**
 * 评价草稿自动保存的纯逻辑：快照基线 + 差量收集。
 * 面板每次加载/保存成功后重建基线，编辑时只把和基线不同的行发给服务端。
 */

/**
 * 建立草稿行的保存基线（评价内容 + 对应文件）。
 * @param {Array<object>} rows 草稿行
 * @returns {Map<string, {experienceNotes:string, reviewContent:string, correspondingFile:string}>} 按行 id 索引的基线
 */
export function snapshotDraftRows(rows = []) {
  return new Map((Array.isArray(rows) ? rows : []).map(row => [
    String(row.id || ''),
    {
      experienceNotes: String(row.experienceNotes || ''),
      reviewContent: String(row.reviewContent || ''),
      correspondingFile: String(row.correspondingFile || '')
    }
  ]));
}

/**
 * 收集与基线不同的行，作为自动保存的差量负载。
 * @param {Array<object>} rows 当前草稿行
 * @param {Map<string, {experienceNotes:string, reviewContent:string, correspondingFile:string}>} baseline snapshotDraftRows 的结果
 * @returns {Array<{id:string, experienceNotes:string, reviewContent:string, correspondingFile:string}>} 有改动的行
 */
export function collectChangedReviews(rows = [], baseline = new Map()) {
  return (Array.isArray(rows) ? rows : [])
    .filter(row => String(row.id || ''))
    .map(row => {
      const id = String(row.id);
      const current = {
        experienceNotes: String(row.experienceNotes || ''),
        reviewContent: String(row.reviewContent || ''),
        correspondingFile: String(row.correspondingFile || '')
      };
      const base = baseline.get(id);
      return base
        && base.experienceNotes === current.experienceNotes
        && base.reviewContent === current.reviewContent
        && base.correspondingFile === current.correspondingFile
        ? null
        : { id, ...current };
    })
    .filter(Boolean);
}
