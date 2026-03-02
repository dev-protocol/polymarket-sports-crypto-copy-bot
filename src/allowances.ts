/**
 * Ensure Polymarket trading allowances are set to max when private key is loaded.
 * USDC.e -> CTF (for splitting). CTF (ERC1155) -> CTF Exchange & Neg Risk CTF Exchange (for trading).
 */
import { Wallet, Contract, ethers } from "ethers";

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const ERC1155_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
];

const MIN_TIP_GWEI = ethers.BigNumber.from("30000000000"); // 30 Gwei (some RPCs require ~25 Gwei min)
const FALLBACK_MAX_FEE_GWEI = ethers.BigNumber.from("250000000000"); // 250 Gwei if chain fee unknown

/** Get EIP-1559 gas overrides so maxFeePerGas >= current base fee (Polygon base fee can be high). */
async function getGasOverrides(provider: ethers.providers.Provider): Promise<{
  maxPriorityFeePerGas: ethers.BigNumber;
  maxFeePerGas: ethers.BigNumber;
}> {
  const feeData = await provider.getFeeData();
  const tip = feeData.maxPriorityFeePerGas?.gt(MIN_TIP_GWEI)
    ? feeData.maxPriorityFeePerGas!
    : MIN_TIP_GWEI;
  const baseFee = feeData.lastBaseFeePerGas ?? ethers.BigNumber.from(0);
  // maxFeePerGas must be >= baseFee + maxPriorityFeePerGas; add 20% buffer for next block
  const maxFee = baseFee.isZero()
    ? FALLBACK_MAX_FEE_GWEI
    : baseFee.mul(120).div(100).add(tip);
  return { maxPriorityFeePerGas: tip, maxFeePerGas: maxFee };
}

export interface AllowanceResult {
  ok: boolean;
  error?: string;
}

export async function ensureAllowances(
  signer: Wallet,
  log: (msg: string) => void = () => {}
): Promise<AllowanceResult> {
  const rpc = process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com";
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const connectedSigner = signer.connect(provider);

  const maxUint256 = ethers.constants.MaxUint256;
  const gasOverrides = await getGasOverrides(provider);

  // 1. USDC.e allowance for CTF (so we can split USDC into outcome tokens)
  try {
    const usdc = new Contract(USDC_E, ERC20_ABI, connectedSigner);
    const current = await usdc.allowance(connectedSigner.address, CTF);
    if (current.lt(maxUint256)) {
      log("[Allowance] Approving USDC.e for CTF (max)...");
      const tx = await usdc.approve(CTF, maxUint256, gasOverrides);
      await tx.wait();
      log("[Allowance] USDC.e approval confirmed.");
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log("[Allowance] USDC.e approve failed: " + errMsg);
    return { ok: false, error: errMsg };
  }

  // 2. CTF (ERC1155) setApprovalForAll for CTF Exchange
  try {
    const ctf = new Contract(CTF, ERC1155_ABI, connectedSigner);
    for (const [name, operator] of [
      ["CTF Exchange", CTF_EXCHANGE],
      ["Neg Risk CTF Exchange", NEG_RISK_CTF_EXCHANGE],
    ] as const) {
      const approved = await ctf.isApprovedForAll(connectedSigner.address, operator);
      if (!approved) {
        log(`[Allowance] Approving CTF for ${name}...`);
        const tx = await ctf.setApprovalForAll(operator, true, gasOverrides);
        await tx.wait();
        log(`[Allowance] ${name} approval confirmed.`);
      }
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log("[Allowance] CTF setApprovalForAll failed: " + errMsg);
    return { ok: false, error: errMsg };
  }

  return { ok: true };
}
