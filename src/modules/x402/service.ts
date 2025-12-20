/**
 * x402 Payment Service
 * Handles payments to x402-protected resources using PKP wallets
 */

import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { PKPAccount } from "../wallet/pkpSigner.js";
import { logger } from "../shared/logger.js";
import { PKPEthersWallet } from "@lit-protocol/pkp-ethers";
import { getAddress, type Account, type SignableMessage, type SignMessageReturnType, type TypedDataDefinition, type SignTypedDataReturnType, recoverAddress, parseSignature, type Address, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { getLitNodeClient } from "../wallet/litService.js";
import { pkpSignTransaction } from "../wallet/litService.js";
import { ethers } from "ethers";

const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

/**
 * Convert PKPEthersWallet to a viem Account
 * PKPEthersWallet is a proper Ethers wallet that handles all signature formatting correctly
 */
async function createViemAccountFromPKPEthersWallet(
  pkpAccount: PKPAccount
): Promise<Account> {
  logger.debug("Creating PKPEthersWallet", {
    address: pkpAccount.address,
    publicKey: pkpAccount.publicKey,
  });

  const litNodeClient = await getLitNodeClient();

  // Create PKPEthersWallet instance
  const pkpEthersWallet = new PKPEthersWallet({
    litNodeClient,
    pkpPubKey: pkpAccount.publicKey,
    controllerSessionSigs: pkpAccount['sessionSigs'],
  });
  
  // CRITICAL: Set Base RPC provider on PKPEthersWallet (same as in testDirectTransfer)
  // This ensures it uses the correct RPC for any chain operations
  const baseRpcUrl = process.env.BASE_RPC_URL 
    || process.env.ALCHEMY_BASE_RPC 
    || (process.env.ALCHEMY_API_KEY ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : null)
    || "https://mainnet.base.org";
  
  const baseProvider = new ethers.providers.JsonRpcProvider(baseRpcUrl, {
    name: "base",
    chainId: 8453,
  });
  
  pkpEthersWallet.provider = baseProvider;
  
  logger.debug("Set Base provider on PKPEthersWallet for x402 service", {
    providerUrl: baseRpcUrl.replace(/\/v2\/[^/]+/, '/v2/***'),
    walletAddress: pkpAccount.address,
  });

  // Create a viem Account that wraps PKPEthersWallet
  // Use type assertion to match viem's Account interface
  const viemAccount = {
    type: "local" as const,
    address: getAddress(pkpAccount.address),
    async signMessage({ message }: { message: SignableMessage }): Promise<SignMessageReturnType> {
      logger.debug("Signing message with PKPEthersWallet", { address: pkpAccount.address });
      // PKPEthersWallet.signMessage expects a string or Bytes
      const messageStr = typeof message === 'string' ? message : (message as any).raw || String(message);
      const signature = await pkpEthersWallet.signMessage(messageStr);
      return signature as `0x${string}`;
    },
    async signTypedData(parameters: any): Promise<SignTypedDataReturnType> {
      logger.debug("Signing typed data", { 
        address: pkpAccount.address,
        primaryType: parameters.primaryType,
        domain: parameters.domain,
        message: parameters.message,
      });
      
      // For TransferWithAuthorization, use PKPEthersWallet's signature directly
      // PKPEthersWallet is a proper Ethers wallet that handles EIP-712 correctly
      if (parameters.primaryType === "TransferWithAuthorization") {
        logger.debug("Signing TransferWithAuthorization with PKPEthersWallet", {
          domain: parameters.domain,
          message: parameters.message,
        });
        
        // Verify domain values match what's on-chain (critical for signature validation)
        try {
          const verifyingContract = parameters.domain.verifyingContract as Address;
          const chainId = parameters.domain.chainId;
          
          // Create public client to read from chain
          // Use Base RPC URL from env or default
          const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
          const publicClient = createPublicClient({
            chain: base,
            transport: http(rpcUrl),
          });
          
          // Read name and version from the contract
          const [contractName, contractVersion] = await Promise.all([
            publicClient.readContract({
              address: verifyingContract,
              abi: [
                {
                  name: "name",
                  type: "function",
                  stateMutability: "view",
                  inputs: [],
                  outputs: [{ name: "", type: "string" }],
                },
              ] as const,
              functionName: "name",
            }).catch(() => null),
            publicClient.readContract({
              address: verifyingContract,
              abi: [
                {
                  name: "version",
                  type: "function",
                  stateMutability: "view",
                  inputs: [],
                  outputs: [{ name: "", type: "string" }],
                },
              ] as const,
              functionName: "version",
            }).catch(() => null),
          ]);
          
          logger.debug("EIP-712 domain verification", {
            providedDomain: {
              name: parameters.domain.name,
              version: parameters.domain.version,
              chainId: parameters.domain.chainId,
              verifyingContract: parameters.domain.verifyingContract,
            },
            onChainValues: {
              name: contractName,
              version: contractVersion,
              chainId,
              verifyingContract,
            },
            nameMatch: contractName ? parameters.domain.name === contractName : "unknown",
            versionMatch: contractVersion ? parameters.domain.version === contractVersion : "unknown",
          });
          
          if (contractName && parameters.domain.name !== contractName) {
            logger.warning("Domain name mismatch!", {
              provided: parameters.domain.name,
              onChain: contractName,
            });
          }
          
          if (contractVersion && parameters.domain.version !== contractVersion) {
            logger.warning("Domain version mismatch!", {
              provided: parameters.domain.version,
              onChain: contractVersion,
            });
          }
        } catch (error) {
          logger.warning("Failed to verify domain values on-chain", {
            error: error instanceof Error ? error.message : String(error),
            domain: parameters.domain,
          });
        }
        
        // Use PKPEthersWallet._signTypedData - it's a proper Ethers wallet implementation
        // that handles EIP-712 signing correctly, including hash computation and signature formatting
        // This is the same approach that works in testDirectTransfer.ts with EOA wallets
        logger.debug("Signing typed data with PKPEthersWallet", {
          address: pkpAccount.address,
          primaryType: parameters.primaryType,
        });
        
        const signature = await pkpEthersWallet._signTypedData(
          parameters.domain,
          parameters.types,
          parameters.message
        );
        
        logger.debug("Signed typed data with PKPEthersWallet", {
          address: pkpAccount.address,
          signatureLength: signature.length,
          signature: signature.substring(0, 20) + "...", // Log first part only
        });
        
        // Verify the signature recovers to the correct address
        // Also compute the hash exactly as the contract does to ensure they match
        try {
          // Standard ethers hash (what PKPEthersWallet uses)
          const ethersHash = ethers.utils._TypedDataEncoder.hash(
            parameters.domain,
            parameters.types,
            parameters.message
          );
          
          // Contract's exact hash computation (two-step process matching EIP3009.sol)
          const TRANSFER_WITH_AUTHORIZATION_TYPEHASH = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
          );
          
          // Step 1: dataHash = keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
          const dataHash = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
              ["bytes32", "address", "address", "uint256", "uint256", "uint256", "bytes32"],
              [
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                parameters.message.from,
                parameters.message.to,
                parameters.message.value,
                parameters.message.validAfter,
                parameters.message.validBefore,
                parameters.message.nonce,
              ]
            )
          );
          
          // Step 2: domain separator
          const domainSeparator = ethers.utils._TypedDataEncoder.hashDomain(parameters.domain);
          
          // Step 3: contractHash = MessageHashUtils.toTypedDataHash(domainSeparator, dataHash)
          // This is: keccak256(abi.encodePacked("\x19\x01", domainSeparator, dataHash))
          const contractHash = ethers.utils.keccak256(
            ethers.utils.hexConcat(["0x1901", domainSeparator, dataHash])
          );
          
          logger.debug("Hash computation comparison", {
            ethersHash,
            contractHash,
            match: ethersHash.toLowerCase() === contractHash.toLowerCase(),
            domainSeparator,
            dataHash,
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
          });
          
          // Verify signature recovery with both hashes
          const recoveredEthers = ethers.utils.recoverAddress(ethersHash, signature);
          const recoveredContract = ethers.utils.recoverAddress(contractHash, signature);
          const expected = pkpAccount.address.toLowerCase();
          
          logger.debug("PKPEthersWallet signature verification", {
            expected,
            recoveredEthers,
            recoveredContract,
            ethersMatch: expected === recoveredEthers.toLowerCase(),
            contractMatch: expected === recoveredContract.toLowerCase(),
            ethersHash,
            contractHash,
            signature,
          });
          
          if (expected !== recoveredEthers.toLowerCase()) {
            logger.warning("PKPEthersWallet signature recovery mismatch with ethers hash!", {
              expected,
              recovered: recoveredEthers,
              hash: ethersHash,
              signature,
            });
          }
          
          if (expected !== recoveredContract.toLowerCase()) {
            logger.warning("PKPEthersWallet signature recovery mismatch with contract hash!", {
              expected,
              recovered: recoveredContract,
              hash: contractHash,
              signature,
            });
          }
          
          // Also verify the signature bytes format matches what contract expects
          // Contract reconstructs as: abi.encodePacked(r, s, v)
          const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
          const r = `0x${sigHex.slice(0, 64)}`;
          const s = `0x${sigHex.slice(64, 128)}`;
          const v = parseInt(sigHex.slice(128, 130), 16);
          
          // Simulate what the facilitator does: parseSignature and compute v
          const parsedSig = parseSignature(signature as `0x${string}`);
          const facilitatorV = parsedSig.v !== undefined ? Number(parsedSig.v) : 27 + (parsedSig.yParity || 0);
          
          // Check s value normalization (some contracts require s <= secp256k1n/2)
          const secp256k1n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
          const sValue = BigInt(s);
          const needsNormalization = sValue > secp256k1n / 2n;
          const normalizedS = needsNormalization ? `0x${(secp256k1n - sValue).toString(16).padStart(64, '0')}` : s;
          const normalizedV = needsNormalization ? (v === 27 ? 28 : 27) : v;
          
          logger.debug("Facilitator signature parsing simulation", {
            originalSignature: signature,
            parsedR: parsedSig.r,
            parsedS: parsedSig.s,
            parsedV: parsedSig.v,
            parsedYParity: parsedSig.yParity,
            facilitatorV,
            ourV: v,
            vMatch: facilitatorV === v,
            rMatch: parsedSig.r.toLowerCase() === r.toLowerCase(),
            sMatch: parsedSig.s.toLowerCase() === s.toLowerCase(),
            sValue: sValue.toString(),
            needsNormalization,
            normalizedS,
            normalizedV,
          });
          
          // Reconstruct signature bytes as contract does: abi.encodePacked(r, s, v)
          // Use the facilitator's computed v and parsed r, s
          const contractSignatureBytes = ethers.utils.hexConcat([
            parsedSig.r,
            parsedSig.s,
            ethers.utils.hexlify(facilitatorV)
          ]);
          
          // Also try with normalized s if needed
          const normalizedSignatureBytes = needsNormalization
            ? ethers.utils.hexConcat([
                parsedSig.r,
                normalizedS,
                ethers.utils.hexlify(normalizedV)
              ])
            : null;
          
          // Verify recovery with reconstructed bytes
          const recoveredReconstructed = ethers.utils.recoverAddress(contractHash, contractSignatureBytes);
          const recoveredNormalized = normalizedSignatureBytes
            ? ethers.utils.recoverAddress(contractHash, normalizedSignatureBytes)
            : null;
          
          logger.debug("Contract signature format verification", {
            r: parsedSig.r,
            s: parsedSig.s,
            v: facilitatorV,
            originalSignature: signature,
            reconstructedBytes: contractSignatureBytes,
            recoveredReconstructed,
            contractMatch: expected === recoveredReconstructed.toLowerCase(),
            needsNormalization,
            normalizedS,
            normalizedV,
            normalizedSignatureBytes,
            recoveredNormalized,
            normalizedMatch: recoveredNormalized ? expected === recoveredNormalized.toLowerCase() : null,
          });
          
        } catch (error) {
          logger.warning("Failed to verify PKPEthersWallet signature recovery", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        
        return signature as `0x${string}`;
      }
      
      // For other typed data, use PKPEthersWallet's _signTypedData
      logger.debug("Using PKPEthersWallet._signTypedData for non-TransferWithAuthorization", {
        primaryType: parameters.primaryType,
      });
      const signature = await pkpEthersWallet._signTypedData(
        parameters.domain,
        parameters.types,
        parameters.message
      );
      return signature as `0x${string}`;
    },
  } as Account;

  logger.debug("Created viem Account from PKPEthersWallet", {
    address: viemAccount.address,
  });

  return viemAccount;
}

/**
 * Create a fetch function wrapped with x402 payment handling using PKP signer
 */
export async function createBuyerFetch(
  pkpAccount: PKPAccount,
  maxAmountPerRequest?: bigint
): Promise<typeof fetch> {
  logger.debug("Creating x402 buyer fetch", { 
    address: pkpAccount.address,
    maxAmount: maxAmountPerRequest?.toString() 
  });

  // Create viem Account from PKPEthersWallet
  const viemAccount = await createViemAccountFromPKPEthersWallet(pkpAccount);
  
  // Create client and register ExactEvmScheme using the helper function
  // This automatically registers all supported networks (v1 and v2)
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: viemAccount as any });
  
  // Add hooks
  client
    .onBeforePaymentCreation(async (context) => {
      logger.debug("Before payment creation", {
        network: context.selectedRequirements.network,
        scheme: context.selectedRequirements.scheme,
        signerAddress: viemAccount.address,
      });
    })
    .onAfterPaymentCreation(async (context) => {
      const payloadStr = JSON.stringify(context.paymentPayload, (key, value) => {
        // Handle BigInt serialization
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      });
      
      logger.debug("After payment creation", {
        version: context.paymentPayload.x402Version,
        payload: payloadStr,
      });
      
      // Log signature details if available
      if (context.paymentPayload.payload?.signature) {
        const sig = context.paymentPayload.payload.signature as string;
        const sigHex = sig.startsWith('0x') ? sig.slice(2) : sig;
        const r = `0x${sigHex.slice(0, 64)}`;
        const s = `0x${sigHex.slice(64, 128)}`;
        const vHex = sigHex.slice(128, 130);
        const v = parseInt(vHex, 16);
        
        logger.debug("Payment signature components", {
          fullSignature: sig,
          r,
          s,
          v,
          vHex,
          rLength: r.length,
          sLength: s.length,
        });
      }
    })
    .onPaymentCreationFailure(async (context) => {
      logger.warning("Payment creation failed", {
        error: context.error?.message,
        stack: context.error?.stack,
      });
    });

  if (maxAmountPerRequest) {
    // Set max amount per request if provided
    // Note: This may need to be set via client configuration if the SDK supports it
  }

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  return fetchWithPayment;
}

/**
 * Make a payment to an x402-protected resource
 */
export async function makePayment(
  pkpAccount: PKPAccount,
  resourceUrl: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    maxAmountPerRequest?: bigint;
  } = {}
): Promise<{
  response: Response;
  paymentResponse?: any;
}> {
  const fetchWithPayment = await createBuyerFetch(
    pkpAccount,
    options.maxAmountPerRequest
  );

  logger.debug("Making payment request", {
    url: resourceUrl,
    method: options.method || "GET",
  });

  const response = await fetchWithPayment(resourceUrl, {
    method: (options.method || "GET") as RequestInit["method"],
    headers: options.headers,
    body: options.body,
  });

  // Extract payment response from headers if present
  const paymentResponseHeader = response.headers.get("X-PAYMENT-RESPONSE");
  let paymentResponse = null;
  
  if (paymentResponseHeader) {
    try {
      const { x402HTTPClient } = await import("@x402/fetch");
      const viemAccount = await createViemAccountFromPKPEthersWallet(pkpAccount);
      const client = new x402Client();
      registerExactEvmScheme(client, { signer: viemAccount as any });
      
      const httpClient = new x402HTTPClient(client);
      paymentResponse = httpClient.getPaymentSettleResponse((name) =>
        response.headers.get(name)
      );
    } catch (error) {
      logger.warning("Failed to decode payment response", { error });
    }
  }

  logger.debug("Payment request completed", {
    status: response.status,
    hasPaymentResponse: !!paymentResponse,
  });

  return {
    response,
    paymentResponse,
  };
}
