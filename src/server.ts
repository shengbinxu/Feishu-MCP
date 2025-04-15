import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import express, { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { IncomingMessage, ServerResponse } from 'http';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { formatErrorMessage } from './utils/error.js';
import { FeishuApiService } from './services/feishuApiService.js';
import { Logger } from './utils/logger.js';

export class FeishuMcpServer {
  private readonly server: McpServer;
  private sseTransport: SSEServerTransport | null = null;
  private readonly feishuService: FeishuApiService | null = null;

  constructor() {
    try {
      // 使用单例模式获取飞书服务实例
      this.feishuService = FeishuApiService.getInstance();
      Logger.info('飞书服务初始化成功');
    } catch (error) {
      Logger.error('飞书服务初始化失败:', error);
      throw new Error('飞书服务初始化失败');
    }

    this.server = new McpServer(
      {
        name: 'Feishu MCP Server',
        version: '0.0.1',
      },
      {
        capabilities: {
          logging: {},
          tools: {},
        },
      },
    );

    this.registerTools();
  }

  private registerTools(): void {
    // 添加创建飞书文档工具
    this.server.tool(
      'create_feishu_document',
      'Creates a new Feishu document and returns its information. Use this tool when you need to create a document from scratch with a specific title and folder location.',
      {
        title: z.string().describe('Document title (required). This will be displayed in the Feishu document list and document header.'),
        folderToken: z.string().describe('Folder token (required). Specifies where to create the document. Format is an alphanumeric string like "doxcnOu1ZKYH4RtX1Y5XwL5WGRh".'),
      },
      async ({ title, folderToken }) => {
        try {
          Logger.info(`开始创建飞书文档，标题: ${title}${folderToken ? `，文件夹Token: ${folderToken}` : '，使用默认文件夹'}`);
          const newDoc = await this.feishuService?.createDocument(title, folderToken);
          if (!newDoc) {
            throw new Error('创建文档失败，未返回文档信息');
          }
          Logger.info(`飞书文档创建成功，文档ID: ${newDoc.objToken || newDoc.document_id}`);
          return {
            content: [{ type: 'text', text: JSON.stringify(newDoc, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书文档失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `创建飞书文档失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加获取飞书文档信息工具
    this.server.tool(
      'get_feishu_document_info',
      'Retrieves basic information about a Feishu document. Use this to verify a document exists, check access permissions, or get metadata like title, type, and creation information.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first.'),
      },
      async ({ documentId }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: '飞书服务未初始化，请检查配置' }],
            };
          }

          Logger.info(`开始获取飞书文档信息，文档ID: ${documentId}`);
          const docInfo = await this.feishuService.getDocumentInfo(documentId);
          Logger.info(`飞书文档信息获取成功，标题: ${docInfo.title}`);

          return {
            content: [{ type: 'text', text: JSON.stringify(docInfo, null, 2) }],
          };
        } catch (error) {
          Logger.error(`获取飞书文档信息失败:`, error);
          const errorMessage = formatErrorMessage(error, '获取飞书文档信息失败');
          return {
            content: [{ type: 'text', text: errorMessage }],
          };
        }
      },
    );

    // 添加获取飞书文档内容工具
    this.server.tool(
      'get_feishu_document_content',
      'Retrieves the plain text content of a Feishu document. Ideal for content analysis, processing, or when you need to extract text without formatting. The content maintains the document structure but without styling. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first.'),
        lang: z.number().optional().default(0).describe('Language code (optional). Default is 0 (Chinese). Use 1 for English if available.'),
      },
      async ({ documentId, lang }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: 'Feishu service is not initialized. Please check the configuration' }],
            };
          }

          Logger.info(`开始获取飞书文档内容，文档ID: ${documentId}，语言: ${lang}`);
          const content = await this.feishuService.getDocumentContent(documentId, lang);
          Logger.info(`飞书文档内容获取成功，内容长度: ${content.length}字符`);

          return {
            content: [{ type: 'text', text: content }],
          };
        } catch (error) {
          Logger.error(`获取飞书文档内容失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `获取飞书文档内容失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加获取飞书文档块工具
    this.server.tool(
      'get_feishu_document_blocks',
      'Retrieves the block structure information of a Feishu document. Essential to use before inserting content to understand document structure and determine correct insertion positions. Returns a detailed hierarchy of blocks with their IDs, types, and content. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first.'),
        pageSize: z.number().optional().default(500).describe('Number of blocks per page (optional). Default is 500. Used for paginating large documents. Increase for more blocks at once, decrease for faster response with fewer blocks.'),
      },
      async ({ documentId, pageSize }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: 'Feishu service is not initialized. Please check the configuration' }],
            };
          }

          Logger.info(`开始获取飞书文档块，文档ID: ${documentId}，页大小: ${pageSize}`);
          const blocks = await this.feishuService.getDocumentBlocks(documentId, pageSize);
          Logger.info(`飞书文档块获取成功，共 ${blocks.length} 个块`);

          return {
            content: [{ type: 'text', text: JSON.stringify(blocks, null, 2) }],
          };
        } catch (error) {
          Logger.error(`获取飞书文档块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `获取飞书文档块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加获取块内容工具
    this.server.tool(
      'get_feishu_block_content',
      'Retrieves the detailed content and structure of a specific block in a Feishu document. Useful for inspecting block properties, formatting, and content, especially before making updates or for debugging purposes. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first.'),
        blockId: z.string().describe('Block ID (required). The ID of the specific block to get content from. You can obtain block IDs using the get_feishu_document_blocks tool.'),
      },
      async ({ documentId, blockId }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: '飞书服务未初始化，请检查配置' }],
            };
          }

          Logger.info(`开始获取飞书块内容，文档ID: ${documentId}，块ID: ${blockId}`);
          const blockContent = await this.feishuService.getBlockContent(documentId, blockId);
          Logger.info(`飞书块内容获取成功，块类型: ${blockContent.block_type}`);

          return {
            content: [{ type: 'text', text: JSON.stringify(blockContent, null, 2) }],
          };
        } catch (error) {
          Logger.error(`获取飞书块内容失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `获取飞书块内容失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加更新块文本内容工具
    this.server.tool(
      'update_feishu_block_text',
      'Updates the text content and styling of a specific block in a Feishu document. Can be used to modify content in existing text, code, or heading blocks while preserving the block type and other properties. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first.'),
        blockId: z.string().describe('Block ID (required). The ID of the specific block to update content. You can obtain block IDs using the get_feishu_document_blocks tool.'),
        textElements: z.array(
          z.object({
            text: z.string().describe('Text content. Provide plain text without markdown syntax; use the style object for formatting.'),
            style: z.object({
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
            }).optional().describe('Text style settings. Explicitly set style properties instead of relying on Markdown syntax conversion.')
          })
        ).describe('Array of text content objects. A block can contain multiple text segments with different styles. Example: [{text:"Hello",style:{bold:true}},{text:" World",style:{italic:true}}]'),
      },
      async ({ documentId, blockId, textElements }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: '飞书服务未初始化，请检查配置' }],
            };
          }

          Logger.info(`开始更新飞书块文本内容，文档ID: ${documentId}，块ID: ${blockId}`);
          const result = await this.feishuService.updateBlockTextContent(documentId, blockId, textElements);
          Logger.info(`飞书块文本内容更新成功`);

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`更新飞书块文本内容失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `更新飞书块文本内容失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加通用飞书块创建工具（支持文本、代码、标题）
    this.server.tool(
      'batch_create_feishu_blocks',
      'Creates multiple blocks of different types (text, code, heading, list) in a single API call and at the same position. Significantly improves efficiency compared to creating individual blocks separately. ONLY use this when you need to insert multiple blocks CONSECUTIVELY at the SAME position. If blocks need to be inserted at different positions, use individual block creation tools instead. NOTE: Due to API limitations, you can create a maximum of 50 blocks in a single call. PREFER THIS TOOL OVER INDIVIDUAL BLOCK CREATION TOOLS when creating multiple consecutive blocks, as it is much more efficient and reduces API calls. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first.'),
        parentBlockId: z.string().describe('Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_document_blocks tool.'),
        startIndex: z.number().describe('Starting insertion position index (required). Specifies where the first block should be inserted. Use 0 to insert at the beginning. Use get_feishu_document_blocks tool to understand document structure if unsure.'),
        blocks: z.array(
          z.object({
            blockType: z.enum(['text', 'code', 'heading', 'list']).describe("Block type (required): 'text', 'code', 'heading', or 'list'. Choose based on the content type you need to create. IMPORTANT: For headings use 'heading' (not 'heading1', 'heading2', etc), and specify level within options."),
            options: z.union([
              z.object({
                text: z.object({
                  textStyles: z.array(
                    z.object({
                      text: z.string().describe('Text segment content. The actual text to display.'),
                      style: z.object({
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
                      }).optional().describe('Text style settings. Explicitly set style properties instead of relying on Markdown syntax conversion.'),
                    })
                  ).describe('Array of text content objects with styles. A block can contain multiple text segments with different styles. Example: [{text:"Hello",style:{bold:true}},{text:" World",style:{italic:true}}]'),
                  align: z.number().optional().default(1).describe('Text alignment: 1 for left (default), 2 for center, 3 for right.'),
                }).describe("Text block options. Only used when blockType is 'text'."),
              }),
              z.object({
                code: z.object({
                  code: z.string().describe('Code content. The complete code text to display.'),
                  language: z.number().optional().default(1).describe("Programming language code (optional). Common language codes:\n1: PlainText; 2: ABAP; 3: Ada; 4: Apache; 5: Apex; 6: Assembly; 7: Bash; 8: CSharp; 9: C++; 10: C; 11: COBOL; 12: CSS; 13: CoffeeScript; 14: D; 15: Dart; 16: Delphi; 17: Django; 18: Dockerfile; 19: Erlang; 20: Fortran; 22: Go; 23: Groovy; 24: HTML; 25: HTMLBars; 26: HTTP; 27: Haskell; 28: JSON; 29: Java; 30: JavaScript; 31: Julia; 32: Kotlin; 33: LateX; 34: Lisp; 36: Lua; 37: MATLAB; 38: Makefile; 39: Markdown; 40: Nginx; 41: Objective-C; 43: PHP; 44: Perl; 46: PowerShell; 47: Prolog; 48: ProtoBuf; 49: Python; 50: R; 52: Ruby; 53: Rust; 54: SAS; 55: SCSS; 56: SQL; 57: Scala; 58: Scheme; 60: Shell; 61: Swift; 62: Thrift; 63: TypeScript; 64: VBScript; 65: Visual Basic; 66: XML; 67: YAML; 68: CMake; 69: Diff; 70: Gherkin; 71: GraphQL. Default is 1 (PlainText)."),
                  wrap: z.boolean().optional().default(false).describe('Whether to enable automatic line wrapping. Default is false.'),
                }).describe("Code block options. Only used when blockType is 'code'."),
              }),
              z.object({
                heading: z.object({
                  level: z.number().min(1).max(9).describe('Heading level from 1 to 9, where 1 is the largest (h1) and 9 is the smallest (h9).'),
                  content: z.string().describe('Heading text content. The actual text of the heading.'),
                  align: z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
                    message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
                  }).describe('Text alignment: 1 for left (default), 2 for center, 3 for right. Only these three values are allowed.'),
                }).describe("Heading block options. Only used when blockType is 'heading'."),
              }),
              z.object({
                list: z.object({
                  content: z.string().describe('List item content. The actual text of the list item.'),
                  isOrdered: z.boolean().optional().default(false).describe('Whether this is an ordered (numbered) list item. Default is false (bullet point/unordered).'),
                  align: z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
                    message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
                  }).describe('Text alignment: 1 for left (default), 2 for center, 3 for right. Only these three values are allowed.'),
                }).describe("List block options. Only used when blockType is 'list'."),
              }),
            ]).describe('Options for the specific block type. Must provide the corresponding options object based on blockType.'),
          })
        ).max(50).describe('Array of block configurations (required). Each element contains blockType and options properties. Example: [{blockType:"text",options:{text:{textStyles:[{text:"Hello",style:{bold:true}}]}}},{blockType:"code",options:{code:{code:"console.log(\'Hello\')",language:30}}}]. Maximum 50 blocks per call.'),
      },
      async ({ documentId, parentBlockId, startIndex = 0, blocks }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Feishu service is not initialized. Please check the configuration',
                },
              ],
            };
          }

          if (blocks.length > 50) {
            return {
              content: [{ 
                type: 'text', 
                text: '错误: 每次调用最多只能创建50个块。请分批次创建或减少块数量。' 
              }],
            };
          }

          Logger.info(
            `开始批量创建飞书块，文档ID: ${documentId}，父块ID: ${parentBlockId}，块数量: ${blocks.length}，起始插入位置: ${startIndex}`);

          // 准备要创建的块内容数组
          const blockContents = [];

          // 处理每个块配置
          for (const blockConfig of blocks) {
            const { blockType, options = {} } = blockConfig;
            
            // 创建块内容
            const blockContent = this.feishuService.createBlockContent(blockType, options);

            if (blockContent) {
              blockContents.push(blockContent);
              Logger.info(`已准备${blockType}块，内容: ${JSON.stringify(blockContent).substring(0, 100)}...`);
            }
          }

          // 批量创建所有块
          const result = await this.feishuService.createDocumentBlocks(documentId, parentBlockId, blockContents, startIndex);
          Logger.info(`飞书块批量创建成功，共创建 ${blockContents.length} 个块`);

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`批量创建飞书块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `批量创建飞书块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加创建飞书文本块工具
    this.server.tool(
      "create_feishu_text_block",
      "Creates a new text block with precise style control. Unlike markdown-based formatting, this tool lets you explicitly set text styles for each text segment. Ideal for formatted documents where exact styling control is needed. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first."),
        parentBlockId: z.string().describe("Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_document_blocks tool."),
        textContents: z.array(
          z.object({
            text: z.string().describe("Text content. Provide plain text without markdown syntax; use style object for formatting."),
            style: z.object({
              bold: z.boolean().optional().describe("Whether to make text bold. Default is false, equivalent to **text** in Markdown."),
              italic: z.boolean().optional().describe("Whether to make text italic. Default is false, equivalent to *text* in Markdown."),
              underline: z.boolean().optional().describe("Whether to add underline. Default is false."),
              strikethrough: z.boolean().optional().describe("Whether to add strikethrough. Default is false, equivalent to ~~text~~ in Markdown."),
              inline_code: z.boolean().optional().describe("Whether to format as inline code. Default is false, equivalent to `code` in Markdown."),
              text_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
                message: "Text color must be between 1 and 7 inclusive"
              }).describe("Text color value. Default is 0 (black). Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error."),
              background_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
                message: "Background color must be between 1 and 7 inclusive"
              }).describe('Background color value. Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error.')
            }).optional().describe("Text style settings. Explicitly set style properties instead of relying on Markdown syntax conversion.")
          })
        ).describe("Array of text content objects. A block can contain multiple text segments with different styles. Example: [{text:'Hello',style:{bold:true}},{text:' World',style:{italic:true}}]"),
        align: z.number().optional().default(1).describe("Text alignment: 1 for left (default), 2 for center, 3 for right."),
        index: z.number().describe("Insertion position index (required). Specifies where the block should be inserted. Use 0 to insert at the beginning. Use get_feishu_document_blocks tool to understand document structure if unsure. For consecutive insertions, calculate next index as previous index + 1.")
      },
      async ({ documentId, parentBlockId, textContents, align = 1, index }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          Logger.info(`开始创建飞书文本块，文档ID: ${documentId}，父块ID: ${parentBlockId}，对齐方式: ${align}，插入位置: ${index}`);
          const result = await this.feishuService.createTextBlock(documentId, parentBlockId, textContents, align, index);
          Logger.info(`飞书文本块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书文本块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `创建飞书文本块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加创建飞书代码块工具
    this.server.tool(
      "create_feishu_code_block",
      "Creates a new code block with syntax highlighting and formatting options. Ideal for technical documentation, tutorials, or displaying code examples with proper formatting and language-specific highlighting. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first."),
        parentBlockId: z.string().describe("Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_document_blocks tool."),
        code: z.string().describe("Code content (required). The complete code text to display."),
        language: z.number().optional().default(1).describe("Programming language code (optional). Common language codes:\n1: PlainText; 2: ABAP; 3: Ada; 4: Apache; 5: Apex; 6: Assembly; 7: Bash; 8: CSharp; 9: C++; 10: C; 11: COBOL; 12: CSS; 13: CoffeeScript; 14: D; 15: Dart; 16: Delphi; 17: Django; 18: Dockerfile; 19: Erlang; 20: Fortran; 22: Go; 23: Groovy; 24: HTML; 25: HTMLBars; 26: HTTP; 27: Haskell; 28: JSON; 29: Java; 30: JavaScript; 31: Julia; 32: Kotlin; 33: LateX; 34: Lisp; 36: Lua; 37: MATLAB; 38: Makefile; 39: Markdown; 40: Nginx; 41: Objective-C; 43: PHP; 44: Perl; 46: PowerShell; 47: Prolog; 48: ProtoBuf; 49: Python; 50: R; 52: Ruby; 53: Rust; 54: SAS; 55: SCSS; 56: SQL; 57: Scala; 58: Scheme; 60: Shell; 61: Swift; 62: Thrift; 63: TypeScript; 64: VBScript; 65: Visual Basic; 66: XML; 67: YAML; 68: CMake; 69: Diff; 70: Gherkin; 71: GraphQL. Default is 1 (PlainText)."),
        wrap: z.boolean().optional().default(false).describe("Enable automatic line wrapping (optional). Default is false (no auto-wrap). Set to true to improve readability for long code lines."),
        index: z.number().describe("Insertion position index (required). Specifies where the block should be inserted. Use 0 to insert at the beginning. Use get_feishu_document_blocks tool to understand document structure if unsure. For consecutive insertions, calculate next index as previous index + 1.")
      },
      async ({ documentId, parentBlockId, code, language = 1, wrap = false, index = 0 }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          Logger.info(`开始创建飞书代码块，文档ID: ${documentId}，父块ID: ${parentBlockId}，语言: ${language}，自动换行: ${wrap}，插入位置: ${index}`);
          const result = await this.feishuService.createCodeBlock(documentId, parentBlockId, code, language, wrap, index);
          Logger.info(`飞书代码块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书代码块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `创建飞书代码块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加创建飞书标题块工具
    this.server.tool(
      "create_feishu_heading_block",
      "Creates a heading block with customizable level and alignment. Use this tool to add section titles, chapter headings, or any hierarchical structure elements to your document. Supports nine heading levels for different emphasis needs. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first."),
        parentBlockId: z.string().describe("Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_document_blocks tool."),
        level: z.number().min(1).max(9).describe("Heading level (required). Integer between 1 and 9, where 1 is the largest heading (h1) and 9 is the smallest (h9)."),
        content: z.string().describe("Heading text content (required). The actual text of the heading."),
        align: z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
          message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
        }).describe("Text alignment (optional): 1 for left (default), 2 for center, 3 for right. Only these three values are allowed."),
        index: z.number().describe("Insertion position index (required). Specifies where the block should be inserted. Use 0 to insert at the beginning. Use get_feishu_document_blocks tool to understand document structure if unsure. For consecutive insertions, calculate next index as previous index + 1.")
      },
      async ({ documentId, parentBlockId, level, content, align = 1, index = 0 }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          // 确保align值在合法范围内（1-3）
          if (align !== 1 && align !== 2 && align !== 3) {
            return {
              content: [{ type: "text", text: "错误: 对齐方式(align)参数必须是1(居左)、2(居中)或3(居右)中的一个值。" }],
            };
          }

          Logger.info(`开始创建飞书标题块，文档ID: ${documentId}，父块ID: ${parentBlockId}，标题级别: ${level}，对齐方式: ${align}，插入位置: ${index}`);
          const result = await this.feishuService.createHeadingBlock(documentId, parentBlockId, content, level, index, align);
          Logger.info(`飞书标题块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书标题块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `创建飞书标题块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加创建飞书列表块工具
    this.server.tool(
      "create_feishu_list_block",
      "Creates a list item block (either ordered or unordered). Perfect for creating hierarchical and structured content with bullet points or numbered lists. Note: For Feishu wiki links (https://xxx.feishu.cn/wiki/xxx) you must first use convert_feishu_wiki_to_document_id tool to obtain a compatible document ID.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf\nNote: Wiki links require conversion with convert_feishu_wiki_to_document_id first."),
        parentBlockId: z.string().describe("Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_document_blocks tool."),
        content: z.string().describe("List item content (required). The actual text of the list item."),
        isOrdered: z.boolean().optional().default(false).describe("Whether this is an ordered (numbered) list item. Default is false (bullet point/unordered)."),
        align: z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
          message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
        }).describe("Text alignment (optional): 1 for left (default), 2 for center, 3 for right. Only these three values are allowed."),
        index: z.number().describe("Insertion position index (required). Specifies where the block should be inserted. Use 0 to insert at the beginning. Use get_feishu_document_blocks tool to understand document structure if unsure. For consecutive insertions, calculate next index as previous index + 1.")
      },
      async ({ documentId, parentBlockId, content, isOrdered = false, align = 1, index = 0 }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          // 确保align值在合法范围内（1-3）
          if (align !== 1 && align !== 2 && align !== 3) {
            return {
              content: [{ type: "text", text: "错误: 对齐方式(align)参数必须是1(居左)、2(居中)或3(居右)中的一个值。" }],
            };
          }

          const listType = isOrdered ? "有序" : "无序";
          Logger.info(`开始创建飞书${listType}列表块，文档ID: ${documentId}，父块ID: ${parentBlockId}，对齐方式: ${align}，插入位置: ${index}`);
          const result = await this.feishuService.createListBlock(documentId, parentBlockId, content, isOrdered, index, align);
          Logger.info(`飞书${listType}列表块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书列表块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `创建飞书列表块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加飞书Wiki文档ID转换工具
    this.server.tool(
      'convert_feishu_wiki_to_document_id',
      'Converts a Feishu Wiki document link to a compatible document ID. This conversion is required before using wiki links with any other Feishu document tools.',
      {
        wikiUrl: z.string().describe('Wiki URL or Token (required). Supports complete URL formats like https://xxx.feishu.cn/wiki/xxxxx or direct use of the Token portion'),
      },
      async ({ wikiUrl }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: '飞书服务未初始化，请检查配置' }],
            };
          }

          Logger.info(`开始转换Wiki文档链接，输入: ${wikiUrl}`);
          const documentId = await this.feishuService.convertWikiToDocumentId(wikiUrl);
          
          Logger.info(`Wiki文档转换成功，可用的文档ID为: ${documentId}`);

          return {
            content: [
              { type: 'text', text: `Converted Wiki link to Document ID: ${documentId}\n\nUse this Document ID with other Feishu document tools.` }
            ],
          };
        } catch (error) {
          Logger.error(`转换Wiki文档链接失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `转换Wiki文档链接失败: ${errorMessage}` }],
          };
        }
      },
    );
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);

    Logger.info = (...args: any[]) => {
      this.server.server.sendLoggingMessage({ level: 'info', data: args });
    };
    Logger.error = (...args: any[]) => {
      this.server.server.sendLoggingMessage({ level: 'error', data: args });
    };

    Logger.info('Server connected and ready to process requests');
  }

  async startHttpServer(port: number): Promise<void> {
    const app = express();

    app.get('/sse', async (_req: Request, res: Response) => {
      console.log('New SSE connection established');
      this.sseTransport = new SSEServerTransport('/messages', res as unknown as ServerResponse<IncomingMessage>);
      await this.server.connect(this.sseTransport);
    });

    app.post('/messages', async (req: Request, res: Response) => {
      if (!this.sseTransport) {
        res.sendStatus(400);
        return;
      }
      await this.sseTransport.handlePostMessage(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse<IncomingMessage>
      );
    });

    Logger.info = console.log;
    Logger.error = console.error;

    app.listen(port, () => {
      Logger.info(`HTTP server listening on port ${port}`);
      Logger.info(`SSE endpoint available at http://localhost:${port}/sse`);
      Logger.info(`Message endpoint available at http://localhost:${port}/messages`);
    });
  }
}
