import { useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { getAddress, isAddress } from 'viem';
import {
  useAccount,
  useChainId,
  useChains,
  useConnect,
  useDeployContract,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
} from 'wagmi';

import { useRegistryConfig } from '../ddrp/registryConfig';
import { DEAD_DROP_REGISTRY_ABI, blockExplorerTxUrl } from '../ddrp/registry';
import { DEAD_DROP_REGISTRY_BYTECODE } from '../ddrp/registryBytecode';

function truncateMiddle(value: string, start = 6, end = 4): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function formatWalletChain(chainId: number): string {
  if (chainId === 1) return 'Ethereum Mainnet (1)';
  if (chainId === 8453) return 'Base (8453)';
  if (chainId === 11155111) return 'Sepolia (11155111)';
  if (chainId === 31337) return 'Anvil (31337)';
  return `Chain ${chainId}`;
}

export function WalletBar() {
  const appChainId = useChainId();
  const chains = useChains();
  const { switchChain, switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const registry = useRegistryConfig();
  const publicClient = usePublicClient();

  const { address, chainId: walletChainId, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { mutateAsync: deployContract, isPending: isDeploying } = useDeployContract();

  const [registryAddressDraftByChain, setRegistryAddressDraftByChain] = useState<Record<number, string>>({});
  const [registryAddressError, setRegistryAddressError] = useState<string | null>(null);
  const [deployNotice, setDeployNotice] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployTxHash, setDeployTxHash] = useState<Hex | null>(null);

  const registryAddress = registry.registryAddress;
  const registryAddressInput = registryAddressDraftByChain[appChainId] ?? registryAddress ?? '';

  const currentChain = useMemo(() => chains.find((c) => c.id === appChainId), [chains, appChainId]);
  const isWalletChainMismatch = Boolean(isConnected && walletChainId && walletChainId !== appChainId);

  function onConnect() {
    const connector = connectors[0];
    if (!connector) return;
    connect({ connector });
  }

  function onSaveRegistry() {
    try {
      const saved = registry.setRegistryAddress(registryAddressInput.trim());
      setRegistryAddressDraftByChain((prev) => ({ ...prev, [appChainId]: saved }));
      setRegistryAddressError(null);
    } catch (err) {
      setRegistryAddressError(err instanceof Error ? err.message : 'invalid address');
    }
  }

  function onResetRegistry() {
    registry.resetRegistryAddress();
    setRegistryAddressDraftByChain((prev) => {
      if (!(appChainId in prev)) return prev;
      const next = { ...prev };
      delete next[appChainId];
      return next;
    });
    setRegistryAddressError(null);
  }

  async function onDeployRegistry() {
    setRegistryAddressError(null);
    setDeployError(null);
    setDeployNotice(null);
    setDeployTxHash(null);

    if (!isConnected || !address) {
      setDeployError('Connect a wallet to deploy.');
      return;
    }
    if (!publicClient) {
      setDeployError('No public client available for this chain.');
      return;
    }

    if (walletChainId && walletChainId !== appChainId) {
      try {
        setDeployNotice(`Switching wallet to ${currentChain?.name ?? `chain ${appChainId}`}…`);
        await switchChainAsync({ chainId: appChainId });
        setDeployNotice(null);
      } catch (err) {
        setDeployNotice(null);
        setDeployError(err instanceof Error ? err.message : 'Failed to switch wallet network.');
        return;
      }
    }

    if (appChainId === 1) {
      const ok = window.confirm('Deploying on Ethereum mainnet costs gas. Continue?');
      if (!ok) return;
    }

    try {
      setDeployNotice('Sending deploy transaction…');
      const hash = (await deployContract({
        abi: DEAD_DROP_REGISTRY_ABI,
        bytecode: DEAD_DROP_REGISTRY_BYTECODE,
        chainId: appChainId,
      })) as Hex;
      setDeployTxHash(hash);
      setDeployNotice('Waiting for confirmation…');

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const contractAddress = receipt.contractAddress;
      if (!contractAddress) throw new Error('Deploy confirmed, but no contract address found in receipt.');

      const checksummed = getAddress(contractAddress) as Address;
      registry.setRegistryAddress(checksummed);
      setRegistryAddressDraftByChain((prev) => ({ ...prev, [appChainId]: checksummed }));

      setDeployNotice(`Deployed registry: ${truncateMiddle(checksummed)}`);
    } catch (err) {
      setDeployNotice(null);
      setDeployError(err instanceof Error ? err.message : 'Failed to deploy registry.');
    }
  }

  return (
    <div className="walletBar">
      <div className="walletRow">
        <label className="label">
          Chain
          <select
            className="select"
            value={appChainId}
            disabled={isSwitching}
            onChange={(e) => {
              setRegistryAddressError(null);
              switchChain({ chainId: Number(e.target.value) });
            }}
          >
            {chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
        </label>

        <div className="walletRight">
          {isConnected && address ? (
            <div className="inline">
              <span className="muted">Wallet</span> <code>{truncateMiddle(address)}</code>
              <button className="btn btnGhost" type="button" onClick={() => disconnect()}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn" type="button" onClick={onConnect} disabled={isConnecting}>
              {isConnecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>
      </div>

      {isWalletChainMismatch && walletChainId ? (
        <div className="warn">
          <div>
            Wallet network: <code>{formatWalletChain(walletChainId)}</code>. Switch to{' '}
            <code>
              {currentChain?.name ?? 'Selected chain'} ({appChainId})
            </code>{' '}
            before sending transactions.
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn btnSecondary" type="button" onClick={() => switchChain({ chainId: appChainId })} disabled={isSwitching}>
              {isSwitching ? 'Switching…' : 'Switch wallet'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="walletRow">
        <label className="label grow">
          Registry (this chain)
          <input
            className="input"
            value={registryAddressInput}
            onChange={(e) => {
              setRegistryAddressDraftByChain((prev) => ({ ...prev, [appChainId]: e.target.value }));
              setRegistryAddressError(null);
            }}
            placeholder={currentChain?.id === 31337 ? 'Deploy locally, then paste address' : '0x…'}
            spellCheck={false}
            inputMode="text"
          />
          <div className="helper">
            {registryAddress ? (
              <span>
                Active: <code>{truncateMiddle(registryAddress)}</code>
              </span>
            ) : (
              <span className="warn">No registry set. Reads/writes will fail until you set it.</span>
            )}
          </div>
        </label>

        <div className="inline">
          <button
            className="btn btnSecondary"
            type="button"
            onClick={onDeployRegistry}
            disabled={!isConnected || isDeploying || isSwitching || isWalletChainMismatch}
          >
            {isDeploying ? 'Deploying…' : 'Deploy new'}
          </button>
          <button
            className="btn btnSecondary"
            type="button"
            onClick={onSaveRegistry}
            disabled={!isAddress(registryAddressInput.trim())}
          >
            Save
          </button>
          <button className="btn btnGhost" type="button" onClick={onResetRegistry}>
            Reset
          </button>
        </div>
      </div>

      {registryAddressError ? <div className="error">{registryAddressError}</div> : null}
      {deployNotice ? (
        <div className="notice">
          <div>{deployNotice}</div>
          {deployTxHash ? (
            <div className="helper">
              Tx: <code>{truncateMiddle(deployTxHash)}</code>{' '}
              {blockExplorerTxUrl(appChainId, deployTxHash) ? (
                <a href={blockExplorerTxUrl(appChainId, deployTxHash)} target="_blank" rel="noreferrer">
                  View →
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {deployError ? <div className="error">{deployError}</div> : null}
      {connectError ? <div className="error">{connectError.message}</div> : null}
    </div>
  );
}
