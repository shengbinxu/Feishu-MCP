import axios, { AxiosError } from "axios";
import { Logger } from "../server.js";

export interface FeishuError {
  status: number;
  err: string;
  apiError?: any;
}

/**
 * @deprecated 目前未使用，为将来的扩展保留。如需使用请适当更新它
 */
export interface FeishuDocContent {
  title: string;
  content: any;
  revision: number;
}

export interface FeishuDocumentInfo {
  document_id: string;
  revision_id: number;
  title: string;
  display_setting?: any;
}

export interface FeishuDocumentBlock {
  block_id: string;
  block_type: number;
  parent_id: string;
  children?: string[];
  [key: string]: any; // 其他块类型特有属性
}

export class FeishuService {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl = "https://open.feishu.cn/open-apis";
  private accessToken: string | null = null;
  private tokenExpireTime: number | null = null;
  private readonly MAX_TOKEN_LIFETIME = 2 * 60 * 60 * 1000; // 2小时的毫秒数

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
  }

  // 包装和重新抛出错误的辅助方法
  private wrapAndThrowError(message: string, originalError: any): never {
    Logger.error(`${message}:`, originalError);
    
    // 如果原始错误已经是FeishuError格式，直接重新抛出
    if (originalError && typeof originalError === 'object' && 'status' in originalError && 'err' in originalError) {
      throw originalError;
    }
    
    // 如果是AxiosError，抽取有用信息
    if (originalError instanceof AxiosError && originalError.response) {
      throw {
        status: originalError.response.status,
        err: `${message}: ${originalError.response.data?.msg || originalError.message || 'Unknown error'}`,
        apiError: originalError.response.data
      } as FeishuError;
    }
    
    // 其他类型的错误，包装为一致的格式
    if (originalError instanceof Error) {
      throw {
        status: 500,
        err: `${message}: ${originalError.message}`,
        apiError: originalError
      } as FeishuError;
    }
    
    // 未知错误类型
    throw {
      status: 500,
      err: message,
      apiError: originalError
    } as FeishuError;
  }

  private isTokenExpired(): boolean {
    if (!this.accessToken || !this.tokenExpireTime) return true;
    return Date.now() >= this.tokenExpireTime;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && !this.isTokenExpired()) {
      Logger.log('使用现有访问令牌，未过期');
      return this.accessToken;
    }

    try {
      const url = `${this.baseUrl}/auth/v3/tenant_access_token/internal`;
      const requestData = {
        app_id: this.appId,
        app_secret: this.appSecret,
      };

      Logger.log('开始获取新的访问令牌...');
      Logger.log(`请求URL: ${url}`);
      Logger.log(`请求方法: POST`);
      Logger.log(`请求数据: ${JSON.stringify(requestData, null, 2)}`);

      const response = await axios.post(url, requestData);

      Logger.log(`响应状态码: ${response?.status}`);
      Logger.log(`响应头: ${JSON.stringify(response.headers, null, 2)}`);
      Logger.log(`响应数据: ${JSON.stringify(response.data, null, 2)}`);

      if (response.data.code !== 0) {
        Logger.error(`获取访问令牌失败，错误码: ${response.data.code}, 错误信息: ${response.data.msg}`);
        throw {
          status: response.status,
          err: response.data.msg || "Unknown error",
          apiError: response.data
        } as FeishuError;
      }

      this.accessToken = response.data.tenant_access_token;
      this.tokenExpireTime = Date.now() + Math.min(
        response.data.expire * 1000,
        this.MAX_TOKEN_LIFETIME
      );
      Logger.log(`成功获取新的访问令牌，有效期: ${response.data.expire} 秒`);
      return this.accessToken as string; // 使用类型断言确保返回类型为string
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        Logger.error(`获取访问令牌请求失败:`);
        Logger.error(`状态码: ${error.response.status}`);
        Logger.error(`响应头: ${JSON.stringify(error.response.headers, null, 2)}`);
        Logger.error(`响应数据: ${JSON.stringify(error.response.data, null, 2)}`);
        throw {
          status: error.response.status,
          err: error.response.data?.msg || "Unknown error",
          apiError: error.response.data
        } as FeishuError;
      }
      Logger.error('获取访问令牌时发生未知错误:', error);
      throw new Error("Failed to get Feishu access token");
    }
  }

  private async request<T>(endpoint: string, method: string = "GET", data?: any): Promise<T> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${this.baseUrl}${endpoint}`;
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };

      Logger.log('准备发送请求:');
      Logger.log(`请求URL: ${url}`);
      Logger.log(`请求方法: ${method}`);
      Logger.log(`请求头: ${JSON.stringify(headers, null, 2)}`);
      if (data) {
        Logger.log(`请求数据: ${JSON.stringify(data, null, 2)}`);
      }

      const response = await axios<any>({
        method,
        url,
        headers,
        data,
      });

      Logger.log('收到响应:');
      Logger.log(`响应状态码: ${response.status}`);
      Logger.log(`响应头: ${JSON.stringify(response.headers, null, 2)}`);
      Logger.log(`响应数据: ${JSON.stringify(response.data, null, 2)}`);

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        Logger.error(`请求失败:`);
        Logger.error(`状态码: ${error.response.status}`);
        Logger.error(`响应头: ${JSON.stringify(error.response.headers, null, 2)}`);
        Logger.error(`响应数据: ${JSON.stringify(error.response.data, null, 2)}`);
        throw {
          status: error.response.status,
          err: error.response.data?.msg || "Unknown error",
          apiError: error.response.data
        } as FeishuError;
      }
      Logger.error('发送请求时发生未知错误:', error);
      throw new Error("Failed to make request to Feishu API");
    }
  }

  // 创建新文档
  async createDocument(title: string, folderToken?: string): Promise<any> {
    try {
      Logger.log(`开始创建飞书文档，标题: ${title}${folderToken ? `，文件夹Token: ${folderToken}` : '，根目录'}`);

      const endpoint = '/docx/v1/documents';
      const data: Record<string, any> = {
        title: title,
      };

      if (folderToken) {
        data.folder_token = folderToken;
      }

      Logger.log(`准备请求API端点: ${endpoint}`);
      Logger.log(`请求数据: ${JSON.stringify(data, null, 2)}`);

      const response = await this.request<{code: number, msg: string, data?: {document: any}}>(endpoint, 'POST', data);

      if (response.code !== 0) {
        throw new Error(`创建文档失败: ${response.msg}`);
      }

      const docInfo = response.data?.document;
      Logger.log(`文档创建成功，文档ID: ${docInfo?.document_id}`);
      Logger.log(`文档详情: ${JSON.stringify(docInfo, null, 2)}`);

      return docInfo;
    } catch (error) {
      this.wrapAndThrowError('创建文档失败', error);
    }
  }

  // 获取文档信息
  async getDocumentInfo(documentId: string): Promise<FeishuDocumentInfo> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      Logger.log(`开始获取文档信息，文档ID: ${docId}`);

      const endpoint = `/docx/v1/documents/${docId}`;
      Logger.log(`准备请求API端点: ${endpoint}`);

      const response = await this.request<{code: number, msg: string, data?: {document: FeishuDocumentInfo}}>(endpoint);

      if (response.code !== 0) {
        throw new Error(`获取文档信息失败: ${response.msg}`);
      }

      const docInfo = response.data?.document;
      Logger.log(`文档信息获取成功: ${JSON.stringify(docInfo, null, 2)}`);

      if (!docInfo) {
        throw new Error(`获取文档信息失败: 返回的文档信息为空`);
      }

      return docInfo;
    } catch (error) {
      Logger.error(`获取文档信息失败:`, error);
      throw error;
    }
  }

  // 获取文档纯文本内容
  async getDocumentContent(documentId: string, lang: number = 0): Promise<string> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      Logger.log(`开始获取文档内容，文档ID: ${docId}，语言: ${lang}`);

      const endpoint = `/docx/v1/documents/${docId}/raw_content?lang=${lang}`;
      Logger.log(`准备请求API端点: ${endpoint}`);

      const response = await this.request<{code: number, msg: string, data?: {content: string}}>(endpoint);

      if (response.code !== 0) {
        throw new Error(`获取文档内容失败: ${response.msg}`);
      }

      Logger.log(`文档内容获取成功，长度: ${response.data?.content?.length || 0}字符`);

      return response.data?.content || '';
    } catch (error) {
      Logger.error(`获取文档内容失败:`, error);
      throw error;
    }
  }

  // 获取文档块
  async getDocumentBlocks(documentId: string, pageSize: number = 500): Promise<FeishuDocumentBlock[]> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      Logger.log(`开始获取文档块，文档ID: ${docId}，页大小: ${pageSize}`);

      const endpoint = `/docx/v1/documents/${docId}/blocks?document_revision_id=-1&page_size=${pageSize}`;
      Logger.log(`准备请求API端点: ${endpoint}`);

      const response = await this.request<{code: number, msg: string, data?: {items: FeishuDocumentBlock[]}}>(endpoint);

      if (response.code !== 0) {
        throw new Error(`获取文档块失败: ${response.msg}`);
      }

      const blocks = response.data?.items || [];
      Logger.log(`文档块获取成功，共 ${blocks.length} 个块`);

      return blocks;
    } catch (error) {
      Logger.error(`获取文档块失败:`, error);
      throw error;
    }
  }

  // 创建代码块
  async createCodeBlock(documentId: string, parentBlockId: string, code: string, language: number = 0, wrap: boolean = false, index: number = 0): Promise<any> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      // 确保语言参数不为0，默认使用1(PlainText)
      const safeLanguage = language === 0 ? 1 : language;

      Logger.log(`开始创建代码块，文档ID: ${docId}，父块ID: ${parentBlockId}，语言: ${safeLanguage}，自动换行: ${wrap}，插入位置: ${index}`);

      const blockContent = {
        block_type: 14, // 14表示代码块
        code: {
          elements: [
            {
              text_run: {
                content: code,
                text_element_style: {
                  bold: false,
                  inline_code: false,
                  italic: false,
                  strikethrough: false,
                  underline: false
                }
              }
            }
          ],
          style: {
            language: safeLanguage,
            wrap: wrap
          }
        }
      };

      Logger.log(`代码块内容: ${JSON.stringify(blockContent, null, 2)}`);
      return await this.createDocumentBlock(documentId, parentBlockId, blockContent, index);
    } catch (error) {
      Logger.error(`创建代码块失败:`, error);
      throw error;
    }
  }

  // 创建文本块
  async createTextBlock(documentId: string, parentBlockId: string, textContents: Array<{text: string, style?: any}>, align: number = 1, index: number = 0): Promise<any> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      Logger.log(`开始创建文本块，文档ID: ${docId}，父块ID: ${parentBlockId}，对齐方式: ${align}，插入位置: ${index}`);

      const blockContent = {
        block_type: 2, // 2表示文本块
        text: {
          elements: textContents.map(content => ({
            text_run: {
              content: content.text,
              text_element_style: content.style || {}
            }
          })),
          style: {
            align: align // 1 居左，2 居中，3 居右
          }
        }
      };

      Logger.log(`文本块内容: ${JSON.stringify(blockContent, null, 2)}`);
      return await this.createDocumentBlock(documentId, parentBlockId, blockContent, index);
    } catch (error) {
      Logger.error(`创建文本块失败:`, error);
      throw error;
    }
  }

  // 创建文档块
  async createDocumentBlock(documentId: string, parentBlockId: string, blockContent: any, index: number = 0): Promise<any> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      Logger.log(`开始创建文档块，文档ID: ${docId}，父块ID: ${parentBlockId}，插入位置: ${index}`);

      const endpoint = `/docx/v1/documents/${docId}/blocks/${parentBlockId}/children?document_revision_id=-1`;
      Logger.log(`准备请求API端点: ${endpoint}`);

      const data = {
        children: [blockContent],
        index: index
      };

      Logger.log(`请求数据: ${JSON.stringify(data, null, 2)}`);

      const response = await this.request<{code: number, msg: string, data: any}>(endpoint, 'POST', data);

      if (response.code !== 0) {
        throw new Error(`创建文档块失败: ${response.msg}`);
      }

      Logger.log(`文档块创建成功: ${JSON.stringify(response.data, null, 2)}`);

      return response.data;
    } catch (error) {
      Logger.error(`创建文档块失败:`, error);
      throw error;
    }
  }

  // 创建文本块内容
  createTextBlockContent(textContents: Array<{text: string, style?: any}>, align: number = 1): any {
    return {
      block_type: 2, // 2表示文本块
      text: {
        elements: textContents.map(content => ({
          text_run: {
            content: content.text,
            text_element_style: content.style || {}
          }
        })),
        style: {
          align: align // 1 居左，2 居中，3 居右
        }
      }
    };
  }

  // 创建代码块内容
  createCodeBlockContent(code: string, language: number = 0, wrap: boolean = false): any {
    // 确保语言参数不为0，默认使用1(PlainText)
    const safeLanguage = language === 0 ? 1 : language;
    
    return {
      block_type: 14, // 14表示代码块
      code: {
        elements: [
          {
            text_run: {
              content: code,
              text_element_style: {
                bold: false,
                inline_code: false,
                italic: false,
                strikethrough: false,
                underline: false
              }
            }
          }
        ],
        style: {
          language: safeLanguage,
          wrap: wrap
        }
      }
    };
  }

  // 创建标题块内容
  createHeadingBlockContent(text: string, level: number = 1, align: number = 1): any {
    // 确保标题级别在有效范围内（1-9）
    const safeLevel = Math.max(1, Math.min(9, level));

    // 确保align值在合法范围内（1-3）
    // 1表示居左，2表示居中，3表示居右
    const safeAlign = (align === 1 || align === 2 || align === 3) ? align : 1;

    // 根据标题级别设置block_type和对应的属性名
    // 飞书API中，一级标题的block_type为3，二级标题为4，以此类推
    const blockType = 2 + safeLevel; // 一级标题为3，二级标题为4，以此类推
    const headingKey = `heading${safeLevel}`; // heading1, heading2, ...

    // 构建块内容
    const blockContent: any = {
      block_type: blockType
    };

    // 设置对应级别的标题属性
    blockContent[headingKey] = {
      elements: [
        {
          text_run: {
            content: text,
            text_element_style: {}
          }
        }
      ],
      style: {
        align: safeAlign,
        folded: false
      }
    };

    return blockContent;
  }

  // 批量创建文档块
  async createDocumentBlocks(documentId: string, parentBlockId: string, blockContents: any[], index: number = 0): Promise<any> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      Logger.log(`开始批量创建文档块，文档ID: ${docId}，父块ID: ${parentBlockId}，块数量: ${blockContents.length}，插入位置: ${index}`);

      const endpoint = `/docx/v1/documents/${docId}/blocks/${parentBlockId}/children?document_revision_id=-1`;
      Logger.log(`准备请求API端点: ${endpoint}`);

      const data = {
        children: blockContents,
        index: index
      };

      Logger.log(`请求数据: ${JSON.stringify(data, null, 2)}`);

      const response = await this.request<{code: number, msg: string, data: any}>(endpoint, 'POST', data);

      if (response.code !== 0) {
        throw new Error(`批量创建文档块失败: ${response.msg}`);
      }

      Logger.log(`批量文档块创建成功: ${JSON.stringify(response.data, null, 2)}`);

      return response.data;
    } catch (error) {
      Logger.error(`批量创建文档块失败:`, error);
      throw error;
    }
  }

  // 创建标题块
  async createHeadingBlock(documentId: string, parentBlockId: string, text: string, level: number = 1, index: number = 0, align: number = 1): Promise<any> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      // 确保align值在合法范围内（1-3）
      // 1表示居左，2表示居中，3表示居右
      const safeAlign = (align === 1 || align === 2 || align === 3) ? align : 1;

      Logger.log(`开始创建标题块，文档ID: ${docId}，父块ID: ${parentBlockId}，标题级别: ${level}，对齐方式: ${safeAlign}，插入位置: ${index}`);

      // 确保标题级别在有效范围内（1-9）
      const safeLevel = Math.max(1, Math.min(9, level));

      // 根据标题级别设置block_type和对应的属性名
      // 飞书API中，一级标题的block_type为3，二级标题为4，以此类推
      const blockType = 2 + safeLevel; // 一级标题为3，二级标题为4，以此类推
      const headingKey = `heading${safeLevel}`; // heading1, heading2, ...

      // 构建块内容
      const blockContent: any = {
        block_type: blockType
      };

      // 设置对应级别的标题属性
      blockContent[headingKey] = {
        elements: [
          {
            text_run: {
              content: text,
              text_element_style: {}
            }
          }
        ],
        style: {
          align: safeAlign,
          folded: false
        }
      };

      Logger.log(`标题块内容: ${JSON.stringify(blockContent, null, 2)}`);
      return await this.createDocumentBlock(documentId, parentBlockId, blockContent, index);
    } catch (error) {
      this.wrapAndThrowError(`创建标题块失败`, error);
    }
  }

  // 获取块内容
  async getBlockContent(documentId: string, blockId: string): Promise<any> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      Logger.log(`开始获取块内容，文档ID: ${docId}，块ID: ${blockId}`);

      const endpoint = `/docx/v1/documents/${docId}/blocks/${blockId}?document_revision_id=-1`;
      Logger.log(`准备请求API端点: ${endpoint}`);

      const response = await this.request<{code: number, msg: string, data?: {block: any}}>(endpoint);

      if (response.code !== 0) {
        throw new Error(`获取块内容失败: ${response.msg}`);
      }

      const blockContent = response.data?.block;
      Logger.log(`块内容获取成功: ${JSON.stringify(blockContent, null, 2)}`);

      return blockContent;
    } catch (error) {
      this.wrapAndThrowError(`获取块内容失败`, error);
    }
  }

  // 更新块文本内容
  async updateBlockTextContent(documentId: string, blockId: string, textElements: Array<{text: string, style?: any}>): Promise<any> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      Logger.log(`开始更新块文本内容，文档ID: ${docId}，块ID: ${blockId}`);

      const endpoint = `/docx/v1/documents/${docId}/blocks/${blockId}?document_revision_id=-1`;
      Logger.log(`准备请求API端点: ${endpoint}`);

      const elements = textElements.map(item => ({
        text_run: {
          content: item.text,
          text_element_style: item.style || {}
        }
      }));

      const data = {
        update_text_elements: {
          elements: elements
        }
      };

      Logger.log(`请求数据: ${JSON.stringify(data, null, 2)}`);

      const response = await this.request<{code: number, msg: string, data: any}>(endpoint, 'PATCH', data);

      if (response.code !== 0) {
        throw new Error(`更新块文本内容失败: ${response.msg}`);
      }

      Logger.log(`块文本内容更新成功: ${JSON.stringify(response.data, null, 2)}`);

      return response.data;
    } catch (error) {
      this.wrapAndThrowError(`更新块文本内容失败`, error);
    }
  }

  // 创建列表块内容（有序或无序）
  createListBlockContent(text: string, isOrdered: boolean = false, align: number = 1): any {
    // 确保 align 值在合法范围内（1-3）
    const safeAlign = (align === 1 || align === 2 || align === 3) ? align : 1;

    // 有序列表是 block_type: 13，无序列表是 block_type: 12
    const blockType = isOrdered ? 13 : 12;
    const propertyKey = isOrdered ? "ordered" : "bullet";

    // 构建块内容
    const blockContent: any = {
      block_type: blockType
    };

    // 设置列表属性
    blockContent[propertyKey] = {
      elements: [
        {
          text_run: {
            content: text,
            text_element_style: {}
          }
        }
      ],
      style: {
        align: safeAlign,
        folded: false
      }
    };

    return blockContent;
  }

  // 创建列表块（有序或无序）
  async createListBlock(documentId: string, parentBlockId: string, text: string, isOrdered: boolean = false, index: number = 0, align: number = 1): Promise<any> {
    try {
      const docId = this.extractDocIdFromUrl(documentId);
      if (!docId) {
        throw new Error(`无效的文档ID: ${documentId}`);
      }

      // 确保align值在合法范围内（1-3）
      const safeAlign = (align === 1 || align === 2 || align === 3) ? align : 1;
      const listType = isOrdered ? "有序" : "无序";

      Logger.log(`开始创建${listType}列表块，文档ID: ${docId}，父块ID: ${parentBlockId}，对齐方式: ${safeAlign}，插入位置: ${index}`);

      // 创建列表块内容
      const blockContent = this.createListBlockContent(text, isOrdered, safeAlign);

      Logger.log(`列表块内容: ${JSON.stringify(blockContent, null, 2)}`);
      return await this.createDocumentBlock(documentId, parentBlockId, blockContent, index);
    } catch (error) {
      this.wrapAndThrowError(`创建${isOrdered ? "有序" : "无序"}列表块失败`, error);
    }
  }

  // 获取Wiki节点信息并提取文档ID
  async getWikiNodeInfo(wikiToken: string): Promise<any> {
    try {
      const wikiId = this.extractWikiIdFromUrl(wikiToken);
      if (!wikiId) {
        throw new Error(`无效的Wiki链接或Token: ${wikiToken}`);
      }

      Logger.log(`开始获取Wiki节点信息，Token: ${wikiId}`);

      const endpoint = `/wiki/v2/spaces/get_node?obj_type=wiki&token=${wikiId}`;
      Logger.log(`准备请求API端点: ${endpoint}`);

      const response = await this.request<{code: number, msg: string, data?: {node: any}}>(endpoint);

      if (response.code !== 0) {
        throw new Error(`获取Wiki节点信息失败: ${response.msg}`);
      }

      const nodeInfo = response.data?.node;
      Logger.log(`Wiki节点信息获取成功: ${JSON.stringify(nodeInfo, null, 2)}`);

      if (!nodeInfo) {
        throw new Error(`获取Wiki节点信息失败: 返回的节点信息为空`);
      }

      // 验证节点类型是否为docx
      if (nodeInfo.obj_type !== 'docx') {
        throw new Error(`Wiki节点类型不是docx，无法处理: ${nodeInfo.obj_type}`);
      }

      return nodeInfo;
    } catch (error) {
      this.wrapAndThrowError('获取Wiki节点信息失败', error);
    }
  }

  // 从URL或标识符中提取Wiki ID
  private extractWikiIdFromUrl(url: string): string | null {
    // 处理飞书Wiki URL，提取Token
    // 1. wiki URL格式: https://xxx.feishu.cn/wiki/xxxxx
    const wikiMatch = url.match(/\/wiki\/([^?]+)/);
    
    // 2. 直接使用Token
    const directIdMatch = url.match(/^([^?]+)$/);
    
    // 返回匹配结果，如果URL中有查询参数，去掉它们
    let result = wikiMatch ? wikiMatch[1] : (directIdMatch ? directIdMatch[1] : null);
    
    // 如果存在查询参数，去掉它们
    if (result && result.includes('?')) {
      result = result.split('?')[0];
    }
    
    return result;
  }

  private extractDocIdFromUrl(url: string): string | null {
    // 处理飞书文档 URL，提取文档 ID
    // 支持多种URL格式
    // 1. 标准文档URL格式: https://xxx.feishu.cn/docs/xxx 或 https://xxx.feishu.cn/docx/xxx
    const docxMatch = url.match(/\/docx\/(\w+)/); // 匹配 docx 格式
    const docsMatch = url.match(/\/docs\/(\w+)/); // 匹配 docs 格式

    // 2. API URL格式: https://open.feishu.cn/open-apis/doc/v2/documents/xxx
    const apiMatch = url.match(/\/documents\/([\w-]+)/); // 匹配 API URL 格式

    // 3. 直接使用文档ID
    const directIdMatch = url.match(/^([\w-]+)$/); // 如果直接传入了文档ID

    // 按优先级返回匹配结果
    return docxMatch ? docxMatch[1] :
      docsMatch ? docsMatch[1] :
        apiMatch ? apiMatch[1] :
          directIdMatch ? directIdMatch[1] : null;
  }
}