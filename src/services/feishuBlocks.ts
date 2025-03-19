
// 定义块类型接口
export interface FeishuBlock {
  block_type: number;
  [key: string]: any;
}

// 定义文本样式接口
export interface TextElementStyle {
  bold?: boolean;        // 是否加粗
  italic?: boolean;      // 是否斜体
  underline?: boolean;   // 是否下划线
  strikethrough?: boolean; // 是否删除线
  inline_code?: boolean; // 是否行内代码
  text_color?: number;   // 文本颜色
}

// 定义文本内容接口
export interface TextContent {
  text: string;          // 文本内容
  style?: TextElementStyle; // 文本样式
}

// 定义文本块接口
export interface TextBlock extends FeishuBlock {
  block_type: 2;         // 文本块类型固定为2
  text: {
    elements: Array<{
      text_run: {
        content: string;
        text_element_style: TextElementStyle;
      }
    }>;
    style: {
      align: number;      // 对齐方式：1左对齐，2居中，3右对齐
    }
  };
}

// 定义代码块接口
export interface CodeBlock extends FeishuBlock {
  block_type: 14;        // 代码块类型固定为14
  code: {
    elements: Array<{
      text_run: {
        content: string;
        text_element_style: TextElementStyle;
      }
    }>;
    style: {
      language: number;   // 语言类型代码
      wrap: boolean;      // 是否自动换行
    }
  };
}

// 定义标题块接口
export interface HeadingBlock extends FeishuBlock {
  block_type: number;    // 标题块类型：3-11（对应标题级别1-9）
  [headingKey: string]: any; // 动态属性名，如heading1, heading2等
}

// 定义批量创建块的请求数据接口
export interface CreateBlocksRequest {
  children: FeishuBlock[];
  index: number;
}

/**
 * 构建批量创建块的请求数据
 * @param blocks 块内容数组
 * @param index 插入位置索引
 * @returns 请求数据对象
 */
export function buildCreateBlocksRequest(blocks: FeishuBlock[], index: number = 0): CreateBlocksRequest {
  return {
    children: blocks,
    index
  };
}

/**
 * 创建文本块内容
 * @param text 文本内容
 * @param style 文本样式
 * @param align 对齐方式：1左对齐，2居中，3右对齐
 * @returns 文本块内容对象
 */
export function createTextBlockContent(textContents: Array<{text: string, style?: any}>, align: number = 1): FeishuBlock {
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

/**
 * 创建代码块内容
 * @param code 代码内容
 * @param language 语言类型代码
 * @param wrap 是否自动换行
 * @returns 代码块内容对象
 */
export function createCodeBlockContent(code: string, language: number = 0, wrap: boolean = false): FeishuBlock {
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
        language: language,
        wrap: wrap
      }
    }
  };
}

/**
 * 创建标题块内容
 * @param text 标题文本
 * @param level 标题级别（1-9）
 * @param align 对齐方式：1左对齐，2居中，3右对齐
 * @returns 标题块内容对象
 */
export function createHeadingBlockContent(text: string, level: number = 1, align: number = 1): FeishuBlock {
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
      align: align,
      folded: false
    }
  };

  return blockContent;
}

/**
 * 处理Markdown语法转换
 * @param textContents 文本内容数组
 * @returns 处理后的文本内容数组
 */
export function processMarkdownSyntax(textContents: Array<{text: string, style?: any}>): Array<{text: string, style: any}> {
  return textContents.map(content => {
    let { text, style = {} } = content;
    
    // 创建一个新的style对象，避免修改原始对象
    const newStyle = { ...style };
    
    // 处理粗体 **text**
    if (text.match(/\*\*([^*]+)\*\*/g)) {
      text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
      newStyle.bold = true;
    }
    
    // 处理斜体 *text*
    if (text.match(/(?<!\*)\*([^*]+)\*(?!\*)/g)) {
      text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");
      newStyle.italic = true;
    }
    
    // 处理删除线 ~~text~~
    if (text.match(/~~([^~]+)~~/g)) {
      text = text.replace(/~~([^~]+)~~/g, "$1");
      newStyle.strikethrough = true;
    }
    
    // 处理行内代码 `code`
    if (text.match(/`([^`]+)`/g)) {
      text = text.replace(/`([^`]+)`/g, "$1");
      newStyle.inline_code = true;
    }
    
    return { text, style: newStyle };
  });
}