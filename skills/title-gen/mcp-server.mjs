import { createServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  run, 
  batchRun, 
  suggestKeywords, 
  suggestAndVerify 
} from './index.js';

const server = createServer({
  name: 'ecom-ai-tools-title-gen',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

// 工具：生成标题（需要外部商品数据）
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'generate_title',
      description: '根据蓝海词和外部商品数据生成铺货标题',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '蓝海词（用户输入）'
          },
          products: {
            type: 'array',
            description: '商品数据数组（必须从外部来源获取）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                price: { type: 'string' },
                url: { type: 'string' },
                stats: { type: 'object' }
              }
            }
          },
          maxLength: {
            type: 'number',
            description: '标题最大长度',
            default: 60
          },
          peerTitles: {
            type: 'array',
            description: '同行标题（可选）',
            items: { type: 'string' }
          }
        },
        required: ['keyword', 'products']
      }
    },
    {
      name: 'batch_generate_titles',
      description: '批量生成标题（多个关键词）',
      inputSchema: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            description: '关键词列表',
            items: { type: 'string' }
          },
          maxLength: {
            type: 'number',
            description: '标题最大长度',
            default: 60
          },
          limit: {
            type: 'number',
            description: '每个关键词处理的商品数量上限',
            default: 0
          }
        },
        required: ['keywords']
      }
    },
    {
      name: 'suggest_keywords',
      description: '根据策略推荐关键词',
      inputSchema: {
        type: 'object',
        properties: {
          strategy: {
            type: 'string',
            description: '推荐策略（crowd, scene, season, holiday, trend, etc.）',
            enum: ['crowd', 'scene', 'season', 'holiday', 'trend', 'niche', 'emotion', 'price', 'problem', 'industry', 'gift', 'cross', 'guochao']
          },
          input: {
            type: 'string',
            description: '用户输入（某些策略可为空）'
          },
          maxCandidates: {
            type: 'number',
            description: '最大候选词数量',
            default: 5
          },
          fetchHotData: {
            type: 'string',
            description: '（内部使用）趋势数据获取回调，由调用方注入'
          },
          verifyFn: {
            type: 'string',
            description: '（内部使用）SYCM验证回调，由调用方注入'
          }
        },
        required: ['strategy']
      }
    }
  ]
}));

// 处理工具调用
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    switch (name) {
      case 'generate_title': {
        const { keyword, products, maxLength = 60, peerTitles = [] } = args;
        const result = await run(keyword, { 
          products, 
          maxLength, 
          peerTitles,
          silent: true 
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'batch_generate_titles': {
        const { keywords, maxLength = 60, limit = 0 } = args;
        const result = await batchRun(keywords, { 
          maxLength, 
          limit,
          silent: true 
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      case 'suggest_keywords': {
        const { strategy, input = '', maxCandidates = 5 } = args;
        const result = await suggestKeywords({ 
          strategy, 
          input, 
          maxCandidates 
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
      
      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ 
        type: 'text', 
        text: `错误: ${error.message}` 
      }],
      isError: true
    };
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ecom-ai-tools 标题生成技能 MCP 服务器已启动');
}

main().catch(error => {
  console.error('服务器启动失败:', error);
  process.exit(1);
});