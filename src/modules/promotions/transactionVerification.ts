/**
 * Transaction verification for promotion payments
 * Verifies that payment transactions are valid, confirmed, and match expected amounts
 */

import { createPublicClient, http, decodeFunctionData, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { defineChain } from 'viem';
import { logger } from '../shared/logger.js';
import { config } from '../../config.js';
import { getSupabaseClient } from '../shared/supabase.js';

// Default USDC contract address on Base
const DEFAULT_USDC_ADDRESS: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

// ERC20 transfer function signature: transfer(address,uint256)
const ERC20_TRANSFER_SIGNATURE = '0xa9059cbb';

// ERC20 transfer function ABI for decoding
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },
] as const;

// ERC-3009 transferWithAuthorization function ABI for decoding
const ERC20_TRANSFER_WITH_AUTH_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
  },
] as const;

/**
 * Get chain configuration from chain ID
 */
function getChain(chainId: number) {
  if (chainId === 8453) {
    return base;
  }
  
  // Support for other common chains
  switch (chainId) {
    case 1: // Ethereum Mainnet
      return defineChain({
        id: 1,
        name: 'Ethereum',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: {
          default: { http: ['https://eth.llamarpc.com'] },
        },
      });
    case 84532: // Base Sepolia
      return defineChain({
        id: 84532,
        name: 'Base Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: {
          default: { http: ['https://sepolia.base.org'] },
        },
      });
    default:
      logger.warning(`Unknown chain ID ${chainId}, using Base as fallback`);
      return base;
  }
}

/**
 * Get RPC URL for a chain
 */
function getRpcUrl(chainId: number): string {
  const chainIdEnv = `CHAIN_${chainId}_RPC_URL`;
  const rpcUrl = process.env[chainIdEnv];
  
  if (rpcUrl) {
    return rpcUrl;
  }
  
  // Default RPC URLs
  switch (chainId) {
    case 8453: // Base
      return process.env.ALCHEMY_BASE_RPC || process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    case 1: // Ethereum
      return process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
    case 84532: // Base Sepolia
      return 'https://sepolia.base.org';
    default:
      throw new Error(`No RPC URL configured for chain ID ${chainId}`);
  }
}

/**
 * Check if a transaction hash has already been used for a promotion
 */
async function isTransactionAlreadyUsed(txHash: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('oops402_promotions')
      .select('id')
      .eq('payment_tx_hash', txHash)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine
      logger.error('Failed to check transaction usage', error as Error);
      throw error;
    }

    return !!data;
  } catch (error) {
    logger.error('Error checking transaction usage', error as Error);
    // If we can't check, err on the side of caution and reject
    throw error;
  }
}

/**
 * Verify a promotion payment transaction
 */
export async function verifyPromotionPayment(
  txHash: string,
  expectedAmount: string, // Amount in smallest USDC units (as string)
  expectedFrom: string, // Wallet address that should have sent the payment
  expectedRecipient?: string // Optional: Wallet address that should receive the payment
): Promise<{
  valid: boolean;
  error?: string;
  transaction?: {
    hash: string;
    from: string;
    to: string;
    value: bigint;
    status: number;
    blockNumber: bigint;
  };
}> {
  try {
    // Check if transaction has already been used
    const alreadyUsed = await isTransactionAlreadyUsed(txHash);
    if (alreadyUsed) {
      return {
        valid: false,
        error: 'This transaction has already been used for another promotion',
      };
    }

    const chainId = config.promotion.chainId || 8453;
    const chain = getChain(chainId);
    const rpcUrl = getRpcUrl(chainId);
    
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    // Get transaction receipt to check confirmation
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
    
    if (!receipt) {
      return {
        valid: false,
        error: 'Transaction not found or not yet confirmed',
      };
    }

    // Check transaction status (1 = success, 0 = reverted)
    if (receipt.status !== 'success') {
      return {
        valid: false,
        error: 'Transaction failed or was reverted',
      };
    }

    // Get transaction details
    const transaction = await publicClient.getTransaction({ hash: txHash as Hex });
    
    const expectedAmountBigInt = BigInt(expectedAmount);
    let transactionAmount: bigint = 0n;
    let recipientAddress: Address | null = null;
    let actualSender: Address | null = null; // Actual sender (from transfer or transferWithAuthorization)

    // Check if this is an ERC20 transfer (has input data)
    if (transaction.input && transaction.input !== '0x') {
      try {
        // First, try to decode as transferWithAuthorization (ERC-3009) - used by relayer
        try {
          const decodedAuth = decodeFunctionData({
            abi: ERC20_TRANSFER_WITH_AUTH_ABI,
            data: transaction.input,
          });

          if (decodedAuth.functionName === 'transferWithAuthorization' && decodedAuth.args && decodedAuth.args.length >= 3) {
            // This is a transferWithAuthorization call
            // First arg is 'from' (the actual sender), second is 'to', third is 'value'
            actualSender = decodedAuth.args[0] as Address;
            recipientAddress = decodedAuth.args[1] as Address;
            transactionAmount = decodedAuth.args[2] as bigint;

            logger.debug('Decoded transferWithAuthorization', {
              txHash,
              from: actualSender,
              to: recipientAddress,
              amount: transactionAmount.toString(),
              txFrom: transaction.from, // Relayer address
            });
          }
        } catch (authError) {
          // Not transferWithAuthorization, try regular transfer
          const decoded = decodeFunctionData({
            abi: ERC20_TRANSFER_ABI,
            data: transaction.input,
          });

          if (decoded.functionName === 'transfer' && decoded.args && decoded.args.length >= 2) {
            // This is a regular ERC20 transfer
            actualSender = transaction.from; // For regular transfers, transaction.from is the sender
            transactionAmount = decoded.args[1] as bigint;
            recipientAddress = decoded.args[0] as Address;

            logger.debug('Decoded regular transfer', {
              txHash,
              from: actualSender,
              to: recipientAddress,
              amount: transactionAmount.toString(),
            });
          }
        }
      } catch (error) {
        // Not an ERC20 transfer we can decode, or decoding failed
        logger.debug('Could not decode transaction as ERC20 transfer', {
          txHash,
          error: (error as Error).message,
        });
      }
    }

    // Verify actual sender matches expected wallet (for transferWithAuthorization, this is the 'from' param)
    if (actualSender) {
      if (actualSender.toLowerCase() !== expectedFrom.toLowerCase()) {
        return {
          valid: false,
          error: `Transaction sender mismatch. Expected ${expectedFrom}, got ${actualSender} (transaction from: ${transaction.from})`,
        };
      }
    } else {
      // If we couldn't decode, fall back to checking transaction.from (for regular transfers)
      if (transaction.from.toLowerCase() !== expectedFrom.toLowerCase()) {
        return {
          valid: false,
          error: `Transaction sender mismatch. Expected ${expectedFrom}, got ${transaction.from}`,
        };
      }
    }

    // Verify the transfer is to the expected recipient if specified
    if (recipientAddress && expectedRecipient) {
      if (recipientAddress.toLowerCase() !== expectedRecipient.toLowerCase()) {
        return {
          valid: false,
          error: `ERC20 transfer recipient mismatch. Expected ${expectedRecipient}, got ${recipientAddress}`,
        };
      }
    }

    // Verify the contract address matches USDC (or expected recipient if it's a contract)
    if (transaction.to && transaction.to.toLowerCase() !== DEFAULT_USDC_ADDRESS.toLowerCase()) {
      // If recipient is specified and matches, that's okay (could be a custom token)
      if (!expectedRecipient || transaction.to.toLowerCase() !== expectedRecipient.toLowerCase()) {
        logger.warning('ERC20 transfer to unexpected contract address', {
          txHash,
          contract: transaction.to,
          expectedUSDC: DEFAULT_USDC_ADDRESS,
        });
      }
    }

    // If we didn't find an ERC20 transfer, check for native transfer
    if (transactionAmount === 0n && transaction.value > 0n) {
      transactionAmount = transaction.value;
      recipientAddress = transaction.to as Address;

      // If recipient is specified, verify it matches
      if (expectedRecipient && recipientAddress) {
        if (recipientAddress.toLowerCase() !== expectedRecipient.toLowerCase()) {
          return {
            valid: false,
            error: `Native transfer recipient mismatch. Expected ${expectedRecipient}, got ${recipientAddress}`,
          };
        }
      }
    }

    // Verify transaction amount matches expected amount
    if (transactionAmount === 0n) {
      return {
        valid: false,
        error: 'Transaction has no transfer value (neither native nor ERC20 transfer detected)',
      };
    }

    // Allow small tolerance for rounding (0.1%)
    const tolerance = expectedAmountBigInt / 1000n;
    const diff = transactionAmount > expectedAmountBigInt 
      ? transactionAmount - expectedAmountBigInt 
      : expectedAmountBigInt - transactionAmount;
    
    if (diff > tolerance) {
      return {
        valid: false,
        error: `Transaction amount mismatch. Expected ${expectedAmount}, got ${transactionAmount.toString()}`,
      };
    }

    return {
      valid: true,
      transaction: {
        hash: txHash,
        from: transaction.from,
        to: transaction.to || '',
        value: transaction.value,
        status: receipt.status === 'success' ? 1 : 0,
        blockNumber: receipt.blockNumber,
      },
    };
  } catch (error) {
    logger.error('Failed to verify promotion payment transaction', error as Error, {
      txHash,
      expectedAmount,
      expectedFrom,
    });
    return {
      valid: false,
      error: `Failed to verify transaction: ${(error as Error).message}`,
    };
  }
}

