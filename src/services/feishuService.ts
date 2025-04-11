import axios, { AxiosError } from "axios";
import { Logger } from "../server.js";
import { formatErrorMessage } from "../utils/error.js";
import { normalizeDocumentId, normalizeWikiToken } from "../utils/document.js";
import { createCodeBlockContent, createTextBlockContent, createHeadingBlockContent, createListBlockContent } from "./feishuBlockService.js";

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
    // 记录原始错误信息
    Logger.error(`${message}:`, originalError);
    
    // 如果原始错误已经是FeishuError格式，添加更多上下文后重新抛出
    if (originalError && typeof originalError === 'object' && 'status' in originalError && 'err' in originalError) {
      // 添加更具体的错误信息
      throw originalError;
    }
    
    // 如果是AxiosError，提取有用信息并规范化错误格式
    if (originalError instanceof AxiosError && originalError.response) {
      // 获取响应数据
      const responseData = originalError.response.data;
      const error: FeishuError = {
        status: originalError.response.status,
        err: formatErrorMessage(originalError, message),
        apiError: responseData
      };
      
      // 针对HTTP状态码添加帮助信息
      if (originalError.response.status === 404) {
        Logger.info("404错误: 请求的资源未找到。这可能是因为文档/块ID不正确，或者资源已被删除。");
      } else if (originalError.response.status === 403) {
        Logger.info("403错误: 权限不足。这可能是因为应用没有足够的权限或者文档访问设置限制。");
      } else if (originalError.response.status === 401) {
        Logger.info("401错误: 未授权。这可能是因为访问令牌已过期或无效。系统将尝试重新获取令牌。");
      } else if (originalError.response.status === 429) {
        Logger.info("429错误: 请求频率超过限制。请减少请求频率或增加请求之间的间隔时间。");
      }
      
      throw error;
    }
    
    // 处理其他类型的错误，包装为一致的格式
    const errorMessage = originalError instanceof Error 
      ? originalError.message 
      : (typeof originalError === 'string' ? originalError : '未知错误');
    
    throw {
      status: 500,
      err: formatErrorMessage(originalError, message),
      apiError: {
        code: -1,
        msg: errorMessage,
        error: originalError
      }
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

      // 处理飞书API的错误响应（非零code）
      if (response.data && typeof response.data.code === 'number' && response.data.code !== 0) {
        Logger.error(`飞书API返回错误码: ${response.data.code}, 错误消息: ${response.data.msg}`);
        
        // 构建规范的错误对象
        throw {
          status: response.status,
          err: response.data.msg || "API返回错误码",
          apiError: response.data
        } as FeishuError;
      }

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        // HTTP错误响应
        Logger.error(`请求失败:`);
        Logger.error(`状态码: ${error.response.status}`);
        Logger.error(`响应头: ${JSON.stringify(error.response.headers, null, 2)}`);
        Logger.error(`响应数据: ${JSON.stringify(error.response.data, null, 2)}`);
        
        // 飞书API错误响应处理
        if (error.response.data && typeof error.response.data === 'object') {
          const apiError = error.response.data;
          throw {
            status: error.response.status,
            err: apiError.msg || "API请求失败",
            apiError: apiError
          } as FeishuError;
        }
        
        // 通用HTTP错误
        throw {
          status: error.response.status,
          err: error.response.data?.msg || "API请求失败",
          apiError: error.response.data
        } as FeishuError;
      }
      // 处理预先构建的错误对象（例如从飞书API接收的非零code）
      if (error && typeof error === 'object' && 'status' in error && 'err' in error) {
        throw error;
      }
      
      // 其他未捕获的错误
      Logger.error('发送请求时发生未知错误:', error);
      throw {
        status: 500,
        err: error instanceof Error ? error.message : "未知错误",
        apiError: error
      } as FeishuError;
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
      Logger.log(`获取文档信息，原始文档ID/URL: ${documentId}`);
      
      // 使用工具函数提取文档ID
      const extractedDocId = normalizeDocumentId(documentId);
      Logger.log(`提取的文档ID: ${extractedDocId}`);
      
      const endpoint = `/docx/v1/documents/${extractedDocId}`;
      const response = await this.request<any>(endpoint);
      
      if (!response || !response.data) {
        this.wrapAndThrowError('获取文档信息失败，无效的响应', response);
      }
      
      Logger.log('文档信息获取成功');
      return response.data as FeishuDocumentInfo;
    } catch (error) {
      this.wrapAndThrowError('获取文档信息失败', error);
    }
  }

  // 获取文档纯文本内容
  async getDocumentContent(documentId: string, lang: number = 0): Promise<string> {
    try {
      Logger.log(`获取文档内容，原始文档ID/URL: ${documentId}`);

      // 使用工具函数提取文档ID
      const extractedDocId = normalizeDocumentId(documentId);
      Logger.log(`提取的文档ID: ${extractedDocId}`);

      const endpoint = `/docx/v1/documents/${extractedDocId}/raw_content`;
      const params = lang > 0 ? `?lang=${lang}` : '';
      
      const response = await this.request<any>(`${endpoint}${params}`);
      
      if (!response || !response.data) {
        this.wrapAndThrowError('获取文档内容失败，无效的响应', response);
      }
      
      Logger.log('文档内容获取成功');
      return response.data.content || '';
    } catch (error) {
      this.wrapAndThrowError('获取文档内容失败', error);
    }
  }

  // 获取文档块
  async getDocumentBlocks(documentId: string, pageSize: number = 500): Promise<FeishuDocumentBlock[]> {
    try {
      Logger.log(`获取文档块结构，原始文档ID/URL: ${documentId}`);

      // 使用工具函数提取文档ID
      const extractedDocId = normalizeDocumentId(documentId);
      Logger.log(`提取的文档ID: ${extractedDocId}，页大小: ${pageSize}`);

      const endpoint = `/docx/v1/documents/${extractedDocId}/blocks`;
      const params = `?document_revision_id=-1&page_size=${pageSize}`;
      
      const response = await this.request<any>(`${endpoint}${params}`);
      
      if (!response || !response.data || !response.data.items) {
        this.wrapAndThrowError('获取文档块结构失败，无效的响应', response);
      }
      
      Logger.log(`文档块结构获取成功，共获取${response.data.items.length}个块`);
      return response.data.items as FeishuDocumentBlock[];
    } catch (error) {
      this.wrapAndThrowError('获取文档块结构失败', error);
    }
  }

  // 创建代码块
  async createCodeBlock(documentId: string, parentBlockId: string, code: string, language: number = 0, wrap: boolean = false, index: number = 0): Promise<any> {
    try {
      // 确保语言参数不为0，默认使用1(PlainText)
      const safeLanguage = language === 0 ? 1 : language;

      Logger.log(`创建代码块，原始文档ID/URL: ${documentId}`);
      Logger.log(`语言: ${safeLanguage}，自动换行: ${wrap}，插入位置: ${index}`);

      const blockContent = createCodeBlockContent(code, safeLanguage, wrap);
      return await this.createDocumentBlock(documentId, parentBlockId, blockContent, index);
    } catch (error) {
      this.wrapAndThrowError('创建代码块失败', error);
    }
  }

  // 创建文本块
  async createTextBlock(documentId: string, parentBlockId: string, textContents: Array<{text: string, style?: any}>, align: number = 1, index: number = 0): Promise<any> {
    try {
      Logger.log(`创建文本块，原始文档ID/URL: ${documentId}`);
      Logger.log(`对齐方式: ${align}，插入位置: ${index}`);

      const blockContent = createTextBlockContent(textContents, align);
      return await this.createDocumentBlock(documentId, parentBlockId, blockContent, index);
    } catch (error) {
      this.wrapAndThrowError('创建文本块失败', error);
    }
  }

  // 创建文档块
  async createDocumentBlock(documentId: string, parentBlockId: string, blockContent: any, index: number = 0): Promise<any> {
    try {
      Logger.log(`创建文档块，原始文档ID/URL: ${documentId}`);

      // 使用工具函数提取文档ID
      const extractedDocId = normalizeDocumentId(documentId);
      Logger.log(`提取的文档ID: ${extractedDocId}，父块ID: ${parentBlockId}，插入位置: ${index}`);

      const endpoint = `/docx/v1/documents/${extractedDocId}/blocks/${parentBlockId}/children`;
      const params = `?document_revision_id=-1`;
      
      const data = {
        children: [blockContent],
        index: index
      };

      const response = await this.request<any>(endpoint + params, 'POST', data);
      
      if (!response || !response.data) {
        this.wrapAndThrowError('创建文档块失败，无效的响应', response);
      }
      
      Logger.log('文档块创建成功');
      return response.data;
    } catch (error) {
      this.wrapAndThrowError('创建文档块失败', error);
    }
  }

  // 创建标题块
  async createHeadingBlock(documentId: string, parentBlockId: string, text: string, level: number = 1, index: number = 0, align: number = 1): Promise<any> {
    try {
      Logger.log(`创建标题块，原始文档ID/URL: ${documentId}`);
      Logger.log(`标题级别: ${level}，对齐方式: ${align}，插入位置: ${index}`);

      const blockContent = createHeadingBlockContent(text, level, align);
      return await this.createDocumentBlock(documentId, parentBlockId, blockContent, index);
    } catch (error) {
      this.wrapAndThrowError('创建标题块失败', error);
    }
  }

  // 创建列表块
  async createListBlock(documentId: string, parentBlockId: string, text: string, isOrdered: boolean = false, index: number = 0, align: number = 1): Promise<any> {
    try {
      Logger.log(`创建列表块，原始文档ID/URL: ${documentId}`);
      Logger.log(`有序列表: ${isOrdered}，对齐方式: ${align}，插入位置: ${index}`);

      const blockContent = createListBlockContent(text, isOrdered, align);
      return await this.createDocumentBlock(documentId, parentBlockId, blockContent, index);
    } catch (error) {
      this.wrapAndThrowError('创建列表块失败', error);
    }
  }

  // 批量创建文档块
  async createDocumentBlocks(documentId: string, parentBlockId: string, blockContents: any[], index: number = 0): Promise<any> {
    try {
      Logger.log(`批量创建文档块，原始文档ID/URL: ${documentId}`);
      
      // 使用工具函数提取文档ID
      const extractedDocId = normalizeDocumentId(documentId);
      Logger.log(`提取的文档ID: ${extractedDocId}，父块ID: ${parentBlockId}，块数量: ${blockContents.length}，插入位置: ${index}`);
      
      // 飞书API没有批量创建的单独接口，使用常规块创建接口
      const endpoint = `/docx/v1/documents/${extractedDocId}/blocks/${parentBlockId}/children`;
      const params = `?document_revision_id=-1`;
      
      const data = {
        children: blockContents,
        index: index
      };
      
      const response = await this.request<any>(endpoint + params, 'POST', data);
      
      if (!response || !response.data) {
        this.wrapAndThrowError('批量创建文档块失败，无效的响应', response);
      }
      
      Logger.log(`批量创建文档块成功，创建了${blockContents.length}个块`);
      return response.data;
    } catch (error) {
      this.wrapAndThrowError('批量创建文档块失败', error);
    }
  }

  // 获取块内容
  async getBlockContent(documentId: string, blockId: string): Promise<any> {
    try {
      Logger.log(`获取块内容，原始文档ID/URL: ${documentId}`);
      
      // 使用工具函数提取文档ID
      const extractedDocId = normalizeDocumentId(documentId);
      Logger.log(`提取的文档ID: ${extractedDocId}，块ID: ${blockId}`);
      
      const endpoint = `/docx/v1/documents/${extractedDocId}/blocks/${blockId}`;
      const params = `?document_revision_id=-1`;
      
      const response = await this.request<any>(endpoint + params);
      
      if (!response || !response.data) {
        this.wrapAndThrowError('获取块内容失败，无效的响应', response);
      }
      
      Logger.log('块内容获取成功');
      return response.data;
    } catch (error) {
      this.wrapAndThrowError('获取块内容失败', error);
    }
  }

  // 更新块文本内容
  async updateBlockTextContent(documentId: string, blockId: string, textElements: Array<{text: string, style?: any}>): Promise<any> {
    try {
      const docId = normalizeDocumentId(documentId);
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
      
      Logger.log(`块文本内容更新成功: ${JSON.stringify(response.data, null, 2)}`);

      return response.data;
    } catch (error) {
      this.wrapAndThrowError(`更新块文本内容失败`, error);
    }
  }

  // 获取Wiki节点信息并提取文档ID
  async getWikiNodeInfo(wikiToken: string): Promise<any> {
    try {
      Logger.log(`获取Wiki节点信息，原始Wiki Token/URL: ${wikiToken}`);
      
      // 使用工具函数提取Wiki Token
      const extractedToken = normalizeWikiToken(wikiToken);
      Logger.log(`提取的Wiki Token: ${extractedToken}`);
      
      const endpoint = `/wiki/v2/spaces/get_node?token=${extractedToken}`;
      const response = await this.request<any>(endpoint);
      
      if (!response || !response.data) {
        this.wrapAndThrowError('获取Wiki节点信息失败，无效的响应', response);
      }
      
      Logger.log('Wiki节点信息获取成功');
      return response.data;
    } catch (error) {
      this.wrapAndThrowError('获取Wiki节点信息失败', error);
    }
  }
}