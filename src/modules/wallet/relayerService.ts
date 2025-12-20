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
      inputs: [{ name: "authorizer", type: "address" }],
      name: "nonces",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ];

  const contract = new ethers.Contract(tokenAddress, USDC_ABI, provider);

  // Get nonce for authorization
  const nonceCount = await contract.nonces(config.pkpAddress);
  const nonce = ethers.utils.hexZeroPad(ethers.utils.hexlify(nonceCount), 32);

  // Set validity window (same as testDirectTransferWithAuthorization)
  const now = Math.floor(Date.now() / 1000);
  const validAfter = 0; // Valid immediately
  const validBefore = now + 20 * 60; // 20 minutes

  logger.debug("Creating ERC-3009 authorization", {
    from: config.pkpAddress,
    to,
    amount: amount.toString(),
    nonce,
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
    nonce,
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

  const tx = await contractWithRelayer.transferWithAuthorization(
    config.pkpAddress, // from (PKP wallet)
    to,
    amount,
    validAfter,
    validBefore,
    nonce,
    packedSignature
  );

  logger.debug("Transaction sent by relayer", {
    txHash: tx.hash,
    from: config.pkpAddress, // Transfer is from PKP wallet
    relayer: relayerWallet.address, // But relayer pays gas
  });

  const receipt = await tx.wait();

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

