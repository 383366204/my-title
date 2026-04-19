/**
 * 1688 API 响应结构验证脚本
 * 用于 Task 0: 验证1688 API真实响应结构
 */
require('dotenv').config();
const Alibaba1688Client = require('../src/alibaba1688-client');
const fs = require('fs');
const path = require('path');

async function main() {
  const ak = process.env.ALI_1688_AK;
  if (!ak) {
    console.error('❌ ALI_1688_AK not found in .env');
    process.exit(1);
  }

  console.log('🔍 初始化 1688 客户端...');
  const client = new Alibaba1688Client(ak);

  console.log('📡 调用 searchOffers("项链")...');
  try {
    const result = await client.searchOffers('项链');
    console.log('✅ API 调用成功');
    console.log('原始返回类型:', typeof result);
    console.log('是否为数组:', Array.isArray(result));
    console.log('元素数量:', result?.length);

    // 保存完整响应（不经过 Object.values 转换）
    // 由于 searchOffers 内部已经做了 Object.values(data)，我们需要重新获取原始数据
    // 重新构造一个调用来获取完整响应
    console.log('\n📋 重新获取完整响应结构...');

    const endpoint = '/1688claw/skill/searchoffer';
    const body = JSON.stringify({ query: '项链', channel: 'default' });
    const signHeaders = client.generateSignHeaders('POST', endpoint, body);
    const axios = require('axios');

    const url = `${client.baseUrl}${endpoint}`;
    const response = await axios.post(url, body, {
      headers: signHeaders,
      timeout: 10000
    });

    console.log('\n=== 完整 API 响应 (JSON) ===');
    const fullResponse = response.data;
    console.log(JSON.stringify(fullResponse, null, 2));

    // 保存到 evidence 目录
    const evidencePath = path.join(__dirname, '..', '.sisyphus', 'evidence', 'api-1688-response-sample.json');
    fs.writeFileSync(evidencePath, JSON.stringify(fullResponse, null, 2), 'utf-8');
    console.log(`\n💾 响应已保存到: ${evidencePath}`);

    // 分析结构
    console.log('\n=== 响应结构分析 ===');
    if (fullResponse.success !== undefined) {
      console.log('✓ success:', fullResponse.success);
    }
    if (fullResponse.model !== undefined) {
      console.log('✓ model 存在');
      if (fullResponse.model.data) {
        console.log('✓ model.data 存在，类型:', typeof fullResponse.model.data);
        if (typeof fullResponse.model.data === 'object') {
          console.log('✓ model.data 键:', Object.keys(fullResponse.model.data));
        }
      }
    }

    // 检查 products 数组结构
    if (fullResponse.model?.data?.products) {
      const products = fullResponse.model.data.products;
      console.log('\n=== products 数组结构 ===');
      console.log('products 数量:', products?.length);
      if (products && products.length > 0) {
        console.log('\n第一个商品的所有字段:');
        console.log(Object.keys(products[0]));
        console.log('\n第一个商品 sample:');
        console.log(JSON.stringify(products[0], null, 2));

        // 检查 stats 子对象
        if (products[0].stats) {
          console.log('\n=== stats 子对象 ===');
          console.log('stats 字段:', Object.keys(products[0].stats));
          console.log('stats sample:', JSON.stringify(products[0].stats, null, 2));
        }
      }
    } else {
      console.log('⚠ 未找到 products 数组，检查其他结构...');
      const data = fullResponse.model?.data;
      if (data) {
        if (Array.isArray(data)) {
          console.log('data 本身就是数组，长度:', data.length);
          if (data.length > 0) {
            console.log('第一个元素字段:', Object.keys(data[0]));
          }
        } else {
          console.log('data 是对象，键:', Object.keys(data));
        }
      }
    }

  } catch (err) {
    console.error('❌ API 调用失败:', err.message);
    if (err.response) {
      console.error('响应状态:', err.response.status);
      console.error('响应数据:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();