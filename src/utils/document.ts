/**
 * 从URL或ID中提取飞书文档ID
 * 支持多种格式:
 * 1. 标准文档URL: https://xxx.feishu.cn/docs/xxx 或 https://xxx.feishu.cn/docx/xxx
 * 2. API URL: https://open.feishu.cn/open-apis/docx/v1/documents/xxx
 * 3. 直接ID: JcKbdlokYoPIe0xDzJ1cduRXnRf
 * 
 * @param input 文档URL或ID
 * @returns 提取的文档ID或null
 */
export function extractDocumentId(input: string): string | null {
  // 移除首尾空白
  input = input.trim();
  
  // 处理各种URL格式
  const docxMatch = input.match(/\/docx\/([a-zA-Z0-9_-]+)/i);
  const docsMatch = input.match(/\/docs\/([a-zA-Z0-9_-]+)/i);
  const apiMatch = input.match(/\/documents\/([a-zA-Z0-9_-]+)/i);
  const directIdMatch = input.match(/^([a-zA-Z0-9_-]{10,})$/); // 假设ID至少10个字符

  // 按优先级返回匹配结果
  const match = docxMatch || docsMatch || apiMatch || directIdMatch;
  return match ? match[1] : null;
}

/**
 * 从URL或Token中提取Wiki节点ID
 * 支持多种格式:
 * 1. Wiki URL: https://xxx.feishu.cn/wiki/xxx
 * 2. 直接Token: xxx
 * 
 * @param input Wiki URL或Token
 * @returns 提取的Wiki Token或null
 */
export function extractWikiToken(input: string): string | null {
  // 移除首尾空白
  input = input.trim();

  // 处理Wiki URL格式
  const wikiMatch = input.match(/\/wiki\/([a-zA-Z0-9_-]+)/i);
  const directMatch = input.match(/^([a-zA-Z0-9_-]{10,})$/); // 假设Token至少10个字符

  // 提取Token，如果存在查询参数，去掉它们
  let token = wikiMatch ? wikiMatch[1] : (directMatch ? directMatch[1] : null);
  if (token && token.includes('?')) {
    token = token.split('?')[0];
  }

  return token;
}

/**
 * 规范化文档ID
 * 提取输入中的文档ID，如果提取失败则返回原输入
 * 
 * @param input 文档URL或ID
 * @returns 规范化的文档ID
 * @throws 如果无法提取有效ID则抛出错误
 */
export function normalizeDocumentId(input: string): string {
  const id = extractDocumentId(input);
  if (!id) {
    throw new Error(`无法从 "${input}" 提取有效的文档ID`);
  }
  return id;
}

/**
 * 规范化Wiki Token
 * 提取输入中的Wiki Token，如果提取失败则返回原输入
 * 
 * @param input Wiki URL或Token
 * @returns 规范化的Wiki Token
 * @throws 如果无法提取有效Token则抛出错误
 */
export function normalizeWikiToken(input: string): string {
  const token = extractWikiToken(input);
  if (!token) {
    throw new Error(`无法从 "${input}" 提取有效的Wiki Token`);
  }
  return token;
} 