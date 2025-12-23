/**
 * Relayer Service
 * Pays gas for transactions signed by PKP wallets
 * Much simpler than Account Abstraction - just sign and relay
 */

import { ethers } from "ethers";
import { PKPEthersWallet } from "@lit-protocol/pkp-ethers";
import { logger } from "../shared/logger.js";
import type { Address, Hex } from "viem";

export interface RelayerConfig {
  pkpPublicKey: string;
  pkpAddress: Address;
  sessionSigs: any; // PKPSessionSigs
  chainId: number;
  rpcUrl: string;
}

/**
 * Send a transaction via relayer
 * 1. PKP wallet signs the transaction
 * 2. Relayer wallet (using LIT_PRIVATE_KEY) submits it and pays gas
 * 3. Transaction executes from PKP wallet address
 */
export async function sendTransactionViaRelayer(
  config: RelayerConfig,
  to: Address,
  value: bigint,
  data: Hex
): Promise<Hex> {
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  
  // Get LIT_PRIVATE_KEY from environment
  const LIT_PRIVATE_KEY = process.env.LIT_PRIVATE_KEY;
  if (!LIT_PRIVATE_KEY) {
    throw new Error("LIT_PRIVATE_KEY environment variable is required for relayer");
  }

  // Create PKP wallet to sign the transaction
  const { getLitNodeClient } = await import("./litService.js");
  const litNodeClient = await getLitNodeClient();
  
  const pkpEthersWallet = new PKPEthersWallet({
    litNodeClient,
    pkpPubKey: config.pkpPublicKey,
    controllerSessionSigs: config.sessionSigs,
  });
  pkpEthersWallet.provider = provider;

  // Get current gas price and nonce
  const [gasPrice, nonce] = await Promise.all([
    provider.getGasPrice(),
    provider.getTransactionCount(config.pkpAddress),
  ]);

  // Estimate gas
  let gasLimit: ethers.BigNumber;
  try {
    const estimatedGas = await provider.estimateGas({
      from: config.pkpAddress,
      to,
      value,
      data,
    });
    // Add 20% buffer
    gasLimit = estimatedGas.mul(120).div(100);
  } catch (error) {
    // If estimation fails, use a safe default
    logger.warning("Gas estimation failed, using default", { error: String(error) });
    gasLimit = ethers.BigNumber.from(100000);
  }

  // Create the transaction
  const tx: ethers.providers.TransactionRequest = {
    to,
    value,
    data,
    gasPrice,
    gasLimit,
    nonce,
    chainId: config.chainId,
  };

  logger.debug("Signing transaction with PKP wallet", {
    from: config.pkpAddress,
    to,
    value: value.toString(),
    gasLimit: gasLimit.toString(),
    nonce,
  });

  // Sign with PKP wallet
  const signedTx = await pkpEthersWallet.signTransaction(tx);

  logger.debug("Transaction signed, relaying...", {
    signedTxLength: signedTx.length,
  });

  // Create relayer wallet (this wallet pays for gas)
  const relayerPrivateKey = LIT_PRIVATE_KEY.startsWith("0x") 
    ? LIT_PRIVATE_KEY 
    : `0x${LIT_PRIVATE_KEY}`;
  const relayerWallet = new ethers.Wallet(relayerPrivateKey, provider);

  logger.debug("Relayer wallet created", {
    relayerAddress: relayerWallet.address,
    pkpAddress: config.pkpAddress,
  });

  // Submit the signed transaction using relayer wallet
  // Note: The transaction is already signed by PKP wallet, so it will execute
  // from the PKP address, but the relayer pays the gas
  const txResponse = await provider.sendTransaction(signedTx);

  logger.debug("Transaction relayed", {
    txHash: txResponse.hash,
    from: config.pkpAddress, // Transaction is from PKP wallet
    relayer: relayerWallet.address, // But relayer pays gas
  });

  // Wait for confirmation
  const receipt = await txResponse.wait();

  if (receipt.status !== 1) {
    throw new Error(`Transaction reverted: ${receipt.transactionHash}`);
  }

  logger.debug("Transaction confirmed", {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  });

  return receipt.transactionHash as Hex;
}

/**
 * Send ERC20 transfer via relayer using transferWithAuthorization (ERC-3009)
 * This allows the relayer to pay gas while PKP wallet just signs authorization
 * 
 * Flow:
 * 1. PKP wallet signs an authorization (EIP-712 typed data)
 * 2. Relayer wallet calls transferWithAuthorization and pays gas
 * 3. Transaction executes from PKP wallet address
 */
export async function sendERC20TransferViaRelayer(
  config: RelayerConfig,
  tokenAddress: Address,
  to: Address,
  amount: bigint
): Promise<Hex> {
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  
  // Get LIT_PRIVATE_KEY for relayer
  const LIT_PRIVATE_KEY = process.env.LIT_PRIVATE_KEY;
  if (!LIT_PRIVATE_KEY) {
    throw new Error("LIT_PRIVATE_KEY environment variable is required for relayer");
  }

  // Create PKP wallet to sign the authorization
  const { getLitNodeClient } = await import("./litService.js");
  const litNodeClient = await getLitNodeClient();
  
  const pkpEthersWallet = new PKPEthersWallet({
    litNodeClient,
    pkpPubKey: config.pkpPublicKey,
    controllerSessionSigs: config.sessionSigs,
  });
  pkpEthersWallet.provider = provider;

  // USDC ABI for transferWithAuthorization
  const USDC_ABI = [
    {
      inputs: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "signature", type: "bytes" },
      ],
      name: "transferWithAuthorization",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ];

  const contract = new ethers.Contract(tokenAddress, USDC_ABI, provider);

  // Check PKP wallet balance before attempting transfer
  try {
    const balance = await contract.balanceOf(config.pkpAddress);
    logger.debug("PKP wallet balance check", {
      pkpAddress: config.pkpAddress,
      balance: balance.toString(),
      amount: amount.toString(),
      tokenAddress,
    });
    if (balance.lt(amount)) {
      throw new Error(
        `Insufficient USDC balance. PKP wallet ${config.pkpAddress} has ${ethers.utils.formatUnits(balance, 6)} USDC, but ${ethers.utils.formatUnits(amount, 6)} USDC is required.`
      );
    }
  } catch (error) {
    if ((error as Error).message.includes('Insufficient USDC balance')) {
      throw error;
    }
    logger.warning("Failed to check PKP wallet balance, proceeding anyway", {
      error: (error as Error).message,
    });
  }

  // Generate nonce for authorization
  // IMPORTANT: ERC-3009 uses bytes32 nonces, NOT sequential uint256 nonces
  // USDC does NOT implement the nonces() function (that's ERC-2612/permit)
  // 
  // For ERC-3009, we must generate a unique bytes32 nonce for each transaction.
  // The contract tracks used nonces in _authorizationStates[authorizer][nonce]
  // to prevent replay attacks. Each nonce can only be used once per authorizer.
  // 
  // We generate a random 32-byte nonce. If it collides (extremely unlikely),
  // the transaction will revert and we can retry with a new random nonce.
  const nonceBytes32 = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  
  logger.debug("Generated random nonce for authorization", {
    pkpAddress: config.pkpAddress,
    tokenAddress,
    nonceHex: nonceBytes32,
    authorizer: config.pkpAddress,
    note: "ERC-3009 uses random bytes32 nonces, not sequential nonces. Contract will reject if nonce was already used.",
  });

  // Set validity window (same as testDirectTransferWithAuthorization)
  const now = Math.floor(Date.now() / 1000);
  const validAfter = 0; // Valid immediately
  const validBefore = now + 20 * 60; // 20 minutes

  logger.debug("Creating ERC-3009 authorization", {
    from: config.pkpAddress,
    to,
    amount: amount.toString(),
    nonce: nonceBytes32,
    validAfter,
    validBefore,
  });

  // Create EIP-712 domain and message (same as testDirectTransferWithAuthorization)
  const domain = {
    name: "USD Coin",
    version: "2",
    chainId: config.chainId,
    verifyingContract: tokenAddress,
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  const message = {
    from: config.pkpAddress,
    to,
    value: amount.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce: nonceBytes32,
  };

  // Sign with PKP wallet (same approach as testDirectTransferWithAuthorization)
  logger.debug("Signing authorization with PKP wallet");
  
  // Use ethers' hash (same as EOA) - the contract accepts this
  const ethersHash = ethers.utils._TypedDataEncoder.hash(domain, types, message);
  
  // Sign the ethers hash directly using pkpSign (same as testDirectTransferWithAuthorization)
  const { pkpSign } = await import("./litService.js");
  const signature = await pkpSign(config.sessionSigs, config.pkpPublicKey, ethersHash as `0x${string}`);

  // Verify the signature recovers correctly
  const recovered = ethers.utils.recoverAddress(ethersHash, signature);
  if (recovered.toLowerCase() !== config.pkpAddress.toLowerCase()) {
    throw new Error(`Signature does not recover from ethers hash! Expected ${config.pkpAddress}, got ${recovered}`);
  }

  // Parse signature and pack it (same format as testDirectTransferWithAuthorization)
  const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
  const r = `0x${sigHex.slice(0, 64)}`;
  let s = `0x${sigHex.slice(64, 128)}`;
  let v = parseInt(sigHex.slice(128, 130), 16);
  
  // Apply EIP-2 signature normalization (same as testDirectTransferWithAuthorization)
  const secp256k1n = ethers.BigNumber.from("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
  const secp256k1nHalf = ethers.BigNumber.from("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0");
  const sBN = ethers.BigNumber.from(s);
  
  if (sBN.gt(secp256k1nHalf)) {
    // Normalize: s' = secp256k1n - s, flip v
    s = ethers.utils.hexZeroPad(secp256k1n.sub(sBN).toHexString(), 32);
    v = v === 27 ? 28 : 27;
  }
  
  // Pack signature: r (32 bytes) + s (32 bytes) + v (1 byte)
  const rBytes = r.startsWith('0x') ? r.slice(2) : r;
  const sBytes = s.startsWith('0x') ? s.slice(2) : s;
  const rPadded = rBytes.padStart(64, '0');
  const sPadded = sBytes.padStart(64, '0');
  const vByte = v.toString(16).padStart(2, '0');
  const packedSignature = '0x' + rPadded + sPadded + vByte;

  logger.debug("Authorization signed, relayer will call transferWithAuthorization", {
    signatureLength: packedSignature.length,
  });

  // Create relayer wallet (pays gas)
  const relayerPrivateKey = LIT_PRIVATE_KEY.startsWith("0x") 
    ? LIT_PRIVATE_KEY 
    : `0x${LIT_PRIVATE_KEY}`;
  const relayerWallet = new ethers.Wallet(relayerPrivateKey, provider);

  logger.debug("Relayer wallet created", {
    relayerAddress: relayerWallet.address,
    pkpAddress: config.pkpAddress,
  });

  // Relayer calls transferWithAuthorization and pays gas
  const contractWithRelayer = contract.connect(relayerWallet);
  
  logger.debug("Calling transferWithAuthorization via relayer", {
    from: config.pkpAddress,
    to,
    amount: amount.toString(),
  });

  // Use explicit gas limit to avoid estimation issues when relayer wallet is low on funds
  // transferWithAuthorization typically uses ~120k-150k gas, we'll use 200k as a safe buffer
  const gasLimit = ethers.BigNumber.from(200000);

  const tx = await contractWithRelayer.transferWithAuthorization(
    config.pkpAddress, // from (PKP wallet)
    to,
    amount,
    validAfter,
    validBefore,
    nonceBytes32,
    packedSignature,
    { gasLimit } // Explicit gas limit to avoid estimation
  );

  logger.debug("Transaction sent by relayer", {
    txHash: tx.hash,
    from: config.pkpAddress, // Transfer is from PKP wallet
    relayer: relayerWallet.address, // But relayer pays gas
  });

  let receipt;
  try {
    receipt = await tx.wait();
  } catch (error: any) {
    // tx.wait() throws when status is 0, but the receipt is in the error
    if (error.receipt) {
      receipt = error.receipt;
    } else {
      // If no receipt in error, try to get it manually
      receipt = await provider.getTransactionReceipt(tx.hash);
    }
    
    // If we still don't have a receipt, re-throw
    if (!receipt) {
      throw error;
    }
  }

  if (receipt.status !== 1) {
    // Note: ERC-3009 doesn't have a nonces() function to check
    // The contract tracks used nonces internally and will reject duplicates
    // If the transaction failed, it could be due to:
    // 1. Nonce already used (replay attack prevented)
    // 2. Invalid signature
    // 3. Insufficient balance
    // 4. Authorization expired (validBefore)
    // 5. Other revert reasons
    
    // Try to get the revert reason by calling callStatic on the contract
    let revertReason = 'Unknown revert reason';
    try {
      // First try callStatic which should give us the actual revert reason
      try {
        await contractWithRelayer.callStatic.transferWithAuthorization(
          config.pkpAddress,
          to,
          amount,
          validAfter,
          validBefore,
          nonceBytes32,
          packedSignature,
          { blockTag: receipt.blockNumber }
        );
        // If callStatic succeeds, this shouldn't happen
        revertReason = 'callStatic succeeded but transaction failed (unexpected)';
        logger.warning('callStatic succeeded but transaction failed', {
          txHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber.toString(),
        });
      } catch (staticError: any) {
        const staticErrorMsg = staticError.message || staticError.toString();
        logger.debug('callStatic failed with error', {
          errorMsg: staticErrorMsg.substring(0, 500),
          errorData: staticError.data,
          errorReason: staticError.reason,
        });
        
        // Try to extract revert reason from callStatic error
        if (staticError.reason) {
          revertReason = staticError.reason;
        } else if (staticError.data) {
          try {
            const errorInterface = new ethers.utils.Interface([
              "error Error(string message)"
            ]);
            const decoded = errorInterface.decodeErrorResult("Error", staticError.data);
            revertReason = decoded.message;
          } catch {
            revertReason = staticErrorMsg.substring(0, 200);
          }
        } else {
          revertReason = staticErrorMsg.substring(0, 200);
        }
      }
    } catch (error: any) {
      logger.warning('Failed to get revert reason from callStatic', {
        error: error.message || error.toString(),
      });
      
      // Fallback to provider.call simulation (only if callStatic didn't set revertReason)
      if (revertReason === 'Unknown revert reason') {
        try {
          // Use provider.call to simulate the transaction and get revert reason
          const txData = contractWithRelayer.interface.encodeFunctionData('transferWithAuthorization', [
            config.pkpAddress,
            to,
            amount,
            validAfter,
            validBefore,
            nonceBytes32,
            packedSignature,
          ]);
          
          logger.debug('Attempting to extract revert reason via simulation', {
            txHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber.toString(),
          });
          
          try {
            // Try simulating at the exact block where the transaction was mined
            // This should match the state when the transaction executed
            try {
              // Use the PKP address as 'from' since that's who signed the authorization
              await provider.call({
                to: tokenAddress,
                data: txData,
                from: config.pkpAddress, // Use PKP address, not relayer address
              }, receipt.blockNumber);
              // If call succeeds at the same block, something else is wrong
              revertReason = 'Simulated call succeeded at same block but transaction failed (signature or nonce issue)';
              logger.warning('Simulation succeeded at same block but transaction failed', {
                txHash: receipt.transactionHash,
                blockNumber: receipt.blockNumber.toString(),
              });
            } catch (blockError: any) {
              // Try at the block before
              try {
                // Use the PKP address as 'from' since that's who signed the authorization
                await provider.call({
                  to: tokenAddress,
                  data: txData,
                  from: config.pkpAddress, // Use PKP address, not relayer address
                }, receipt.blockNumber - 1);
                revertReason = `Simulated call succeeded at previous block but transaction failed. This suggests the nonce may have been consumed by a concurrent transaction or there was a state change between blocks.`;
                logger.warning('Simulation succeeded at previous block but transaction failed - nonce may have been consumed or state changed', {
                  txHash: receipt.transactionHash,
                  blockNumber: (receipt.blockNumber - 1).toString(),
                  nonce: nonceBytes32,
                });
              } catch (prevBlockError: any) {
                // Both failed, use the error from the actual block
                throw blockError;
              }
            }
          } catch (callError: any) {
            // Extract revert reason from the error
            const errorMsg = callError.message || callError.toString();
            logger.debug('Simulation call failed with error', {
              errorMsg: errorMsg.substring(0, 500),
              errorType: callError.constructor?.name,
              errorData: callError.data,
              errorCode: callError.code,
            });
            
            // Try to decode revert reason from error data
            let decodedReason: string | null = null;
            const errorData = callError?.data || callError?.error?.data;
            if (errorData && typeof errorData === 'string' && errorData.startsWith('0x')) {
              try {
                const errorInterface = new ethers.utils.Interface([
                  "error Error(string message)"
                ]);
                const decoded = errorInterface.decodeErrorResult("Error", errorData);
                decodedReason = decoded.message;
                logger.debug('Decoded revert reason from error data', {
                  revertReason: decodedReason,
                });
              } catch (decodeError) {
                logger.debug('Failed to decode error data', {
                  error: (decodeError as Error).message,
                });
              }
            }
            
            // Use decoded reason or try to extract from error message
            if (decodedReason) {
              revertReason = decodedReason;
            } else {
              const revertMatch = errorMsg.match(/revert\s+(.+)/i) || errorMsg.match(/reverted\s+(.+)/i);
              if (revertMatch) {
                revertReason = revertMatch[1];
              } else if (errorMsg.includes('insufficient balance') || errorMsg.includes('INSUFFICIENT_BALANCE')) {
                revertReason = 'Insufficient balance in PKP wallet';
              } else if (errorMsg.includes('invalid signature') || errorMsg.includes('INVALID_SIGNATURE')) {
                revertReason = 'Invalid signature';
              } else if (errorMsg.includes('nonce') || errorMsg.includes('NONCE')) {
                revertReason = 'Nonce already used or invalid';
              } else if (errorMsg.includes('expired') || errorMsg.includes('EXPIRED')) {
                revertReason = 'Authorization expired or not yet valid';
              } else {
                revertReason = errorMsg.substring(0, 200); // Limit length
              }
            }
          }
        } catch (simulationError: any) {
          logger.warning('Failed to extract revert reason from simulation', {
            error: simulationError.message || simulationError.toString(),
          });
          if (revertReason === 'Unknown revert reason') {
            revertReason = `Failed to extract revert reason: ${simulationError.message || simulationError.toString()}`;
          }
        }
      }
    }
    
    const errorMessage = `Transaction reverted: ${receipt.transactionHash}. Reason: ${revertReason}. Gas used: ${receipt.gasUsed.toString()} (may indicate early revert). Check that PKP wallet ${config.pkpAddress} has sufficient USDC balance (${ethers.utils.formatUnits(amount, 6)} USDC required).`;
  const error = new Error(errorMessage);
    
    logger.error('Transaction reverted', error, {
      txHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed.toString(),
      revertReason,
      from: config.pkpAddress,
      to,
      amount: amount.toString(),
      amountFormatted: ethers.utils.formatUnits(amount, 6),
      nonce: nonceBytes32,
      validAfter,
      validBefore,
      currentTime: Math.floor(Date.now() / 1000),
    });
    
    throw error;
  }

  logger.debug("Transaction confirmed", {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  });

  return receipt.transactionHash as Hex;
}

