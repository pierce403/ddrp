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

export function WalletBar() {
  const chainId = useChainId();
  const chains = useChains();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const registry = useRegistryConfig();
  const publicClient = usePublicClient();

  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { mutateAsync: deployContract, isPending: isDeploying } = useDeployContract();

  const [registryAddressDraftByChain, setRegistryAddressDraftByChain] = useState<Record<number, string>>({});
  const [registryAddressError, setRegistryAddressError] = useState<string | null>(null);
  const [deployNotice, setDeployNotice] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployTxHash, setDeployTxHash] = useState<Hex | null>(null);

  const registryAddress = registry.registryAddress;
  const registryAddressInput = registryAddressDraftByChain[chainId] ?? registryAddress ?? '';

  const currentChain = useMemo(() => chains.find((c) => c.id === chainId), [chains, chainId]);

  function onConnect() {
    const connector = connectors[0];
    if (!connector) return;
    connect({ connector });
  }

  function onSaveRegistry() {
    try {
      const saved = registry.setRegistryAddress(registryAddressInput.trim());
      setRegistryAddressDraftByChain((prev) => ({ ...prev, [chainId]: saved }));
      setRegistryAddressError(null);
    } catch (err) {
      setRegistryAddressError(err instanceof Error ? err.message : 'invalid address');
    }
  }

  function onResetRegistry() {
    registry.resetRegistryAddress();
    setRegistryAddressDraftByChain((prev) => {
      if (!(chainId in prev)) return prev;
      const next = { ...prev };
      delete next[chainId];
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

    if (chainId === 1) {
      const ok = window.confirm('Deploying on Ethereum mainnet costs gas. Continue?');
      if (!ok) return;
    }

    try {
      setDeployNotice('Sending deploy transaction…');
      const hash = (await deployContract({
        abi: DEAD_DROP_REGISTRY_ABI,
        bytecode: DEAD_DROP_REGISTRY_BYTECODE,
        chainId,
      })) as Hex;
      setDeployTxHash(hash);
      setDeployNotice('Waiting for confirmation…');

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const contractAddress = receipt.contractAddress;
      if (!contractAddress) throw new Error('Deploy confirmed, but no contract address found in receipt.');

      const checksummed = getAddress(contractAddress) as Address;
      registry.setRegistryAddress(checksummed);
      setRegistryAddressDraftByChain((prev) => ({ ...prev, [chainId]: checksummed }));

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
            value={chainId}
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

      <div className="walletRow">
        <label className="label grow">
          Registry (this chain)
          <input
            className="input"
            value={registryAddressInput}
            onChange={(e) => {
              setRegistryAddressDraftByChain((prev) => ({ ...prev, [chainId]: e.target.value }));
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
          <button className="btn btnSecondary" type="button" onClick={onDeployRegistry} disabled={!isConnected || isDeploying}>
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
              {blockExplorerTxUrl(chainId, deployTxHash) ? (
                <a href={blockExplorerTxUrl(chainId, deployTxHash)} target="_blank" rel="noreferrer">
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
