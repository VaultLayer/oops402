/**
 * Direct ERC-3009 transferWithAuthorization test
 * Tests PKPEthersWallet signature generation and direct contract call
 * Bypasses x402 SDK to isolate signature issues
 */

import { PKPAccount } from "../wallet/pkpSigner.js";
import { logger } from "../shared/logger.js";
import { PKPEthersWallet } from "@lit-protocol/pkp-ethers";
import { ethers } from "ethers";
import { createPublicClient, http, parseUnits, type Address, type Hex } from "viem";
import { base } from "viem/chains";
// Import USDC ABI - we'll define a minimal version here
const USDC_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "version",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "authorizer", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
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
] as const;

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

/**
 * Test direct transferWithAuthorization call using PKPEthersWallet or EOA wallet
 */
export async function testDirectTransferWithAuthorization(
  pkpAccount: PKPAccount | null,
  to: Address,
  amount: string = "0.01", // 0.01 USDC
  useEOA: boolean = false // If true, use EOA wallet from LIT_PRIVATE_KEY instead of PKP
): Promise<{
  success: boolean;
  txHash?: Hex;
  error?: string;
  walletAddress?: Address;
}> {
  // Check if we should use EOA wallet
  let walletAddress: Address | undefined;
  let signer: ethers.Wallet | PKPEthersWallet | null = null;
  
  try {
    if (useEOA) {
      const privateKey = process.env.LIT_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error("LIT_PRIVATE_KEY environment variable is required when useEOA=true");
      }
      
      // Create ethers provider explicitly for Base chain
      const rpcUrl = process.env.BASE_RPC_URL 
        || process.env.ALCHEMY_BASE_RPC 
        || (process.env.ALCHEMY_API_KEY ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : null)
        || "https://mainnet.base.org";
      
      const baseChainId = 8453;
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl, {
        name: "base",
        chainId: baseChainId,
      });
      
      // Create EOA wallet
      signer = new ethers.Wallet(privateKey, provider);
      walletAddress = signer.address as Address;
      
      logger.info("Using EOA wallet for direct transfer test", {
        walletAddress,
        rpcUrl: rpcUrl.replace(/\/v2\/[^/]+/, '/v2/***'),
      });
    } else {
      if (!pkpAccount) {
        throw new Error("pkpAccount is required when useEOA=false");
      }
      walletAddress = pkpAccount.address as Address;
    }
    
    logger.info("Starting direct transferWithAuthorization test", {
      from: walletAddress,
      to,
      amount,
      useEOA,
    });

    // Create ethers provider explicitly for Base chain
    // Try multiple RPC sources in order of preference
    const rpcUrl = process.env.BASE_RPC_URL 
      || process.env.ALCHEMY_BASE_RPC 
      || (process.env.ALCHEMY_API_KEY ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : null)
      || "https://mainnet.base.org";
    
    const baseChainId = 8453; // Base mainnet
    
    logger.debug("Using Base RPC URL for direct transfer test", { 
      rpcUrl: rpcUrl.replace(/\/v2\/[^/]+/, '/v2/***'), // Mask API key in logs
      chainId: baseChainId,
      contractAddress: USDC_BASE,
    });
    
    // Create provider with explicit Base chain configuration
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl, {
      name: "base",
      chainId: baseChainId,
    });

    let pkpEthersWallet: PKPEthersWallet | null = null;
    
    if (!useEOA) {
      // Create PKPEthersWallet
      if (!pkpAccount) {
        throw new Error("pkpAccount is required when useEOA=false");
      }
      
      // Dynamically import getLitNodeClient only when needed (for PKP)
      const { getLitNodeClient } = await import("../wallet/litService.js");
      const litNodeClient = await getLitNodeClient();
      pkpEthersWallet = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: pkpAccount.publicKey,
        controllerSessionSigs: pkpAccount['sessionSigs'],
      });
      
      // CRITICAL: Set the provider on PKPEthersWallet to use Base RPC
      pkpEthersWallet.provider = provider;
      
      // CRITICAL: signTransaction uses this.rpcProvider internally to populate missing fields
      // If we don't set this, it will use Lit's RPC and get the wrong chainId/nonce/gasPrice
      await pkpEthersWallet.setRpc(rpcUrl);
      
      logger.debug("Set Base provider and RPC on PKPEthersWallet", {
        providerUrl: rpcUrl.replace(/\/v2\/[^/]+/, '/v2/***'),
        walletAddress: pkpEthersWallet.address,
        hasProvider: !!pkpEthersWallet.provider,
        providerChainId: (await pkpEthersWallet.provider.getNetwork()).chainId,
        rpcProviderSet: true,
      });
    } else {
      // For EOA, signer is already created above
    }
    
    // Try to also set provider on internal signer if available
    if (pkpEthersWallet && (pkpEthersWallet as any)._signer) {
      (pkpEthersWallet as any)._signer.provider = provider;
    }
    
    if (pkpEthersWallet) {
      logger.debug("Set Base provider on PKPEthersWallet", {
        providerUrl: rpcUrl.replace(/\/v2\/[^/]+/, '/v2/***'),
        walletAddress: pkpEthersWallet.address,
        hasProvider: !!pkpEthersWallet.provider,
        providerChainId: (await provider.getNetwork()).chainId,
      });
    } else if (useEOA && signer instanceof ethers.Wallet) {
      logger.debug("Using EOA wallet", {
        walletAddress: signer.address,
        providerUrl: rpcUrl.replace(/\/v2\/[^/]+/, '/v2/***'),
        providerChainId: (await provider.getNetwork()).chainId,
      });
    }
    
    const contract = new ethers.Contract(USDC_BASE, USDC_ABI, provider);

    // Get token decimals
    const decimals = await contract.decimals();
    const value = parseUnits(amount, decimals);

    // Get chain ID
    const network = await provider.getNetwork();
    const chainId = network.chainId;

    // Read name and version from contract
    const tokenName = await contract.name();
    let tokenVersion = "2"; // Default
    try {
      tokenVersion = await contract.version();
    } catch {
      logger.warning("Could not read version from contract, using default '2'");
    }

    logger.debug("Token info", {
      name: tokenName,
      version: tokenVersion,
      decimals,
      chainId: chainId.toString(),
      value: value.toString(),
    });

    // Generate nonce
    const nonce = ethers.utils.hexlify(ethers.utils.randomBytes(32));

    // Time window: valid immediately, expires in 20 minutes
    const now = Math.floor(Date.now() / 1000);
    const validAfter = 0; // Valid immediately
    const validBefore = now + 20 * 60; // 20 minutes

    // Build EIP-712 typed data
    const domain = {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: USDC_BASE,
    };
    
    // CRITICAL: Verify the domain separator matches what the contract expects
    // The contract uses MessageHashUtils._hashTypedDataV4 which computes:
    // keccak256(abi.encodePacked(EIP712DOMAIN_TYPEHASH, name, version, chainId, verifyingContract))
    // Let's compute it and compare with what we're using
    const computedDomainSeparator = ethers.utils._TypedDataEncoder.hashDomain(domain);
    
    // Try to read domain separator from contract if available
    try {
      await contract.DOMAIN_SEPARATOR();
    } catch {
      // Contract doesn't expose DOMAIN_SEPARATOR, that's okay
    }

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
      from: walletAddress,
      to,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    };

    // Sign with wallet (PKPEthersWallet or EOA)
    logger.info(`Signing with ${useEOA ? 'EOA wallet' : 'PKPEthersWallet'}...`);
    let signature: string;
    
    if (useEOA && signer instanceof ethers.Wallet) {
      signature = await signer._signTypedData(domain, types, message);
    } else if (pkpEthersWallet) {
      // Use ethers' hash (same as EOA) - the contract accepts this
      const ethersHash = ethers.utils._TypedDataEncoder.hash(domain, types, message);

      if (!pkpAccount) {
        throw new Error("pkpAccount is not available");
      }

      const { pkpSign } = await import("../wallet/litService.js");
      const pkpPublicKey = pkpAccount.publicKey;
      const sessionSigs = pkpAccount['sessionSigs'];

      if (!sessionSigs) {
        throw new Error("Session signatures not available on PKPAccount");
      }

      // Sign the ethers hash directly using pkpSign (same hash that works for EOA)
      signature = await pkpSign(sessionSigs, pkpPublicKey, ethersHash as `0x${string}`);

      // Verify the signature recovers correctly
      const recovered = ethers.utils.recoverAddress(ethersHash, signature);
      if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error(`Signature does not recover from ethers hash! Expected ${walletAddress}, got ${recovered}`);
      }
    } else {
      throw new Error("No signer available");
    }


    // Parse signature into v, r, s
    const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
    const r = `0x${sigHex.slice(0, 64)}`;
    let s = `0x${sigHex.slice(64, 128)}`;
    let v = parseInt(sigHex.slice(128, 130), 16);
    
    // CRITICAL: USDC contract's ECRecover library enforces EIP-2 signature normalization
    // Line 52-56 in ECRecover.sol checks: s <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
    // If s is too large, it reverts with "ECRecover: invalid signature 's' value"
    // However, we're getting "FiatTokenV2: invalid signature", so the s check passes
    // but something else is wrong. Let's normalize anyway to ensure compliance.
    const secp256k1n = ethers.BigNumber.from("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    const secp256k1nHalf = ethers.BigNumber.from("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0");
    const sBN = ethers.BigNumber.from(s);
    const needsNormalization = sBN.gt(secp256k1nHalf);
    
    if (needsNormalization) {
      logger.warning("Signature s value exceeds USDC contract's EIP-2 threshold, normalizing...", {
        originalS: s,
        sValue: sBN.toString(),
        secp256k1nHalf: secp256k1nHalf.toString(),
        threshold: "0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0",
        note: "USDC ECRecover.sol line 52-56 enforces this",
      });
      // Normalize: s' = secp256k1n - s, and flip v (27 <-> 28)
      const normalizedS = secp256k1n.sub(sBN);
      s = normalizedS.toHexString();
      // Ensure s is exactly 32 bytes (pad if needed)
      if (s.length < 66) { // 0x + 64 hex chars = 66
        s = '0x' + s.slice(2).padStart(64, '0');
      }
      v = v === 27 ? 28 : 27;
    }
    
    // Pack signature as bytes (r, s, v) - this is what the contract expects
    // The contract uses abi.encodePacked(r, s, v) internally
    // We need to manually construct it: r (32 bytes) + s (32 bytes) + v (1 byte)
    // Remove 0x prefix and ensure proper byte alignment
    const rBytes = r.startsWith('0x') ? r.slice(2) : r;
    const sBytes = s.startsWith('0x') ? s.slice(2) : s;
    const vByte = v.toString(16).padStart(2, '0');
    
    // Ensure r and s are exactly 64 hex characters (32 bytes each)
    const rPadded = rBytes.padStart(64, '0');
    const sPadded = sBytes.padStart(64, '0');
    
    // Pack signature: r (32 bytes) + s (32 bytes) + v (1 byte) = 65 bytes total
    const packedSignature = '0x' + rPadded + sPadded + vByte;
    
    // Verify the packed signature recovers correctly
    const ethersHashForPacked = ethers.utils._TypedDataEncoder.hash(domain, types, message);
    const recoveredFromPacked = ethers.utils.recoverAddress(ethersHashForPacked, packedSignature);
    
    if (recoveredFromPacked.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error(`Packed signature recovery failed! Expected ${walletAddress}, got ${recoveredFromPacked}`);
    }

    // Verify signature recovery
    const ethersHash = ethers.utils._TypedDataEncoder.hash(domain, types, message);
    const recovered = ethers.utils.recoverAddress(ethersHash, signature);
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error(`Signature recovery failed! Expected ${walletAddress}, got ${recovered}`);
    }

    const contractWithSigner = contract.connect(useEOA ? (signer as ethers.Wallet) : (pkpEthersWallet as PKPEthersWallet));

    // Try a static call first to check for revert reasons
    // CRITICAL: Compute both hashes to see which one the contract validates against
    const TRANSFER_WITH_AUTHORIZATION_TYPEHASH_STATIC = "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267";
    const contractDataHashStatic = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256", "bytes32"],
        [
          TRANSFER_WITH_AUTHORIZATION_TYPEHASH_STATIC,
          walletAddress,
          to,
          value,
          validAfter,
          validBefore,
          nonce,
        ]
      )
    );
    const EIP712_DOMAIN_TYPEHASH_STATIC = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    );
    const contractDomainSeparatorStatic = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "string", "string", "uint256", "address"],
        [EIP712_DOMAIN_TYPEHASH_STATIC, domain.name, domain.version, domain.chainId, domain.verifyingContract]
      )
    );
    const contractHashStatic = ethers.utils.keccak256(
      ethers.utils.hexConcat(["0x1901", contractDomainSeparatorStatic, contractDataHashStatic])
    );
    const ethersHashStatic = ethers.utils._TypedDataEncoder.hash(domain, types, message);
    
    // Verify signature recovers from both hashes
    const recoveredFromEthersHashStatic = ethers.utils.recoverAddress(ethersHashStatic, signature);
    const recoveredFromContractHashStatic = ethers.utils.recoverAddress(contractHashStatic, signature);
    
    // Check if wallet address is a contract (for ERC-1271 validation)
    // The USDC contract uses extcodesize to detect contracts. If the address has code,
    // it will use ERC-1271 validation, otherwise it uses ECDSA recovery.
    // PKP wallets should be EOAs (no code) to work with USDC's SignatureChecker.
    const code = await provider.getCode(walletAddress);
    const isContract = code !== "0x" && code !== "0x0";
    
    if (isContract && !useEOA) {
      logger.error("PKP wallet has code - ERC-1271 validation will fail", {
        walletAddress,
        issue: "Wallet has code, so USDC contract will attempt ERC-1271 validation. PKP wallets don't implement ERC-1271.",
        solution: "Use a fresh PKP wallet without EIP-7702 delegation code, or use 'owner' mode for gas sponsorship instead of '7702' mode.",
      } as any);
    }
    
    
    // Try static call first to check for revert reasons
    try {
      await contractWithSigner.callStatic.transferWithAuthorization(
        walletAddress,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
        packedSignature
      );
    } catch (staticError: any) {
      const errorReason = (staticError as any)?.reason || staticError?.message;
      logger.error("Static call failed", new Error(errorReason || "Unknown error"));
    }

    // Populate transaction and send via Base provider
    
    // Populate the transaction data using packed signature (what contract expects)
    const txData = await contractWithSigner.populateTransaction.transferWithAuthorization(
      walletAddress,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
      packedSignature
    );
    
    
    // Get gas price, nonce, and estimate gas from Base provider
    const [gasPrice, nonceCount] = await Promise.all([
      provider.getGasPrice(),
      provider.getTransactionCount(walletAddress),
    ]);
    
    // Estimate gas for the transaction using packed signature
    // Gas estimation consistently underestimates by ~2.3x (estimates ~24k, actual ~57k)
    // So we'll use a fixed higher limit based on observed actual usage
    let gasEstimate: ethers.BigNumber;
    try {
      const estimated = await contractWithSigner.estimateGas.transferWithAuthorization(
        walletAddress,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
        packedSignature
      );
      // Add 150% buffer (2.5x) since gas estimation is consistently ~40% of actual usage
      // Actual usage is ~57k, so 2.5x of 24k = 60k, but we need more buffer
      gasEstimate = estimated.mul(250).div(100);
      // Ensure minimum gas limit of 70k (actual usage is ~57k, so 70k gives us ~20% buffer)
      const minGas = ethers.BigNumber.from(70000);
      if (gasEstimate.lt(minGas)) {
        gasEstimate = minGas;
      }
    } catch (error: any) {
      // Use a safe default - actual usage is ~57k, so 75k gives us good buffer
      gasEstimate = ethers.BigNumber.from(75000);
    }
    
    // Create the transaction with all required fields
    const tx = {
      to: txData.to,
      data: txData.data,
      value: txData.value || ethers.BigNumber.from(0),
      gasPrice: gasPrice,
      gasLimit: gasEstimate,
      nonce: nonceCount,
      chainId: baseChainId,
    };
    
    // Sign the transaction with the appropriate signer
    let signedTx: string;
    if (useEOA && signer instanceof ethers.Wallet) {
      signedTx = await signer.signTransaction(tx);
    } else if (pkpEthersWallet) {
      // CRITICAL: PKPEthersWallet.signTransaction uses this.rpcProvider internally
      // to populate missing fields (chainId, nonce, gasPrice, gasLimit)
      // Even though we set all fields explicitly, it might still query the RPC
      // So we need to ensure rpcProvider is set to Base RPC (done above)
      
      // Also use manual settings to ensure PKPEthersWallet doesn't override our values
      // Note: setNonce expects a hex string, not a number
      if (tx.chainId) {
        pkpEthersWallet.setChainId(tx.chainId);
      }
      if (tx.nonce !== undefined) {
        // Convert nonce to hex string (0x-prefixed)
        const nonceHex = ethers.utils.hexValue(tx.nonce);
        pkpEthersWallet.setNonce(nonceHex);
      }
      if (tx.gasPrice) {
        // Convert BigNumber to hex string
        const gasPriceHex = ethers.utils.hexValue(tx.gasPrice);
        pkpEthersWallet.setGasPrice(gasPriceHex);
      }
      if (tx.gasLimit) {
        // Convert BigNumber to hex string
        const gasLimitHex = ethers.utils.hexValue(tx.gasLimit);
        pkpEthersWallet.setGasLimit(gasLimitHex);
      }
      
      signedTx = await pkpEthersWallet.signTransaction(tx);
      
      // Reset manual settings after signing
      pkpEthersWallet.resetManualSettings();
    } else {
      throw new Error("No signer available for transaction");
    }
    
    // Send the signed transaction via Base provider (not Lit's RPC)
    const txResponse = await provider.sendTransaction(signedTx);

    logger.info("Transaction sent", {
      txHash: txResponse.hash,
    });

    // Wait for transaction
    let receipt;
    try {
      receipt = await txResponse.wait();
    } catch (error: any) {
      // Get receipt from error or query for it
      receipt = error?.receipt || await provider.getTransactionReceipt(txResponse.hash);
    }

    logger.info("Transaction confirmed", {
      txHash: receipt.transactionHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
    });
    
    // If transaction failed, try to decode the revert reason
    if (receipt.status === 0) {
      let revertReason: string | null = null;
      
      // Try to decode from error data
      try {
        await provider.call({
          to: txData.to,
          data: txData.data,
          from: walletAddress,
        }, receipt.blockNumber - 1);
      } catch (rpcError: any) {
        const errorData = rpcError?.data || rpcError?.error?.data;
        if (errorData && typeof errorData === 'string' && errorData.startsWith('0x')) {
          try {
            const errorInterface = new ethers.utils.Interface([
              "error Error(string message)"
            ]);
            const decoded = errorInterface.decodeErrorResult("Error", errorData);
            revertReason = decoded.message;
          } catch {
            // Not decodable
          }
        }
        revertReason = revertReason || rpcError?.reason || rpcError?.message || 'Unknown reason';
      }
      
      logger.error("Transaction failed on-chain", new Error(`Transaction reverted: ${revertReason || 'Unknown reason'}`), {
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        revertReason: revertReason || 'Could not decode revert reason',
      });
    }

    if (receipt.status !== 1) {
      throw new Error('Transaction reverted (check logs for revert reason)');
    }

    return {
      success: true,
      txHash: receipt.transactionHash as Hex,
      walletAddress,
    };
  } catch (error: any) {
    logger.error("Direct transferWithAuthorization test failed", error as Error, {
      from: walletAddress || 'unknown',
      to,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      walletAddress: walletAddress || undefined,
    };
  }
}

