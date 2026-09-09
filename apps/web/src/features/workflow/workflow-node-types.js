import { InputNode, MiningNode, TitleGeneratorNode } from './components/nodes/legacy-nodes.jsx';
import { ProductionNode } from './components/nodes/production-node.jsx';

export const nodeTypes = {
  'keyword-input': InputNode,
  input: ProductionNode,
  'keyword-mining': MiningNode,
  'title-generator': TitleGeneratorNode,
  start: ProductionNode,
  task: ProductionNode,
  agent: ProductionNode,
  tool: ProductionNode,
  review: ProductionNode,
  decision: ProductionNode,
  output: ProductionNode,
  end: ProductionNode
};
