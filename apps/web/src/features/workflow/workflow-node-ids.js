/**
 * Canonical workflow node ID constants.
 *
 * Node IDs are defined by the backend workflow templates and must match
 * exactly (case-sensitive). These constants prevent typos across the
 * 10+ frontend files that reference node IDs.
 *
 * Note: 'review' is a retired node ID mapped to 'export' at runtime
 * via effectiveCanvasNodeId() in workflow-data.js.
 */
export const NODE_IDS = Object.freeze({
  START: 'start',
  MINE: 'mine',
  KEYWORD_REVIEW: 'keywordReview',
  VERIFY: 'verify',
  SELECT: 'select',
  GENERATE: 'generate',
  COLLECT_RANK: 'collectRank',
  CONFIRM_PRODUCTS: 'confirmProducts',
  GENERATE_SHEET: 'generateSheet',
  EXPORT: 'export',
  REVIEW: 'review',           // retired, mapped to EXPORT at runtime
  END: 'end',
  REMOVE_WATERMARK: 'removeWatermark',
  ENRICH_COMPETITORS: 'enrichCompetitors',
  GENERATE_REVIEWS: 'generateReviews'
});
