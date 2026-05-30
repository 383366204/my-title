const { z } = require('zod');

const StringOrNumberSchema = z.union([z.string(), z.number()]);

const ModifierSchema = z.object({
  word: z.string().min(1),
  rigidity: z.enum(['rigid', 'optional']).optional(),
  group: z.string().optional(),
  synonyms: z.array(z.string()).optional()
}).passthrough();

const SemanticGroupsSchema = z.record(z.string(), z.array(z.string()));

const CoreModifiersResponseSchema = z.object({
  coreWord: z.string().min(1),
  modifiers: z.array(ModifierSchema),
  semanticGroups: SemanticGroupsSchema.optional()
}).passthrough();

const PeerKeywordsResponseSchema = CoreModifiersResponseSchema.extend({
  blueOceanWord: z.string().min(1)
});

const RelevanceScoreSchema = z.object({
  productId: StringOrNumberSchema.optional(),
  product_id: StringOrNumberSchema.optional(),
  score: StringOrNumberSchema,
  reason: z.string().optional()
}).passthrough().refine(item => item.productId !== undefined || item.product_id !== undefined, {
  message: 'productId or product_id is required'
});

const RelevanceScoresResponseSchema = z.array(RelevanceScoreSchema);

const GenerateTitlesResponseSchema = z.object({
  titles: z.array(StringOrNumberSchema)
}).passthrough();

const SelectedProductSchema = z.object({
  id: StringOrNumberSchema,
  score: StringOrNumberSchema.optional(),
  reason: z.string().optional(),
  priceAdvice: z.string().optional(),
  risk: z.string().optional()
}).passthrough();

const ProductTitleSchema = z.object({
  productId: StringOrNumberSchema.optional(),
  product_id: StringOrNumberSchema.optional(),
  title: StringOrNumberSchema
}).passthrough();

const SelectAndGenerateResponseSchema = z.object({
  selectedProducts: z.array(SelectedProductSchema),
  titles: z.array(ProductTitleSchema),
  overallAdvice: z.string().optional()
}).passthrough();

const CategoryFiltersResponseSchema = z.object({
  targetCategories: z.array(z.string()),
  excludeCategories: z.array(z.string()),
  relatedMaterials: z.array(z.string())
}).passthrough();

const KeywordSuggestionResponseSchema = z.union([
  z.object({
    keywords: z.array(z.string())
  }).passthrough(),
  z.array(z.string())
]);

module.exports = {
  CategoryFiltersResponseSchema,
  CoreModifiersResponseSchema,
  GenerateTitlesResponseSchema,
  KeywordSuggestionResponseSchema,
  PeerKeywordsResponseSchema,
  RelevanceScoresResponseSchema,
  SelectAndGenerateResponseSchema
};
