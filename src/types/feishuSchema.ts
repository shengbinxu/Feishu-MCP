import { z } from 'zod';

/**
 * 文档ID Schema
 */
export const DocumentIdSchema = z.string().describe(
  'Document ID or URL (required). Supports the following formats:\n' +
  '1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n' +
  '2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n' +
  '3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\n' +
  'Note: Wiki links require conversion with convert_feishu_wiki_to_document_id first.'
);

/**
 * 块ID Schema
 */
export const BlockIdSchema = z.string().describe(
  'Block ID (required). The ID of the specific block. You can obtain block IDs using the get_feishu_document_blocks tool.'
);

/**
 * 父块ID Schema
 */
export const ParentBlockIdSchema = z.string().describe(
  'Parent block ID (required). Target block ID where content will be added, without any URL prefix. ' +
  'For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. ' +
  'Obtain existing block IDs using the get_feishu_document_blocks tool.'
);

/**
 * 位置索引 Schema
 */
export const IndexSchema = z.number().describe(
  'Insertion position index (required). Specifies where the block should be inserted. ' +
  'Use 0 to insert at the beginning. Use get_feishu_document_blocks tool to understand document structure if unsure. ' +
  'For consecutive insertions, calculate next index as previous index + 1.'
);

/**
 * 文本样式 Schema
 */
export const TextStyleSchema = z.object({
  bold: z.boolean().optional().describe('Whether to make text bold. Default is false, equivalent to **text** in Markdown.'),
  italic: z.boolean().optional().describe('Whether to make text italic. Default is false, equivalent to *text* in Markdown.'),
  underline: z.boolean().optional().describe('Whether to add underline. Default is false.'),
  strikethrough: z.boolean().optional().describe('Whether to add strikethrough. Default is false, equivalent to ~~text~~ in Markdown.'),
  inline_code: z.boolean().optional().describe('Whether to format as inline code. Default is false, equivalent to `code` in Markdown.'),
  text_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
    message: "Text color must be between 1 and 7 inclusive"
  }).describe('Text color value. Default is 0 (black). Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error.'),
  background_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
    message: "Background color must be between 1 and 7 inclusive"
  }).describe('Background color value. Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error.')
}).optional().describe('Text style settings. Explicitly set style properties instead of relying on Markdown syntax conversion.');

/**
 * 颜色枚举
 */
export const ColorEnum = z.enum(['black', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple']);

/**
 * 颜色映射
 */
export const ColorValueMap: Record<string, number> = {
  'black': 0,
  'gray': 1,
  'brown': 2,
  'orange': 3,
  'yellow': 4,
  'green': 5,
  'blue': 6,
  'purple': 7
};

/**
 * 颜色 Schema （支持名称或数值）
 */
export const ColorSchema = z.union([
  ColorEnum,
  z.number().min(0).max(7)
]).describe('颜色值。可以使用名称或数字（0-7）指定');

/**
 * 对齐方式 Schema
 */
export const AlignSchema = z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
  message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
}).describe('Text alignment (optional): 1 for left (default), 2 for center, 3 for right. Only these three values are allowed.');

/**
 * 文本内容元素 Schema
 */
export const TextElementSchema = z.object({
  text: z.string().describe('Text content. Provide plain text without markdown syntax; use style object for formatting.'),
  style: TextStyleSchema
});

/**
 * 文本内容数组 Schema
 */
export const TextElementsSchema = z.array(TextElementSchema)
  .describe("Array of text content objects. A block can contain multiple text segments with different styles. Example: [{text:'Hello',style:{bold:true}},{text:' World',style:{italic:true}}]");

/**
 * 语言类型字典
 */
export const LanguageMap: Record<string, number> = {
  'plaintext': 1,
  'abap': 2,
  'ada': 3,
  'apache': 4,
  'apex': 5,
  'assembly': 6,
  'bash': 7,
  'csharp': 8,
  'cpp': 9,
  'c': 10,
  'cobol': 11,
  'css': 12,
  'coffeescript': 13,
  'd': 14,
  'dart': 15,
  'delphi': 16,
  'django': 17,
  'dockerfile': 18,
  'erlang': 19,
  'fortran': 20,
  'go': 22,
  'groovy': 23,
  'html': 24,
  'htmlbars': 25,
  'http': 26,
  'haskell': 27,
  'json': 28,
  'java': 29,
  'javascript': 30,
  'julia': 31,
  'kotlin': 32,
  'latex': 33,
  'lisp': 34,
  'lua': 36,
  'matlab': 37,
  'makefile': 38,
  'markdown': 39,
  'nginx': 40,
  'objectivec': 41,
  'php': 43,
  'perl': 44,
  'powershell': 46,
  'prolog': 47,
  'protobuf': 48,
  'python': 49,
  'r': 50,
  'ruby': 52,
  'rust': 53,
  'sas': 54,
  'scss': 55,
  'sql': 56,
  'scala': 57,
  'scheme': 58,
  'shell': 60,
  'swift': 61,
  'thrift': 62,
  'typescript': 63,
  'vbscript': 64,
  'visualbasic': 65,
  'xml': 66,
  'yaml': 67,
  'cmake': 68,
  'diff': 69,
  'gherkin': 70,
  'graphql': 71
}; 