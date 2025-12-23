/**
 * Agents Service
 * Handles agent discovery using agent0-sdk
 */

import { SDK } from "agent0-sdk";
import { logger } from "../shared/logger.js";

const AGENT0_CHAIN_ID = parseInt(process.env.AGENT0_CHAIN_ID || "84532", 10);
const AGENT0_RPC_URL = process.env.AGENT0_RPC_URL || "https://sepolia.infura.io/v3/YOUR_PROJECT_ID";

let sdkInstance: SDK | null = null;

function getSDK(): SDK {
  if (sdkInstance === null) {
    logger.debug("Initializing agent0-sdk", { chainId: AGENT0_CHAIN_ID });
    sdkInstance = new SDK({
      chainId: AGENT0_CHAIN_ID,
      rpcUrl: AGENT0_RPC_URL,
    });
  }
  return sdkInstance;
}

export interface AgentSummary {
  chainId: number;
  agentId: string;
  name: string;
  description?: string;
  image?: string;
  active: boolean;
  owners: string[];
  operators: string[];
  walletAddress?: string;
  mcpTools?: string[];
  a2aSkills?: string[];
}

export interface SearchAgentsParams {
  name?: string;
  mcp?: boolean;
  a2a?: boolean;
  mcpTools?: string[];
  a2aSkills?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  supportedTrust?: string[];
  x402support?: boolean;
  active?: boolean;
  ens?: string;
  chains?: number[] | "all";
  pageSize?: number;
  cursor?: string;
  sort?: string[];
}

export interface SearchAgentsResult {
  items: AgentSummary[];
  nextCursor?: string;
  meta?: {
    chains: number[];
    successfulChains: number[];
    failedChains: number[];
    totalResults: number;
    timing: {
      totalMs: number;
      averagePerChainMs?: number;
    };
  };
}

/**
 * Search for agents that support x402 payments
 * Includes promotion merging - promoted agents appear first
 */
export async function searchAgents(
  params: SearchAgentsParams = {},
  sessionIdHash?: string // For tracking impressions
): Promise<SearchAgentsResult> {
  const sdk = getSDK();
  
  // Always filter by x402 support if not explicitly set
  const searchParams: SearchAgentsParams = {
    ...params,
    x402support: params.x402support !== undefined ? params.x402support : true,
  };

  logger.debug("Searching agents", searchParams as any);

  try {
    const result = await sdk.searchAgents(searchParams as any);
    
    // Fetch active promotions for agents
    const { getActivePromotions } = await import('../promotions/service.js');
    const { trackPromotedImpression } = await import('../analytics/service.js');
    
    const activePromotions = await getActivePromotions({
      resourceType: 'agent',
      keyword: params.name,
    });

    // Create a map of promoted agent IDs
    const promotedAgentMap = new Map<string, string>(); // agent_id -> promotion_id
    for (const promotion of activePromotions) {
      if (promotion.agent_id) {
        promotedAgentMap.set(promotion.agent_id.toLowerCase(), promotion.id);
      }
    }

    // Track impressions for promoted agents (if sessionIdHash provided)
    if (sessionIdHash) {
      for (const promotion of activePromotions) {
        if (promotion.agent_id) {
          trackPromotedImpression({
            promotion_id: promotion.id,
            search_keyword: params.name || undefined,
            session_id_hash: sessionIdHash,
          }).catch((err) => {
            logger.error('Failed to track agent promotion impression', err as Error);
          });
        }
      }
    }

    // Separate promoted and organic agents
    const promoted: AgentSummary[] = [];
    const organic: AgentSummary[] = [];
    const promotedAgentIds = new Set<string>();

    for (const agent of result.items) {
      const agentIdLower = agent.agentId.toLowerCase();
      if (promotedAgentMap.has(agentIdLower)) {
        promoted.push(agent);
        promotedAgentIds.add(agentIdLower);
      } else {
        organic.push(agent);
      }
    }

    // Merge: promoted first, then organic (excluding duplicates)
    const organicFiltered = organic.filter(
      (a) => !promotedAgentIds.has(a.agentId.toLowerCase())
    );
    const mergedItems = [...promoted, ...organicFiltered];
    
    logger.debug("Found agents", { 
      count: mergedItems.length,
      promoted: promoted.length,
      hasNextCursor: !!result.nextCursor 
    });

    return {
      ...result,
      items: mergedItems,
    };
  } catch (error) {
    logger.error("Failed to search agents", error as Error, searchParams as any);
    throw new Error(`Failed to search agents: ${(error as Error).message}`);
  }
}

/**
 * Get a specific agent by ID
 */
export async function getAgent(agentId: string): Promise<AgentSummary> {
  const sdk = getSDK();
  
  logger.debug("Getting agent", { agentId });

  try {
    const agent = await sdk.getAgent(agentId);
    
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    logger.debug("Got agent", { agentId, name: agent.name });
    
    return agent;
  } catch (error) {
    logger.error("Failed to get agent", error as Error, { agentId });
    throw new Error(`Failed to get agent ${agentId}: ${(error as Error).message}`);
  }
}

export interface SearchAgentsByReputationParams {
  agents?: string[];
  tags?: string[];
  reviewers?: string[];
  capabilities?: string[];
  skills?: string[];
  tasks?: string[];
  names?: string[];
  minAverageScore?: number;
  includeRevoked?: boolean;
  pageSize?: number;
  cursor?: string;
  sort?: string[];
  chains?: number[] | "all";
}

/**
 * Search for agents by reputation/rating
 */
export async function searchAgentsByReputation(
  params: SearchAgentsByReputationParams = {}
): Promise<SearchAgentsResult> {
  const sdk = getSDK();
  
  logger.debug("Searching agents by reputation", params as any);

  try {
    const result = await sdk.searchAgentsByReputation(
      params.agents,
      params.tags,
      params.reviewers,
      params.capabilities,
      params.skills,
      params.tasks,
      params.names,
      params.minAverageScore,
      params.includeRevoked,
      params.pageSize,
      params.cursor,
      params.sort,
      params.chains
    );
    
    logger.debug("Found agents by reputation", { 
      count: result.items.length,
      hasNextCursor: !!result.nextCursor 
    });

    return result;
  } catch (error) {
    logger.error("Failed to search agents by reputation", error as Error, params as any);
    throw new Error(`Failed to search agents by reputation: ${(error as Error).message}`);
  }
}

